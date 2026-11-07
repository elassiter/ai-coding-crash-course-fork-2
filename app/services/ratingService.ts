import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings, courses } from "~/db/schema";
import { isUserEnrolled } from "~/services/enrollmentService";

// ─── Rating Service ───
// One 1–5 star rating per user per course. Re-rating updates the existing row
// (enforced by the unique (user_id, course_id) index). Averages are computed on read.

export type CourseRatingSummary = { average: number; count: number };

const EMPTY_SUMMARY: CourseRatingSummary = { average: 0, count: 0 };

export function getCourseRatingSummary(courseId: number): CourseRatingSummary {
  const row = db
    .select({
      average: sql<number | null>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(eq(courseRatings.courseId, courseId))
    .get();

  return { average: row?.average ?? 0, count: row?.count ?? 0 };
}

/** Single grouped query for many courses (avoids N+1 on list pages). */
export function getRatingSummariesForCourses(
  courseIds: number[]
): Map<number, CourseRatingSummary> {
  const summaries = new Map<number, CourseRatingSummary>();
  if (courseIds.length === 0) return summaries;

  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  for (const id of courseIds) summaries.set(id, EMPTY_SUMMARY);
  for (const row of rows) {
    summaries.set(row.courseId, { average: row.average, count: row.count });
  }
  return summaries;
}

export function getUserCourseRating(userId: number, courseId: number) {
  const row = db
    .select({ rating: courseRatings.rating })
    .from(courseRatings)
    .where(
      and(eq(courseRatings.userId, userId), eq(courseRatings.courseId, courseId))
    )
    .get();

  return row?.rating ?? null;
}

export function rateCourse(userId: number, courseId: number, rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be a whole number from 1 to 5");
  }

  const course = db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    throw new Error("Course not found");
  }
  if (course.instructorId === userId) {
    throw new Error("Instructors cannot rate their own course");
  }
  if (!isUserEnrolled(userId, courseId)) {
    throw new Error("You must be enrolled to rate this course");
  }

  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: new Date().toISOString() },
    })
    .returning()
    .get();
}
