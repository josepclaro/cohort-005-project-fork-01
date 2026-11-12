import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData, type TestDb } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { eq } from "drizzle-orm";
import { markdown } from "~/lib/text";
import { setCurrentUserId } from "~/lib/session";
import {
  getAccess,
  requireContentAccess,
  requireInstructor,
  requireInstructorOrAdmin,
  requirePlatformAdmin,
  requireStaff,
  requireUser,
  requireUserId,
} from "./access.server";

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

const SIGNED_OUT_REQUEST = () => new Request("http://localhost/");

async function requestAs(userId: number, country?: string) {
  const setCookie = await setCurrentUserId(SIGNED_OUT_REQUEST(), userId);
  const headers = new Headers({ Cookie: setCookie.split(";")[0] });
  if (country) headers.set("CF-IPCountry", country);
  return new Request("http://localhost/", { headers });
}

function createUser(role: UserRole, name: string) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name}@example.com`, role })
    .returning()
    .get();
}

function enroll(userId: number, courseId = base.course.id) {
  db.insert(schema.enrollments).values({ userId, courseId }).run();
}

function recordPurchase(userId: number, country: string | null) {
  db.insert(schema.purchases)
    .values({ userId, courseId: base.course.id, amountPaid: 1000, country })
    .run();
}

function enablePpp() {
  db.update(schema.courses)
    .set({ price: 5000, pppEnabled: true })
    .where(eq(schema.courses.id, base.course.id))
    .run();
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { init: { status: number } | null };
  }
  throw new Error("Expected the guard to throw");
}

async function statusOf(promise: Promise<unknown>) {
  return (await rejection(promise)).init?.status;
}

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("getAccess", () => {
  it("gives a signed-out visitor nothing, without throwing", async () => {
    const access = await getAccess(db, SIGNED_OUT_REQUEST(), base.course.id);

    expect(access.userId).toBeNull();
    expect(access.canViewContent).toBe(false);
  });

  it("treats a session for a deleted account as signed out", async () => {
    const access = await getAccess(db, await requestAs(9999), base.course.id);

    expect(access.userId).toBeNull();
  });

  it("does not let an unenrolled Student see the content", async () => {
    const access = await getAccess(
      db,
      await requestAs(base.user.id),
      base.course.id
    );

    expect(access.enrolled).toBe(false);
    expect(access.canViewContent).toBe(false);
  });

  it("lets an enrolled Student see the content", async () => {
    enroll(base.user.id);

    const access = await getAccess(
      db,
      await requestAs(base.user.id),
      base.course.id
    );

    expect(access.canViewContent).toBe(true);
    expect(access.isStaff).toBe(false);
  });

  it("does not carry an Enrollment on one course over to another", async () => {
    const other = db
      .insert(schema.courses)
      .values({
        title: "Other",
        slug: "other",
        description: "Another course",
        salesCopy: markdown("Another course"),
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: schema.CourseStatus.Published,
      })
      .returning()
      .get();
    enroll(base.user.id, other.id);

    const access = await getAccess(
      db,
      await requestAs(base.user.id),
      base.course.id
    );

    expect(access.canViewContent).toBe(false);
  });

  it("blocks a Student who bought at a discount from viewing in another country", async () => {
    enablePpp();
    enroll(base.user.id);
    recordPurchase(base.user.id, "IN");

    const access = await getAccess(
      db,
      await requestAs(base.user.id, "US"),
      base.course.id
    );

    expect(access.pppBlocked).toBe(true);
    expect(access.pppBlockedCountry).toBe("US");
    expect(access.pppPurchaseCountry).toBe("IN");
    expect(access.canViewContent).toBe(false);
  });

  it("lets that Student view from the country they bought in", async () => {
    enablePpp();
    enroll(base.user.id);
    recordPurchase(base.user.id, "IN");

    const access = await getAccess(
      db,
      await requestAs(base.user.id, "IN"),
      base.course.id
    );

    expect(access.canViewContent).toBe(true);
  });

  it("makes the owning Instructor staff without an Enrollment", async () => {
    const access = await getAccess(
      db,
      await requestAs(base.instructor.id),
      base.course.id
    );

    expect(access.isOwningInstructor).toBe(true);
    expect(access.isStaff).toBe(true);
    expect(access.canViewContent).toBe(true);
  });

  it("exempts the owning Instructor from PPP", async () => {
    enablePpp();
    enroll(base.instructor.id);
    recordPurchase(base.instructor.id, "IN");

    const access = await getAccess(
      db,
      await requestAs(base.instructor.id, "US"),
      base.course.id
    );

    expect(access.pppBlocked).toBe(false);
    expect(access.canViewContent).toBe(true);
  });

  it("does not make another course's Instructor staff", async () => {
    const otherInstructor = createUser(UserRole.Instructor, "other");

    const access = await getAccess(
      db,
      await requestAs(otherInstructor.id),
      base.course.id
    );

    expect(access.isStaff).toBe(false);
    expect(access.canViewContent).toBe(false);
  });

  it("stops treating an owner as staff once their role is no longer Instructor", async () => {
    db.update(schema.users)
      .set({ role: UserRole.Student })
      .where(eq(schema.users.id, base.instructor.id))
      .run();

    const access = await getAccess(
      db,
      await requestAs(base.instructor.id),
      base.course.id
    );

    expect(access.isOwningInstructor).toBe(false);
    expect(access.isStaff).toBe(false);
  });

  it("makes a Platform Admin staff on every course", async () => {
    const admin = createUser(UserRole.Admin, "admin");

    const access = await getAccess(
      db,
      await requestAs(admin.id),
      base.course.id
    );

    expect(access.isAdmin).toBe(true);
    expect(access.isStaff).toBe(true);
    expect(access.canViewContent).toBe(true);
  });
});

describe("requireUserId and requireUser", () => {
  it("rejects a signed-out visitor with 401", async () => {
    expect(await statusOf(requireUserId(SIGNED_OUT_REQUEST()))).toBe(401);
    expect(await statusOf(requireUser(db, SIGNED_OUT_REQUEST()))).toBe(401);
  });

  it("returns the signed-in user", async () => {
    const request = await requestAs(base.user.id);

    expect(await requireUserId(request)).toBe(base.user.id);
    expect((await requireUser(db, request)).id).toBe(base.user.id);
  });

  it("rejects a session whose account no longer exists, but only when looking it up", async () => {
    const request = await requestAs(9999);

    expect(await requireUserId(request)).toBe(9999);
    expect(await statusOf(requireUser(db, request))).toBe(401);
  });
});

describe("requireContentAccess", () => {
  it("rejects a signed-out visitor with 401", async () => {
    expect(
      await statusOf(
        requireContentAccess(db, SIGNED_OUT_REQUEST(), base.course.id)
      )
    ).toBe(401);
  });

  it("rejects an unenrolled Student with 403", async () => {
    expect(
      await statusOf(
        requireContentAccess(db, await requestAs(base.user.id), base.course.id)
      )
    ).toBe(403);
  });

  it("rejects a PPP-blocked Student with 403", async () => {
    enablePpp();
    enroll(base.user.id);
    recordPurchase(base.user.id, "IN");

    expect(
      await statusOf(
        requireContentAccess(
          db,
          await requestAs(base.user.id, "US"),
          base.course.id
        )
      )
    ).toBe(403);
  });

  it("lets an enrolled Student through", async () => {
    enroll(base.user.id);

    const access = await requireContentAccess(
      db,
      await requestAs(base.user.id),
      base.course.id
    );

    expect(access.userId).toBe(base.user.id);
  });
});

describe("requireStaff", () => {
  it("rejects a signed-out visitor with 401", async () => {
    expect(
      await statusOf(requireStaff(db, SIGNED_OUT_REQUEST(), base.course.id))
    ).toBe(401);
  });

  it("rejects an enrolled Student with 403", async () => {
    enroll(base.user.id);

    expect(
      await statusOf(
        requireStaff(db, await requestAs(base.user.id), base.course.id)
      )
    ).toBe(403);
  });

  it("rejects another course's Instructor with 403", async () => {
    const otherInstructor = createUser(UserRole.Instructor, "other");

    expect(
      await statusOf(
        requireStaff(db, await requestAs(otherInstructor.id), base.course.id)
      )
    ).toBe(403);
  });

  it("rejects a non-admin for a course that does not exist", async () => {
    expect(
      await statusOf(requireStaff(db, await requestAs(base.instructor.id), 9999))
    ).toBe(403);
  });

  it("lets the owning Instructor and a Platform Admin through", async () => {
    const admin = createUser(UserRole.Admin, "admin");

    const owner = await requireStaff(
      db,
      await requestAs(base.instructor.id),
      base.course.id
    );
    const platformAdmin = await requireStaff(
      db,
      await requestAs(admin.id),
      base.course.id
    );

    expect(owner.isOwningInstructor).toBe(true);
    expect(platformAdmin.isAdmin).toBe(true);
  });
});

describe("role guards", () => {
  it.each([
    ["requirePlatformAdmin", requirePlatformAdmin, [UserRole.Admin]],
    ["requireInstructor", requireInstructor, [UserRole.Instructor]],
    [
      "requireInstructorOrAdmin",
      requireInstructorOrAdmin,
      [UserRole.Instructor, UserRole.Admin],
    ],
  ] as const)("%s admits only its roles", async (_name, guard, allowed) => {
    expect(await statusOf(guard(db, SIGNED_OUT_REQUEST()))).toBe(401);

    for (const role of Object.values(UserRole)) {
      const user = createUser(role, `${role}-${allowed.join("-")}`);
      const request = await requestAs(user.id);

      if ((allowed as readonly UserRole[]).includes(role)) {
        await expect(guard(db, request)).resolves.toBeTruthy();
      } else {
        expect(await statusOf(guard(db, request))).toBe(403);
      }
    }
  });
});
