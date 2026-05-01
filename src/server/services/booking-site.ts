import type { SourceEmail } from "./ai";

const bookingSites = [
  { name: "Expedia", patterns: [/expedia/i] },
  { name: "Booking.com", patterns: [/booking\.com/i] },
  { name: "Agoda", patterns: [/agoda/i] },
  { name: "Hotels.com", patterns: [/hotels\.com/i] },
  { name: "Trip.com", patterns: [/trip\.com/i, /ctrip/i] },
  { name: "Rakuten Travel", patterns: [/travel\.rakuten/i, /rakuten travel/i, /楽天トラベル/] },
  { name: "Jalan", patterns: [/jalan/i, /じゃらん/] }
];

export function inferBookingSiteFromEmail(email: SourceEmail): string | undefined {
  return inferBookingSite([email.from, email.subject, email.body]);
}

export function inferBookingSite(values: Array<string | undefined>): string | undefined {
  const text = values.filter(Boolean).join("\n");
  return bookingSites.find((site) => site.patterns.some((pattern) => pattern.test(text)))?.name;
}
