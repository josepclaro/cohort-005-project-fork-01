import { data } from "react-router";
import { eq, and } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  UserRole,
  users,
  courses,
  enrollments,
  purchases,
} from "~/db/schema";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { checkPppAccess } from "~/lib/ppp";

export type Db = BetterSQLite3Database<typeof schema>;

type User = typeof users.$inferSelect;

const SIGNED_OUT_MESSAGE = "Select a user from the DevUI panel.";

function getUserById(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function getCourseById(db: Db, id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function isUserEnrolled(db: Db, userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

function findPurchase(db: Db, userId: number, courseId: number) {
  return db
    .select()
    .from(purchases)
    .where(and(eq(purchases.userId, userId), eq(purchases.courseId, courseId)))
    .get();
}

// getAccess never throws — the lesson page needs to render a paywall preview for
// signed-out and unenrolled visitors rather than erroring. The require* wrappers
// are built on it for the routes that should just reject.

export type Access = {
  userId: number | null;
  user: User | undefined;
  isAdmin: boolean;
  /**
   * The instructor who owns this specific course. Someone whose role has been
   * changed away from Instructor no longer counts, even if they still own it.
   */
  isOwningInstructor: boolean;
  /** Owning instructor or admin — the people who speak for the course. */
  isStaff: boolean;
  enrolled: boolean;
  pppBlocked: boolean;
  pppBlockedCountry: string | null;
  pppPurchaseCountry: string | null;
  /**
   * May they read the course's content (lesson bodies, comments)?
   * Staff always can. Students need an enrollment that isn't PPP-blocked.
   */
  canViewContent: boolean;
};

/** What the require* wrappers return: someone is known to be signed in. */
export type SignedInAccess = Access & { userId: number; user: User };

function isSignedIn(access: Access): access is SignedInAccess {
  return access.userId !== null && access.user !== undefined;
}

const SIGNED_OUT: Access = {
  userId: null,
  user: undefined,
  isAdmin: false,
  isOwningInstructor: false,
  isStaff: false,
  enrolled: false,
  pppBlocked: false,
  pppBlockedCountry: null,
  pppPurchaseCountry: null,
  canViewContent: false,
};

async function findSignedInUser(db: Db, request: Request) {
  const userId = await getCurrentUserId(request);
  if (!userId) return undefined;
  return getUserById(db, userId);
}

export async function getAccess(
  db: Db,
  request: Request,
  courseId: number
): Promise<Access> {
  const user = await findSignedInUser(db, request);
  if (!user) return SIGNED_OUT;

  const course = getCourseById(db, courseId);
  const isAdmin = user.role === UserRole.Admin;
  const isOwningInstructor =
    user.role === UserRole.Instructor && course?.instructorId === user.id;
  const isStaff = isAdmin || isOwningInstructor;
  const enrolled = isUserEnrolled(db, user.id, courseId);

  // PPP only restricts students who bought at a discount — staff are exempt.
  let ppp = {
    blocked: false,
    blockedCountry: null as string | null,
    purchaseCountry: null as string | null,
  };

  if (enrolled && !isStaff && course) {
    const purchase = findPurchase(db, user.id, courseId);
    ppp = checkPppAccess(
      course.price,
      course.pppEnabled,
      purchase?.country ?? null,
      await resolveCountry(request)
    );
  }

  return {
    userId: user.id,
    user,
    isAdmin,
    isOwningInstructor,
    isStaff,
    enrolled,
    pppBlocked: ppp.blocked,
    pppBlockedCountry: ppp.blockedCountry,
    pppPurchaseCountry: ppp.purchaseCountry,
    canViewContent: isStaff || (enrolled && !ppp.blocked),
  };
}

/**
 * Throws 401 unless someone is signed in. Returns their user id without
 * looking them up — use requireUser when the account must still exist.
 */
export async function requireUserId(request: Request): Promise<number> {
  const userId = await getCurrentUserId(request);
  if (!userId) {
    throw data(SIGNED_OUT_MESSAGE, { status: 401 });
  }
  return userId;
}

/** Throws 401 unless someone is signed in with an account that still exists. */
export async function requireUser(db: Db, request: Request): Promise<User> {
  const user = await findSignedInUser(db, request);
  if (!user) {
    throw data(SIGNED_OUT_MESSAGE, { status: 401 });
  }
  return user;
}

/**
 * Throws 401 when signed out, 403 when the user can't see the course's content.
 * Use in actions — loader guards don't protect actions.
 */
export async function requireContentAccess(
  db: Db,
  request: Request,
  courseId: number
): Promise<SignedInAccess> {
  const access = await getAccess(db, request, courseId);

  if (!isSignedIn(access)) {
    throw data(SIGNED_OUT_MESSAGE, { status: 401 });
  }

  if (!access.canViewContent) {
    throw data("You must be enrolled in this course.", { status: 403 });
  }

  return access;
}

/**
 * Throws unless the user is the course's own instructor, or an admin. An admin
 * passes even when the course does not exist, so look the course up and 404
 * afterwards.
 */
export async function requireStaff(
  db: Db,
  request: Request,
  courseId: number
): Promise<SignedInAccess> {
  const access = await getAccess(db, request, courseId);

  if (!isSignedIn(access)) {
    throw data(SIGNED_OUT_MESSAGE, { status: 401 });
  }

  if (!access.isStaff) {
    throw data("Only this course's instructor can do that.", { status: 403 });
  }

  return access;
}

/** Throws unless the user is a Platform Admin. */
export async function requirePlatformAdmin(
  db: Db,
  request: Request
): Promise<User> {
  const user = await requireUser(db, request);

  if (user.role !== UserRole.Admin) {
    throw data("Only Platform Admins can do that.", { status: 403 });
  }

  return user;
}

/**
 * Throws unless the user is an Instructor. Admins are turned away: these pages
 * list and create courses as their own.
 */
export async function requireInstructor(
  db: Db,
  request: Request
): Promise<User> {
  const user = await requireUser(db, request);

  if (user.role !== UserRole.Instructor) {
    throw data("Only instructors can do that.", { status: 403 });
  }

  return user;
}

/**
 * Throws unless the user is an instructor or an admin, without tying them to a
 * particular course — for pages that span all of someone's courses.
 */
export async function requireInstructorOrAdmin(db: Db, request: Request) {
  const user = await requireUser(db, request);

  if (user.role !== UserRole.Instructor && user.role !== UserRole.Admin) {
    throw data("Only instructors can access this page.", { status: 403 });
  }

  return { userId: user.id, user, isAdmin: user.role === UserRole.Admin };
}
