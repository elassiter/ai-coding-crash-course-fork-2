import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  rateCourse,
  getUserCourseRating,
  getCourseRatingSummary,
  getRatingSummariesForCourses,
} from "./ratingService";

function createEnrolledStudent(email: string, courseId = base.course.id) {
  const user = testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
  testDb.insert(schema.enrollments).values({ userId: user.id, courseId }).run();
  return user;
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("rateCourse", () => {
    it("updates an existing rating instead of adding another", () => {
      const student = createEnrolledStudent("a@example.com");

      rateCourse(student.id, base.course.id, 2);
      rateCourse(student.id, base.course.id, 5);

      expect(getUserCourseRating(student.id, base.course.id)).toBe(5);
      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 5,
        count: 1,
      });
    });

    it("rejects users who are not enrolled", () => {
      expect(() => rateCourse(base.user.id, base.course.id, 4)).toThrowError(
        "You must be enrolled to rate this course"
      );
    });

    it("rejects the course instructor", () => {
      testDb
        .insert(schema.enrollments)
        .values({ userId: base.instructor.id, courseId: base.course.id })
        .run();

      expect(() =>
        rateCourse(base.instructor.id, base.course.id, 5)
      ).toThrowError("Instructors cannot rate their own course");
    });

    it.each([0, 6, 3.5, NaN])("rejects invalid rating %s", (rating) => {
      const student = createEnrolledStudent("a@example.com");
      expect(() => rateCourse(student.id, base.course.id, rating)).toThrowError(
        "Rating must be a whole number from 1 to 5"
      );
    });

    it("throws for a non-existent course", () => {
      expect(() => rateCourse(base.user.id, 9999, 3)).toThrowError(
        "Course not found"
      );
    });
  });

  describe("summaries", () => {
    it("returns zero average and count when unrated", () => {
      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 0,
        count: 0,
      });
      expect(getUserCourseRating(base.user.id, base.course.id)).toBeNull();
    });

    it("averages ratings across users", () => {
      rateCourse(createEnrolledStudent("a@example.com").id, base.course.id, 5);
      rateCourse(createEnrolledStudent("b@example.com").id, base.course.id, 4);
      rateCourse(createEnrolledStudent("c@example.com").id, base.course.id, 4);

      const summary = getCourseRatingSummary(base.course.id);
      expect(summary.count).toBe(3);
      expect(summary.average).toBeCloseTo(4.333, 2);
    });

    it("summarizes many courses at once, including unrated ones", () => {
      const other = testDb
        .insert(schema.courses)
        .values({
          title: "Other",
          slug: "other",
          description: "x",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();
      rateCourse(createEnrolledStudent("a@example.com").id, base.course.id, 3);
      rateCourse(createEnrolledStudent("b@example.com").id, base.course.id, 5);

      const summaries = getRatingSummariesForCourses([base.course.id, other.id]);

      expect(summaries.get(base.course.id)).toEqual({ average: 4, count: 2 });
      expect(summaries.get(other.id)).toEqual({ average: 0, count: 0 });
    });
  });
});
