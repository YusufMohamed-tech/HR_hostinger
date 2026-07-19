export type BusinessDateParts = {
  year: number;
  month: number;
  day: number;
};

export type UtcRange = {
  start: Date;
  end: Date;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  const existing = formatterCache.get(timeZone);
  if (existing) return existing;

  assertValidTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function finiteDate(instant: Date | string | number) {
  const date = instant instanceof Date ? new Date(instant.getTime()) : new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid instant.");
  return date;
}

function padded(value: number) {
  return String(value).padStart(2, "0");
}

function validateDateParts(parts: BusinessDateParts) {
  const normalized = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    !Number.isInteger(parts.year)
    || !Number.isInteger(parts.month)
    || !Number.isInteger(parts.day)
    || normalized.getUTCFullYear() !== parts.year
    || normalized.getUTCMonth() + 1 !== parts.month
    || normalized.getUTCDate() !== parts.day
  ) {
    throw new RangeError("Invalid business date.");
  }
}

function localDateTimeParts(instant: Date, timeZone: string) {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function addCalendarDays(parts: BusinessDateParts, days: number): BusinessDateParts {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function localMidnightUtc(parts: BusinessDateParts, timeZone: string) {
  validateDateParts(parts);
  const desiredAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let candidate = desiredAsUtc;

  // Intl exposes zone conversion in the UTC -> local direction. Iterating the
  // observed offset gives the inverse without relying on the process timezone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localDateTimeParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second
    );
    const correction = desiredAsUtc - observedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  const resolved = new Date(candidate);
  const observed = localDateTimeParts(resolved, timeZone);
  if (
    observed.year !== parts.year
    || observed.month !== parts.month
    || observed.day !== parts.day
    || observed.hour !== 0
    || observed.minute !== 0
    || observed.second !== 0
  ) {
    throw new RangeError(`Local midnight does not exist in timezone ${timeZone}.`);
  }

  return resolved;
}

export function assertValidTimeZone(timeZone: string) {
  if (!timeZone.trim()) throw new RangeError("Timezone is required.");
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format(0);
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }
}

export function businessDatePartsAt(
  instant: Date | string | number,
  timeZone: string
): BusinessDateParts {
  const parts = localDateTimeParts(finiteDate(instant), timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function businessDateAt(instant: Date | string | number, timeZone: string) {
  const { year, month, day } = businessDatePartsAt(instant, timeZone);
  return `${year}-${padded(month)}-${padded(day)}`;
}

export function zonedDateTimeToUtc(localDateTime: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) throw new RangeError("Local date-time must use YYYY-MM-DDTHH:mm:ss.");
  const desired = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
  };
  validateDateParts(desired);
  if (desired.hour > 23 || desired.minute > 59 || desired.second > 59) {
    throw new RangeError("Invalid local time.");
  }
  const desiredAsUtc = Date.UTC(
    desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second
  );
  let candidate = desiredAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localDateTimeParts(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(
      observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second
    );
    const correction = desiredAsUtc - observedAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }
  const resolved = new Date(candidate);
  const observed = localDateTimeParts(resolved, timeZone);
  if (Object.entries(desired).some(([key, value]) => observed[key as keyof typeof observed] !== value)) {
    throw new RangeError(`Local date-time does not exist in timezone ${timeZone}.`);
  }
  return resolved;
}

export function parseBusinessDate(value: string): BusinessDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Business date must use YYYY-MM-DD.");
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  validateDateParts(parts);
  return parts;
}

export function businessDayUtcRange(businessDate: string, timeZone: string): UtcRange {
  const startParts = parseBusinessDate(businessDate);
  return {
    start: localMidnightUtc(startParts, timeZone),
    end: localMidnightUtc(addCalendarDays(startParts, 1), timeZone),
  };
}

export function businessMonthUtcRange(
  year: number,
  month: number,
  timeZone: string
): UtcRange {
  const startParts = { year, month, day: 1 };
  validateDateParts(startParts);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const endParts = {
    year: nextMonth.getUTCFullYear(),
    month: nextMonth.getUTCMonth() + 1,
    day: 1,
  };
  return {
    start: localMidnightUtc(startParts, timeZone),
    end: localMidnightUtc(endParts, timeZone),
  };
}
