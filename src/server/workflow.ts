import type { ForwardResult, NotionOnlyResult, PendingForward } from "../shared/types";
import { extractReservationJson, generateForwardEmail, type SourceEmail } from "./services/ai";
import { audit } from "./services/audit";
import { normalizeReservationDates } from "./services/date-normalization";
import { convertToJpy } from "./services/exchange";
import { ensureSendAsAlias, extractLowerRateButtonUrl, fetchCandidateEmails, isLowerRateEmail, markProcessed, sendForward } from "./services/gmail";
import { extractTopHotelSlashOffer } from "./services/hotelslash";
import { extractReservationConfirmationUrl } from "./services/links";
import {
  createLowPriceProposalRecord,
  findNonHotelSlashBookingSiteForCheckIn,
  createReservationRecord,
  hasCheckedHotelArrangementForCheckIn,
  ensureReservationDatabaseSchema,
  findLatestProposalByNameAndCheckIn,
  findRelatedReservation,
  updateReservationEmailType
} from "./services/notion";

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
    if (isLowerRateEmail(email)) {
      const lowPriceItem = await buildLowPriceProposal(email, log);
      pending.set(lowPriceItem.id, lowPriceItem);
      results.push(lowPriceItem);
      continue;
    }
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
  const hotelArrangement = await hasCheckedHotelArrangementForCheckIn(item.metadata.checkIn);
  if (hotelArrangement) {
    item.auditLog.push(audit("notion.match", "ok", "Inherited checked Hotel Arrangement from same Check-in"));
  }
  const notionPageId = await createReservationRecord(item, { tripIt: now, hotelSlash: now, hotelArrangement });
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

export async function registerForwardInNotionOnly(id: string, tokens?: unknown): Promise<NotionOnlyResult> {
  const item = pending.get(id);
  if (!item) throw new Error("Pending forward was not found");
  if (item.kind === "lowPriceProposal") throw new Error("Low price proposals cannot be registered with this action.");
  item.auditLog.push(audit("approval", "ok", "User registered generated body in Notion without forwarding"));
  await ensureReservationDatabaseSchema();
  item.auditLog.push(audit("notion.schema", "ok", "Verified Notion reservation history database schema"));
  const hotelArrangement = await hasCheckedHotelArrangementForCheckIn(item.metadata.checkIn);
  if (hotelArrangement) {
    item.auditLog.push(audit("notion.match", "ok", "Inherited checked Hotel Arrangement from same Check-in"));
  }
  const notionPageId = await createReservationRecord(item, { hotelArrangement });
  item.auditLog.push(audit("notion.create", "ok", "Created Notion reservation history record without forwarding", { notionPageId }));
  await markProcessed(tokens, item.gmailMessageId);
  item.auditLog.push(audit("gmail.label", "ok", "Applied processed Gmail label"));
  processedMessageIds.add(item.gmailMessageId);
  const reservationKey = getReservationKeyFromMetadata(item.metadata);
  if (reservationKey) processedReservationKeys.add(reservationKey);
  item.state = "processed";
  removePendingByMessageId(item.gmailMessageId);
  if (reservationKey) removePendingByReservationKey(reservationKey);
  return { item, notionPageId, hotelArrangement };
}

export async function decideLowPriceProposal(
  id: string,
  decision: "accepted" | "unaccepted",
  tokens?: unknown
): Promise<{ item: PendingForward; notionPageId?: string }> {
  const item = pending.get(id);
  if (!item) throw new Error("Pending low price proposal was not found");
  if (item.kind !== "lowPriceProposal" || !item.proposal?.notionPageId) {
    throw new Error("Selected item is not a low price proposal.");
  }
  const emailType = decision === "accepted" ? "Proposal accepted" : "Proposal Unaccepted";
  item.auditLog.push(audit("approval", "ok", `User marked low price proposal as ${emailType}`));
  const hotelArrangement = await hasCheckedHotelArrangementForCheckIn(item.metadata.checkIn);
  if (hotelArrangement) {
    item.auditLog.push(audit("notion.match", "ok", "Inherited checked Hotel Arrangement from same Check-in"));
  }
  await updateReservationEmailType(item.proposal.notionPageId, emailType, { hotelArrangement });
  item.proposal.hotelArrangement = hotelArrangement;
  item.auditLog.push(audit("notion.update", "ok", "Updated proposal Email Type", { emailType, hotelArrangement }));
  await markProcessed(tokens, item.gmailMessageId);
  item.auditLog.push(audit("gmail.label", "ok", "Applied processed Gmail label"));
  processedMessageIds.add(item.gmailMessageId);
  item.metadata.emailType = emailType;
  item.state = "processed";
  removePendingByMessageId(item.gmailMessageId);
  return { item, notionPageId: item.proposal.notionPageId };
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

async function buildLowPriceProposal(email: SourceEmail, log: PendingForward["auditLog"]) {
  const metadata = normalizeReservationDates(await extractReservationJson(email), email.receivedAt);
  metadata.bookingSite = "HotelSlash";
  metadata.status = "Price Alert";
  metadata.emailType = "Low Price Proposal";
  metadata.reservationConfirmationUrl ??= extractReservationConfirmationUrl(email.body);
  log.push(audit("ai.extract", "ok", "Extracted HotelSlash low price email metadata"));

  const ratesUrl = extractLowerRateButtonUrl(email.body);
  if (!ratesUrl) throw new Error("HotelSlash rates button URL could not be found in the email body.");
  log.push(audit("hotelslash.link", "ok", "Extracted HotelSlash rates button URL"));

  const offer = await extractTopHotelSlashOffer(ratesUrl);
  log.push(audit("hotelslash.render", "ok", "Rendered HotelSlash rates page and extracted top offer"));
  metadata.room = offer.roomType;
  metadata.originalCurrency = offer.priceCurrency;
  metadata.originalAmount = offer.priceAmount;
  if (offer.priceCurrency === "JPY") metadata.jpyAmount = offer.priceAmount;
  metadata.cancellationPolicy = offer.conditions.join(", ");

  const previousProposal = await findLatestProposalByNameAndCheckIn(metadata);
  if (previousProposal) {
    log.push(audit("notion.match", "ok", "Found latest prior proposal with the same Name and Check-in", { pageId: previousProposal.pageId }));
  }
  const hotelArrangement = await hasCheckedHotelArrangementForCheckIn(metadata.checkIn);
  log.push(
    audit("notion.arrangement", "ok", "Checked Hotel Arrangement for the same Check-in", {
      checkIn: metadata.checkIn,
      hotelArrangement
    })
  );
  const bookingSite = metadata.bookingSite === "HotelSlash" ? (await findNonHotelSlashBookingSiteForCheckIn(metadata.checkIn)) ?? metadata.bookingSite : metadata.bookingSite;
  log.push(audit("notion.bookingSite", "ok", "Resolved booking site for proposal display", { checkIn: metadata.checkIn, bookingSite }));
  const relatedReservationId = await findRelatedReservation(metadata);
  const item: PendingForward = {
    id: crypto.randomUUID(),
    kind: "lowPriceProposal",
    gmailMessageId: email.id,
    gmailUrl: `https://mail.google.com/mail/u/0/#inbox/${email.id}`,
    from: email.from,
    receivedAt: email.receivedAt,
    subject: email.subject,
    metadata,
    generatedSubject: `Low Price Proposal - ${metadata.hotelName}`,
    generatedBody: [
      `Hotel: ${metadata.hotelName}`,
      `Stay: ${metadata.checkIn ?? "TBD"} - ${metadata.checkOut ?? "TBD"}`,
      `Proposed Price: ${offer.priceCurrency} ${offer.priceAmount.toLocaleString("ja-JP")}`,
      `Room Type: ${offer.roomType}`,
      `Conditions: ${offer.conditions.join(", ") || "Not provided"}`
    ].join("\n"),
    internalJson: metadata,
    proposal: { ...offer, previousProposal, hotelArrangement, bookingSite },
    state: "pending",
    auditLog: log
  };
  const notionPageId = await createLowPriceProposalRecord(item, relatedReservationId);
  item.proposal = { ...item.proposal!, notionPageId };
  item.auditLog.push(audit("notion.create", "ok", "Created Low Price Proposal record", { notionPageId }));
  return item;
}

function cleanKeyPart(value?: string) {
  if (!value || value === "[Redacted]" || value === "Not provided") return undefined;
  return value.trim().toLowerCase();
}
