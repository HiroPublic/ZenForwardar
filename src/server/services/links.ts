const hrefPattern = /\bhref=["']([^"']+)["']/gi;
const plainUrlPattern = /https?:\/\/[^\s"'<>]+/gi;

const confirmationHints = [
  "itinerary",
  "confirmation",
  "reservation",
  "booking",
  "trip",
  "view",
  "detail",
  "expedia",
  "hotels"
];

const lowValueHints = [
  "unsubscribe",
  "privacy",
  "terms",
  "facebook",
  "twitter",
  "instagram",
  "youtube",
  "linkedin",
  "doubleclick",
  "google-analytics"
];

export function extractReservationConfirmationUrl(body: string): string | undefined {
  const urls = extractUrls(body);
  if (urls.length === 0) return undefined;

  const scored = urls
    .map((url) => ({ url, score: scoreUrl(url) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.url;
}

function extractUrls(body: string) {
  const urls = new Set<string>();
  for (const match of body.matchAll(hrefPattern)) {
    const decoded = normalizeUrl(match[1]);
    if (decoded) urls.add(decoded);
  }
  for (const match of body.matchAll(plainUrlPattern)) {
    const decoded = normalizeUrl(match[0]);
    if (decoded) urls.add(decoded);
  }
  return [...urls];
}

function normalizeUrl(value: string) {
  const decoded = decodeHtmlEntities(value).replace(/[).,\]]+$/g, "");
  try {
    const url = new URL(decoded);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function scoreUrl(url: string) {
  const lower = url.toLowerCase();
  if (lowValueHints.some((hint) => lower.includes(hint))) return 0;
  return confirmationHints.reduce((score, hint) => score + (lower.includes(hint) ? 1 : 0), 0);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
