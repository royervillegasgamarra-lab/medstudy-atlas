import { describe, it, expect } from "vitest";
import {
  createSubjectSchema,
  updateSubjectSchema,
  createExamTargetSchema,
  updateExamTargetSchema,
} from "@/modules/curriculum/validation";

describe("Curriculum Validation Schemas", () => {
  describe("createSubjectSchema", () => {
    it("accepts valid subject name", () => {
      const result = createSubjectSchema.safeParse({ name: "Anatomía Humana" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Anatomía Humana");
      }
    });

    it("trims whitespace from name", () => {
      const result = createSubjectSchema.safeParse({ name: "  Fisiología  " });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Fisiología");
      }
    });

    it("rejects empty or whitespace-only name", () => {
      expect(createSubjectSchema.safeParse({ name: "" }).success).toBe(false);
      expect(createSubjectSchema.safeParse({ name: "   " }).success).toBe(
        false
      );
    });

    it("rejects names longer than 120 characters", () => {
      const longName = "A".repeat(121);
      expect(createSubjectSchema.safeParse({ name: longName }).success).toBe(
        false
      );
    });
  });

  describe("createExamTargetSchema", () => {
    it("accepts valid exam target with subject", () => {
      const result = createExamTargetSchema.safeParse({
        title: "Examen Parcial de Anatomía",
        exam_date: "2027-05-20",
        subject_id: "a0000000-0000-4000-8000-000000000001",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid exam target without subject", () => {
      const result = createExamTargetSchema.safeParse({
        title: "ENAM Ordinario",
        exam_date: "2027-11-15",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subject_id).toBeUndefined();
      }
    });

    it("transforms empty string subject_id to null", () => {
      const result = createExamTargetSchema.safeParse({
        title: "ENAM Ordinario",
        exam_date: "2027-11-15",
        subject_id: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.subject_id).toBeNull();
      }
    });

    it("rejects past exam date", () => {
      const result = createExamTargetSchema.safeParse({
        title: "Examen Pasado",
        exam_date: "2020-01-01",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid date format", () => {
      const result = createExamTargetSchema.safeParse({
        title: "Examen Mal Formato",
        exam_date: "20-05-2027",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid UUID subject_id", () => {
      const result = createExamTargetSchema.safeParse({
        title: "Examen",
        exam_date: "2027-05-20",
        subject_id: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("updateSubjectSchema", () => {
    it("accepts valid updated name", () => {
      const result = updateSubjectSchema.safeParse({
        name: "Farmacología Médica",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Farmacología Médica");
      }
    });

    it("rejects empty updated name", () => {
      expect(updateSubjectSchema.safeParse({ name: "" }).success).toBe(false);
    });
  });

  describe("updateExamTargetSchema", () => {
    it("accepts partial update of title only", () => {
      const result = updateExamTargetSchema.safeParse({
        title: "Examen Final Actualizado",
      });
      expect(result.success).toBe(true);
    });

    it("accepts partial update of exam_date only", () => {
      const result = updateExamTargetSchema.safeParse({
        exam_date: "2027-12-01",
      });
      expect(result.success).toBe(true);
    });

    it("accepts resetting subject_id to null", () => {
      const result = updateExamTargetSchema.safeParse({
        subject_id: null,
      });
      expect(result.success).toBe(true);
    });

    it("rejects past date in update", () => {
      const result = updateExamTargetSchema.safeParse({
        exam_date: "2020-01-01",
      });
      expect(result.success).toBe(false);
    });
  });
});
