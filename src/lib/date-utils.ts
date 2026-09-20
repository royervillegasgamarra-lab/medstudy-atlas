/**
 * Canonical calendar/business timezone for MedStudy Atlas MVP (Peru).
 * All calendar-day calculations, inputs, and countdowns evaluate relative to this timezone.
 * Per-user timezone customization is deferred to a future phase.
 */
export const MVP_TIMEZONE = "America/Lima";

/**
 * Parses a YYYY-MM-DD string into [year, month (1-indexed), day].
 * Returns null if the format or date is invalid.
 */
export function parseDateParts(
  dateStr: string | null | undefined
): [number, number, number] | null {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Verify days in month (including leap year)
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) return null;

  return [year, month, day];
}

/**
 * Extracts calendar date parts [year, month (1-indexed), day] from a reference instant in America/Lima.
 */
export function getLimaDateParts(
  referenceDate: Date = new Date()
): [number, number, number] {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MVP_TIMEZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const parts = formatter.formatToParts(referenceDate);
  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = parseInt(p.value, 10);
    if (p.type === "month") month = parseInt(p.value, 10);
    if (p.type === "day") day = parseInt(p.value, 10);
  }
  return [year, month, day];
}

/**
 * Returns the current calendar date string (YYYY-MM-DD) in America/Lima.
 */
export function getCalendarDateInLima(
  referenceDate: Date = new Date()
): string {
  const [year, month, day] = getLimaDateParts(referenceDate);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * Formats a YYYY-MM-DD date string in Spanish (es-PE) without timezone shifts.
 * Example: "2027-05-20" -> "20 de mayo de 2027"
 */
export function formatExamDate(dateStr: string | null | undefined): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return "Sin fecha definida";

  const [year, month, day] = parts;
  // Construct local date at noon to avoid any DST edge cases
  const localDate = new Date(year, month - 1, day, 12, 0, 0);

  return localDate.toLocaleDateString("es-PE", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export interface RemainingDaysResult {
  days: number;
  label: string;
  isPast: boolean;
  isToday: boolean;
}

/**
 * Calculates remaining calendar days until a target exam date relative to America/Lima calendar day.
 * Strictly compares calendar day boundaries, eliminating UTC offset shifts.
 */
export function getRemainingDays(
  targetDateStr: string,
  referenceDate: Date = new Date()
): RemainingDaysResult | null {
  const parts = parseDateParts(targetDateStr);
  if (!parts) return null;

  const [tYear, tMonth, tDay] = parts;
  const [refYear, refMonth, refDay] = getLimaDateParts(referenceDate);

  // Both represent calendar days at UTC midnight
  const targetUtcMidnight = Date.UTC(tYear, tMonth - 1, tDay);
  const refUtcMidnight = Date.UTC(refYear, refMonth - 1, refDay);

  const diffMs = targetUtcMidnight - refUtcMidnight;
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return { days: 0, label: "Hoy", isPast: false, isToday: true };
  }
  if (diffDays === 1) {
    return { days: 1, label: "Mañana", isPast: false, isToday: false };
  }
  if (diffDays > 1) {
    return {
      days: diffDays,
      label: `${diffDays} días restantes`,
      isPast: false,
      isToday: false,
    };
  }
  if (diffDays === -1) {
    return { days: -1, label: "Ayer", isPast: true, isToday: false };
  }
  return {
    days: diffDays,
    label: `Hace ${Math.abs(diffDays)} días`,
    isPast: true,
    isToday: false,
  };
}

/**
 * Validates if a string is a valid YYYY-MM-DD date.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  return parseDateParts(dateStr) !== null;
}

/**
 * Checks if a date string is today or in the future relative to America/Lima calendar day.
 */
export function isFutureOrToday(
  dateStr: string,
  referenceDate: Date = new Date()
): boolean {
  const remaining = getRemainingDays(dateStr, referenceDate);
  if (!remaining) return false;
  return remaining.days >= 0;
}
