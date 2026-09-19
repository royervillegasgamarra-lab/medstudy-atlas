import { describe, it, expect } from "vitest";
import {
  SignupSchema,
  LoginSchema,
  ProfileUpdateSchema,
  getSafeRedirectUrl,
} from "@/modules/identity/validation";

describe("Identity Validation Schemas & Security Boundaries", () => {
  describe("getSafeRedirectUrl (Open Redirect Defense CWE-601)", () => {
    it("permits valid local relative paths", () => {
      expect(getSafeRedirectUrl("/app")).toBe("/app");
      expect(getSafeRedirectUrl("/app/profile")).toBe("/app/profile");
      expect(getSafeRedirectUrl("/app/settings?tab=general")).toBe(
        "/app/settings?tab=general"
      );
    });

    it("rejects protocol-relative URLs (//attacker.com)", () => {
      expect(getSafeRedirectUrl("//attacker.com")).toBe("/app");
      expect(getSafeRedirectUrl("//evil.com/app")).toBe("/app");
    });

    it("rejects backslash bypass attempts (/\\attacker.com)", () => {
      expect(getSafeRedirectUrl("/\\attacker.com")).toBe("/app");
    });

    it("rejects absolute external URLs", () => {
      expect(getSafeRedirectUrl("https://evil.com")).toBe("/app");
      expect(getSafeRedirectUrl("http://evil.com/app")).toBe("/app");
      expect(getSafeRedirectUrl("javascript:alert(1)")).toBe("/app");
    });

    it("defaults to /app when null or undefined", () => {
      expect(getSafeRedirectUrl(undefined)).toBe("/app");
      expect(getSafeRedirectUrl(null)).toBe("/app");
      expect(getSafeRedirectUrl("")).toBe("/app");
      expect(getSafeRedirectUrl("   ")).toBe("/app");
    });
  });

  describe("SignupSchema", () => {
    it("validates valid medical student registration data", () => {
      const result = SignupSchema.safeParse({
        fullName: "Dr. Roberto Casas",
        email: "roberto@medicina.pe",
        password: "securePassword123!",
        medicalSchool: "UNMSM",
        yearOfStudy: "6",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.yearOfStudy).toBe(6);
        expect(result.data.fullName).toBe("Dr. Roberto Casas");
        expect(result.data.email).toBe("roberto@medicina.pe");
        expect(result.data.medicalSchool).toBe("UNMSM");
      }
    });

    it("rejects short names (< 2 characters)", () => {
      const result = SignupSchema.safeParse({
        fullName: "A",
        email: "roberto@medicina.pe",
        password: "securePassword123!",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.fullName).toBeDefined();
      }
    });

    it("rejects invalid email formats", () => {
      const result = SignupSchema.safeParse({
        fullName: "Dr. Roberto",
        email: "not-an-email",
        password: "securePassword123!",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.email).toBeDefined();
      }
    });

    it("rejects short passwords (< 8 characters)", () => {
      const result = SignupSchema.safeParse({
        fullName: "Dr. Roberto",
        email: "roberto@medicina.pe",
        password: "1234567",
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.flatten().fieldErrors.password).toBeDefined();
      }
    });

    it("accepts passwords with 8 or more characters", () => {
      const result = SignupSchema.safeParse({
        fullName: "Dr. Roberto",
        email: "roberto@medicina.pe",
        password: "12345678",
      });

      expect(result.success).toBe(true);
    });

    it("rejects year of study outside medical curriculum range (1 to 7)", () => {
      const resultUnder = SignupSchema.safeParse({
        fullName: "Dr. Roberto",
        email: "roberto@medicina.pe",
        password: "securePassword123!",
        yearOfStudy: 0,
      });
      expect(resultUnder.success).toBe(false);

      const resultOver = SignupSchema.safeParse({
        fullName: "Dr. Roberto",
        email: "roberto@medicina.pe",
        password: "securePassword123!",
        yearOfStudy: 8,
      });
      expect(resultOver.success).toBe(false);
    });

    it("normalizes optional fields to null when omitted or empty", () => {
      const result = SignupSchema.safeParse({
        fullName: "Dra. Carmen",
        email: "CARMEN@medicina.pe",
        password: "securePassword123!",
        medicalSchool: "   ",
        yearOfStudy: "",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("carmen@medicina.pe");
        expect(result.data.medicalSchool).toBeNull();
        expect(result.data.yearOfStudy).toBeNull();
      }
    });
  });

  describe("LoginSchema", () => {
    it("accepts valid login credentials and preserves redirect target", () => {
      const result = LoginSchema.safeParse({
        email: "CARMEN@medicina.pe",
        password: "anyPassword",
        redirectTo: "/app/profile",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("carmen@medicina.pe");
        expect(result.data.redirectTo).toBe("/app/profile");
      }
    });

    it("rejects empty password", () => {
      const result = LoginSchema.safeParse({
        email: "carmen@medicina.pe",
        password: "",
      });

      expect(result.success).toBe(false);
    });
  });

  describe("ProfileUpdateSchema", () => {
    it("validates profile updates with target exam dates", () => {
      const result = ProfileUpdateSchema.safeParse({
        fullName: "Dra. Carmen Rosa",
        medicalSchool: "UPCH",
        yearOfStudy: "7",
        targetExamDate: "2027-03-20",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.fullName).toBe("Dra. Carmen Rosa");
        expect(result.data.medicalSchool).toBe("UPCH");
        expect(result.data.yearOfStudy).toBe(7);
        expect(result.data.targetExamDate).toBe("2027-03-20");
      }
    });

    it("normalizes empty optional fields to null to support clearing", () => {
      const result = ProfileUpdateSchema.safeParse({
        fullName: "Dra. Carmen Rosa",
        medicalSchool: "   ",
        yearOfStudy: "",
        targetExamDate: "",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.medicalSchool).toBeNull();
        expect(result.data.yearOfStudy).toBeNull();
        expect(result.data.targetExamDate).toBeNull();
      }
    });
  });
});
