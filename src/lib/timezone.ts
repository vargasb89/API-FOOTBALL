import { cookies } from "next/headers";

const DEFAULT_TIME_ZONE = "America/Bogota";

function buildFormatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    ...options
  });
}

export async function getRequestTimeZone() {
  const cookieStore = await cookies();
  return cookieStore.get("tz")?.value || DEFAULT_TIME_ZONE;
}

export function getDefaultTimeZone() {
  return DEFAULT_TIME_ZONE;
}

export function getDateInputValueInTimeZone(date: Date, timeZone: string) {
  const formatter = buildFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Could not derive local date for timezone ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

export function getFixtureDateInTimeZone(date: string, timeZone: string) {
  return getDateInputValueInTimeZone(new Date(date), timeZone);
}

export function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid date key: ${dateKey}`);
  }

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  date.setUTCDate(date.getUTCDate() + days);

  return date.toISOString().slice(0, 10);
}

export function isFixtureWithinDateRange(
  date: string,
  timeZone: string,
  startDate: string,
  endDate: string
) {
  const localDate = getFixtureDateInTimeZone(date, timeZone);
  return localDate >= startDate && localDate <= endDate;
}

export function formatMatchDateTime(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(date));
}

export function formatMatchTime(date: string, timeZone: string) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(date));
}
