import type { ForwardResult, PendingForward } from "../shared/types";
import { extractReservationJson, generateForwardEmail } from "./services/ai";
import { audit } from "./services/audit";
import { normalizeReservationDates } from "./services/date-normalization";
import { convertToJpy } from "./services/exchange";
import { ensureSendAsAlias, fetchCandidateEmails, markProcessed, sendForward } from "./services/gmail";
import { extractReservationConfirmationUrl } from "./services/links";
import { createReservationRecord, ensureReservationDatabaseSchema, findRelatedReservation } from "./services/notion";

const pending = new Map<string, PendingForward>();
const excludedMessageIds = new Set<string>();
const processedMessageIds = new Set<string>();
const excludedReservationKeys = new Set<string>();
const processedReservationKeys = new Set<string>();

export async function syncReservations(tokens?: unknown): Promise<PendingForward[]> {
  const emails = await fetchCandidateEmails(tokens);
  const results: PendingForward[] = [];

  for (const email of emails) {
    if (processedMessageIds.has(email.id)) continue;
    if (excludedMessageIds.has(email.id)) continue;
    if ([...pending.values()].some((item) => item.gmailMessageId === email.id)) continue;
    const log = [audit("gmail.fetch", "ok", "Fetched candidate Gmail message", { messageId: email.id })];
    const metadata = normalizeReservationDates(await extractReservationJson(email), email.receivedAt);
    metadata.reservationConfirmationUrl ??= extractReservationConfirmationUrl(email.body);
    log.push(audit("ai.extract", "ok", "Extracted internal reservation JSON"));
    const reservationKey = getReservationKeyFromMetadata(metadata);
    if (reservationKey && (processedReservationKeys.has(reservationKey) || excludedReservationKeys.has(reservationKey))) continue;
    if (reservationKey && [...pending.values()].some((item) => getReservationKeyFromMetadata(item.metadata) === reservationKey)) continue;
    const quote = await convertToJpy(metadata.originalCurrency, metadata.originalAmount);
    if (quote) {
      metadata.exchangeRate = quote.rate;
      metadata.exchangeRateDate = quote.date;
      metadata.jpyAmount = quote.jpyAmount;
      log.push(audit("exchange.convert", "ok", "Converted original amount to JPY"));
    }
    const relatedReservationId = await findRelatedReservation(metadata);
    if (relatedReservationId) {
      metadata.relatedReservationId = relatedReservationId;
      log.push(audit("notion.relate", "ok", "Matched HotelSlash price alert to an existing reservation", { relatedReservationId }));
    }
    const generated = await generateForwardEmail(metadata);
    log.push(audit("ai.generate", "ok", "Generated redacted English forward body"));
    const item: PendingForward = {
      id: crypto.randomUUID(),
      gmailMessageId: email.id,
      gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${email.id}`,
      from: email.from,
      receivedAt: email.receivedAt,
      subject: email.subject,
      metadata,
      generatedSubject: generated.subject,
      generatedBody: generated.body,
      internalJson: metadata,
      state: "pending",
      auditLog: log
    };
    pending.set(item.id, item);
    results.push(item);
  }

  return [...pending.values()].filter((item) => item.state === "pending");
}

export function listPending() {
  return dedupePending();
}

export async function dismissForwardAndReload(id: string, tokens?: unknown): Promise<PendingForward[]> {
  const item = pending.get(id);
  if (!item) throw new Error("Pending forward was not found");
  excludedMessageIds.add(item.gmailMessageId);
  const reservationKey = getReservationKeyFromMetadata(item.metadata);
  if (reservationKey) excludedReservationKeys.add(reservationKey);
  pending.delete(id);
  return syncReservations(tokens);
}

export async function approveForward(id: string, editedBody: string, tokens?: unknown): Promise<ForwardResult> {
  const item = pending.get(id);
  if (!item) throw new Error("Pending forward was not found");
  item.auditLog.push(audit("approval", "ok", "User approved generated body"));
  await ensureReservationDatabaseSchema();
  item.auditLog.push(audit("notion.schema", "ok", "Verified Notion reservation history database schema"));
  await ensureSendAsAlias(tokens);
  item.auditLog.push(audit("gmail.alias", "ok", "Verified Gmail send-as alias"));
  await sendForward(tokens, item, editedBody);
  const now = new Date().toISOString();
  item.auditLog.push(audit("gmail.send", "ok", "Forwarded email to TripIt and HotelSlash"));
  const notionPageId = await createReservationRecord(item, { tripIt: now, hotelSlash: now });
  item.auditLog.push(audit("notion.create", "ok", "Created Notion reservation history record", { notionPageId }));
  await markProcessed(tokens, item.gmailMessageId);
  item.auditLog.push(audit("gmail.label", "ok", "Applied processed Gmail label"));
  processedMessageIds.add(item.gmailMessageId);
  const reservationKey = getReservationKeyFromMetadata(item.metadata);
  if (reservationKey) processedReservationKeys.add(reservationKey);
  item.state = "processed";
  removePendingByMessageId(item.gmailMessageId);
  if (reservationKey) removePendingByReservationKey(reservationKey);
  return { item, tripItSentAt: now, hotelSlashSentAt: now, notionPageId };
}

function dedupePending() {
  const seen = new Set<string>();
  const seenReservationKeys = new Set<string>();
  for (const [id, item] of pending.entries()) {
    const reservationKey = getReservationKeyFromMetadata(item.metadata);
    if (item.state !== "pending" || processedMessageIds.has(item.gmailMessageId) || excludedMessageIds.has(item.gmailMessageId)) {
      pending.delete(id);
      continue;
    }
    if (reservationKey && (processedReservationKeys.has(reservationKey) || excludedReservationKeys.has(reservationKey))) {
      pending.delete(id);
      continue;
    }
    if (seen.has(item.gmailMessageId)) {
      pending.delete(id);
      continue;
    }
    if (reservationKey && seenReservationKeys.has(reservationKey)) {
      pending.delete(id);
      continue;
    }
    seen.add(item.gmailMessageId);
    if (reservationKey) seenReservationKeys.add(reservationKey);
  }
  return [...pending.values()].filter((item) => item.state === "pending");
}

function removePendingByMessageId(messageId: string) {
  for (const [id, item] of pending.entries()) {
    if (item.gmailMessageId === messageId) {
      pending.delete(id);
    }
  }
}

function removePendingByReservationKey(reservationKey: string) {
  for (const [id, item] of pending.entries()) {
    if (getReservationKeyFromMetadata(item.metadata) === reservationKey) {
      pending.delete(id);
    }
  }
}

function getReservationKeyFromMetadata(metadata: PendingForward["metadata"]) {
  const reservationNumber = cleanKeyPart(metadata.reservationNumber);
  if (reservationNumber) return `reservation:${reservationNumber}`;
  const hotelName = cleanKeyPart(metadata.hotelName);
  const checkIn = cleanKeyPart(metadata.checkIn);
  const checkOut = cleanKeyPart(metadata.checkOut);
  if (hotelName && checkIn && checkOut) return `stay:${hotelName}:${checkIn}:${checkOut}`;
  return undefined;
}

function cleanKeyPart(value?: string) {
  if (!value || value === "[Redacted]" || value === "Not provided") return undefined;
  return value.trim().toLowerCase();
}
