import { extractReservationConfirmationUrl } from "./links";
import { fetchEmailByMessageId, searchEmailsByReservationNumber } from "./gmail";
import { inferBookingSite } from "./booking-site";
import { listReservationPagesMissingBookingSite, listReservationPagesMissingConfirmationUrl, updateReservationBookingSite, updateReservationConfirmationUrl } from "./notion";

export interface ConfirmationUrlBackfillCandidate {
  pageId: string;
  title: string;
  reservationNumber?: string;
  originalGmailMessageId?: string;
  url?: string;
  sourceMessageId?: string;
  status: "ready" | "not_found";
}

export interface BookingSiteBackfillCandidate {
  pageId: string;
  title: string;
  reservationNumber?: string;
  originalGmailMessageId?: string;
  bookingSite?: string;
  sourceMessageId?: string;
  status: "ready" | "not_found";
}

export async function planConfirmationUrlBackfill(tokens: unknown): Promise<ConfirmationUrlBackfillCandidate[]> {
  const pages = await listReservationPagesMissingConfirmationUrl();
  const candidates: ConfirmationUrlBackfillCandidate[] = [];

  for (const page of pages) {
    const email = page.originalGmailMessageId
      ? await fetchEmailByMessageId(tokens, page.originalGmailMessageId)
      : undefined;
    const fallbackEmail = !email && page.reservationNumber ? (await searchEmailsByReservationNumber(tokens, page.reservationNumber))[0] : undefined;
    const sourceEmail = email ?? fallbackEmail;
    const url = sourceEmail ? extractReservationConfirmationUrl(sourceEmail.body) : undefined;

    candidates.push({
      pageId: page.pageId,
      title: page.title,
      reservationNumber: page.reservationNumber,
      originalGmailMessageId: page.originalGmailMessageId,
      url,
      sourceMessageId: sourceEmail?.id,
      status: url ? "ready" : "not_found"
    });
  }

  return candidates;
}

export async function applyConfirmationUrlBackfill(tokens: unknown) {
  const candidates = await planConfirmationUrlBackfill(tokens);
  const ready = candidates.filter((candidate) => candidate.status === "ready" && candidate.url);

  for (const candidate of ready) {
    await updateReservationConfirmationUrl(candidate.pageId, candidate.url!);
  }

  return {
    updated: ready.length,
    candidates
  };
}

export async function planBookingSiteBackfill(tokens?: unknown): Promise<BookingSiteBackfillCandidate[]> {
  const pages = await listReservationPagesMissingBookingSite();
  const candidates: BookingSiteBackfillCandidate[] = [];

  for (const page of pages) {
    const email = page.originalGmailMessageId && tokens ? await fetchEmailByMessageId(tokens, page.originalGmailMessageId) : undefined;
    const fallbackEmail = !email && page.reservationNumber && tokens ? (await searchEmailsByReservationNumber(tokens, page.reservationNumber))[0] : undefined;
    const sourceEmail = email ?? fallbackEmail;
    const parsedInternalJson = parseInternalJson(page.internalJson);
    const bookingSite =
      parsedInternalJson?.bookingSite ??
      inferBookingSite([
        page.reservationConfirmationUrl,
        page.aiGeneratedBody,
        page.internalJson,
        page.title,
        page.reservationNumber,
        sourceEmail?.from,
        sourceEmail?.subject,
        sourceEmail?.body
      ]);

    candidates.push({
      pageId: page.pageId,
      title: page.title,
      reservationNumber: page.reservationNumber,
      originalGmailMessageId: page.originalGmailMessageId,
      bookingSite,
      sourceMessageId: sourceEmail?.id,
      status: bookingSite ? "ready" : "not_found"
    });
  }

  return candidates;
}

export async function applyBookingSiteBackfill(tokens?: unknown) {
  const candidates = await planBookingSiteBackfill(tokens);
  const ready = candidates.filter((candidate) => candidate.status === "ready" && candidate.bookingSite);

  for (const candidate of ready) {
    await updateReservationBookingSite(candidate.pageId, candidate.bookingSite!);
  }

  return {
    updated: ready.length,
    candidates
  };
}

function parseInternalJson(value?: string): { bookingSite?: string } | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { bookingSite?: unknown };
    return typeof parsed.bookingSite === "string" ? { bookingSite: parsed.bookingSite } : undefined;
  } catch {
    return undefined;
  }
}
