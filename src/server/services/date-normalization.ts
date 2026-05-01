import type { ReservationMetadata } from "../../shared/types";

const monthLookup: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};

export function normalizeReservationDates(metadata: ReservationMetadata, receivedAt: string): ReservationMetadata {
  const referenceYear = new Date(receivedAt).getUTCFullYear();
  const checkIn = normalizeDate(metadata.checkIn, referenceYear);
  let checkOut = normalizeDate(metadata.checkOut, checkIn?.year ?? referenceYear);

  if (checkIn && checkOut && checkOut.iso < checkIn.iso) {
    checkOut = normalizeDate(metadata.checkOut, checkIn.year + 1);
  }

  return {
    ...metadata,
    checkIn: checkIn?.iso ?? metadata.checkIn,
    checkOut: checkOut?.iso ?? metadata.checkOut
  };
}

function normalizeDate(value: string | undefined, fallbackYear: number): { iso: string; year: number } | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const iso = trimmed.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, year: Number(iso[1]) };

  const monthDayYear = trimmed.match(/\b(?:mon|tue|wed|thu|fri|sat|sun)?[,]?\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:[,]?\s+(\d{4}))?\b/i);
  if (monthDayYear) {
    const month = monthLookup[monthDayYear[1].toLowerCase()];
    if (!month) return undefined;
    const year = Number(monthDayYear[3] ?? fallbackYear);
    return { iso: `${year}-${month}-${monthDayYear[2].padStart(2, "0")}`, year };
  }

  const slashDate = trimmed.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashDate) {
    const year = slashDate[3] ? normalizeYear(slashDate[3]) : fallbackYear;
    return { iso: `${year}-${slashDate[1].padStart(2, "0")}-${slashDate[2].padStart(2, "0")}`, year };
  }

  return undefined;
}

function normalizeYear(value: string) {
  if (value.length === 4) return Number(value);
  return Number(value) + 2000;
}
