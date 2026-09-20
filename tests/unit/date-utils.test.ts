import { describe, it, expect } from "vitest";
import {
  parseDateParts,
  formatExamDate,
  getRemainingDays,
  isValidCalendarDate,
  isFutureOrToday,
} from "@/lib/date-utils";

describe("Deterministic Calendar Date Utilities", () => {
  describe("parseDateParts", () => {
    it("parses valid YYYY-MM-DD correctly", () => {
      expect(parseDateParts("2027-05-20")).toEqual([2027, 5, 20]);
      expect(parseDateParts("2026-12-31")).toEqual([2026, 12, 31]);
      expect(parseDateParts("2024-02-29")).toEqual([2024, 2, 29]); // Leap year
    });

    it("rejects invalid dates and formats", () => {
      expect(parseDateParts("")).toBeNull();
      expect(parseDateParts(null)).toBeNull();
      expect(parseDateParts(undefined)).toBeNull();
      expect(parseDateParts("2027/05/20")).toBeNull();
      expect(parseDateParts("invalid")).toBeNull();
      expect(parseDateParts("2023-02-29")).toBeNull(); // Not a leap year
      expect(parseDateParts("2027-13-01")).toBeNull(); // Month 13
      expect(parseDateParts("2027-04-31")).toBeNull(); // April has 30 days
    });
  });

  describe("formatExamDate", () => {
    it("formats dates in Spanish without timezone shift", () => {
      const formatted = formatExamDate("2027-05-20");
      expect(formatted).toContain("20");
      expect(formatted.toLowerCase()).toContain("mayo");
      expect(formatted).toContain("2027");
    });

    it("handles null or undefined safely", () => {
      expect(formatExamDate(null)).toBe("Sin fecha definida");
      expect(formatExamDate("")).toBe("Sin fecha definida");
      expect(formatExamDate(undefined)).toBe("Sin fecha definida");
    });
  });

  describe("getRemainingDays & isFutureOrToday", () => {
    const fixedToday = new Date(2026, 8, 19, 14, 30, 0); // Sept 19, 2026

    it("calculates today as 0 days remaining", () => {
      const result = getRemainingDays("2026-09-19", fixedToday);
      expect(result).toEqual({
        days: 0,
        label: "Hoy",
        isPast: false,
        isToday: true,
      });
      expect(isFutureOrToday("2026-09-19", fixedToday)).toBe(true);
    });

    it("calculates tomorrow as 1 day remaining", () => {
      const result = getRemainingDays("2026-09-20", fixedToday);
      expect(result).toEqual({
        days: 1,
        label: "Mañana",
        isPast: false,
        isToday: false,
      });
      expect(isFutureOrToday("2026-09-20", fixedToday)).toBe(true);
    });

    it("calculates future date correctly", () => {
      const result = getRemainingDays("2026-09-29", fixedToday);
      expect(result).toEqual({
        days: 10,
        label: "10 días restantes",
        isPast: false,
        isToday: false,
      });
      expect(isFutureOrToday("2026-09-29", fixedToday)).toBe(true);
    });

    it("calculates yesterday as past", () => {
      const result = getRemainingDays("2026-09-18", fixedToday);
      expect(result).toEqual({
        days: -1,
        label: "Ayer",
        isPast: true,
        isToday: false,
      });
      expect(isFutureOrToday("2026-09-18", fixedToday)).toBe(false);
    });

    it("calculates past date correctly", () => {
      const result = getRemainingDays("2026-09-09", fixedToday);
      expect(result).toEqual({
        days: -10,
        label: "Hace 10 días",
        isPast: true,
        isToday: false,
      });
      expect(isFutureOrToday("2026-09-09", fixedToday)).toBe(false);
    });
  });

  describe("isValidCalendarDate", () => {
    it("validates real dates strictly", () => {
      expect(isValidCalendarDate("2027-01-01")).toBe(true);
      expect(isValidCalendarDate("2027-02-28")).toBe(true);
      expect(isValidCalendarDate("2027-02-29")).toBe(false);
      expect(isValidCalendarDate("not-a-date")).toBe(false);
    });
  });

  describe("America/Lima (UTC-5) Boundary and Transition Handling", () => {
    it("evaluates UTC instant before Lima midnight as previous calendar day", () => {
      // 2026-09-20T02:30:00Z is 2026-09-19 21:30:00 in Lima (UTC-5)
      const lateNightUtc = new Date("2026-09-20T02:30:00Z");

      const limaDate = getRemainingDays("2026-09-19", lateNightUtc);
      expect(limaDate).toEqual({
        days: 0,
        label: "Hoy",
        isPast: false,
        isToday: true,
      });
      expect(isFutureOrToday("2026-09-19", lateNightUtc)).toBe(true);

      const nextDay = getRemainingDays("2026-09-20", lateNightUtc);
      expect(nextDay).toEqual({
        days: 1,
        label: "Mañana",
        isPast: false,
        isToday: false,
      });
    });

    it("evaluates UTC instant at exactly Lima midnight as new calendar day", () => {
      // 2026-09-20T05:00:00Z is 2026-09-20 00:00:00 in Lima (UTC-5)
      const midnightLima = new Date("2026-09-20T05:00:00Z");

      const yesterday = getRemainingDays("2026-09-19", midnightLima);
      expect(yesterday).toEqual({
        days: -1,
        label: "Ayer",
        isPast: true,
        isToday: false,
      });
      expect(isFutureOrToday("2026-09-19", midnightLima)).toBe(false);

      const today = getRemainingDays("2026-09-20", midnightLima);
      expect(today).toEqual({
        days: 0,
        label: "Hoy",
        isPast: false,
        isToday: true,
      });
      expect(isFutureOrToday("2026-09-20", midnightLima)).toBe(true);
    });
  });
});
