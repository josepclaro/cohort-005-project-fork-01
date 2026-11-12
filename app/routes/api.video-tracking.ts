import { data } from "react-router";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireContentAccess } from "~/lib/access.server";
import type { Route } from "./+types/api.video-tracking";
import { parseJson } from "~/lib/validation";
import { db } from "~/db";
import { lessons, modules, videoWatchEvents } from "~/db/schema";

const videoTrackingSchema = z.object({
  lessonId: z.number().int(),
  eventType: z.enum(["play", "pause", "progress", "ended"]),
  positionSeconds: z.number().finite().nonnegative(),
});

function getCourseIdForLesson(lessonId: number) {
  return db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .where(eq(lessons.id, lessonId))
    .get()?.courseId;
}

export async function action({ request }: Route.ActionArgs) {
  const { lessonId, eventType, positionSeconds } = await parseJson(
    request,
    videoTrackingSchema
  );

  const courseId = getCourseIdForLesson(lessonId);
  if (courseId === undefined) {
    throw data("Lesson not found", { status: 404 });
  }

  const { userId } = await requireContentAccess(db, request, courseId);

  db.insert(videoWatchEvents)
    .values({ userId, lessonId, eventType, positionSeconds })
    .run();

  return { success: true };
}
