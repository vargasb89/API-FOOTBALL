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

export function getDateInputValueInTimeZone(date: Date, timeZone: string) {
  const formatter = buildFormatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
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
