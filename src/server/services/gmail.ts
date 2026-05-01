import { google, gmail_v1 } from "googleapis";
import type { PendingForward } from "../../shared/types";
import { config } from "../config";
import type { SourceEmail } from "./ai";

export const labels = {
  pending: "ZenForwarder/Pending",
  processed: "ZenForwarder/Processed",
  error: "ZenForwarder/Error"
};

export function buildOAuthClient() {
  return new google.auth.OAuth2(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET, config.GOOGLE_REDIRECT_URI);
}

export function getAuthUrl() {
  return buildOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.settings.basic"
    ]
  });
}

export function isGmailConfigured() {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET);
}

export function hasGmailTokens(tokens?: unknown) {
  return Boolean(tokens && typeof tokens === "object");
}

export function buildCandidateQuery() {
  const terms = [
    "ホテル",
    "hotel",
    "reservation",
    "予約",
    "HotelSlash",
    "Expedia",
    "expedia",
    "itinerary",
    "confirmation",
    "\"travel confirmation\"",
    "\"hotel confirmed\""
  ].join(" ");
  return `in:inbox newer_than:7d -label:"${labels.processed}" -from:do-not-reply@tripit.com {${terms}}`;
}

export async function fetchCandidateEmails(tokens?: unknown): Promise<SourceEmail[]> {
  if (!isGmailConfigured()) return mockEmails();
  if (!hasGmailTokens(tokens)) {
    throw new Error("Gmail is not connected. Click Gmail連携してから同期してください。");
  }
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  const query = buildCandidateQuery();
  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 10 });
  const messages = list.data.messages ?? [];
  const emails = await Promise.all(messages.map((message) => fetchMessage(gmail, message.id ?? "")));
  return emails.filter((email) => !isSelfGeneratedForward(email));
}

export async function fetchEmailByMessageId(tokens: unknown, messageId: string): Promise<SourceEmail | undefined> {
  if (!isGmailConfigured() || !hasGmailTokens(tokens)) return undefined;
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  return fetchMessage(gmail, messageId);
}

export async function searchEmailsByReservationNumber(tokens: unknown, reservationNumber: string): Promise<SourceEmail[]> {
  if (!isGmailConfigured() || !hasGmailTokens(tokens)) return [];
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  const query = `in:inbox newer_than:30d "${reservationNumber}" -label:"${labels.processed}"`;
  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 5 });
  const messages = list.data.messages ?? [];
  const emails = await Promise.all(messages.map((message) => fetchMessage(gmail, message.id ?? "")));
  return emails.filter((email) => !isSelfGeneratedForward(email));
}

export async function ensureSendAsAlias(tokens: unknown): Promise<void> {
  if (!config.GOOGLE_CLIENT_ID || !tokens) return;
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  const aliases = await gmail.users.settings.sendAs.list({ userId: "me" });
  const match = aliases.data.sendAs?.find((item) => item.sendAsEmail === config.FORWARD_FROM_EMAIL && item.verificationStatus === "accepted");
  if (!match) throw new Error(`${config.FORWARD_FROM_EMAIL} is not an accepted Gmail send-as alias.`);
}

export async function sendForward(tokens: unknown, item: PendingForward, editedBody: string): Promise<void> {
  if (!config.GOOGLE_CLIENT_ID || !tokens) return;
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  const originalRawEmail = await fetchRawMessage(gmail, item.gmailMessageId);
  const tripItRaw = createRawEmailWithOriginalAttachment(config.TRIPIT_FORWARD_EMAIL, item.generatedSubject, editedBody, originalRawEmail);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: tripItRaw } });

  const hotelSlashRaw = createRawEmail(config.HOTELSLASH_FORWARD_EMAIL, item.generatedSubject, editedBody);
  await gmail.users.messages.send({ userId: "me", requestBody: { raw: hotelSlashRaw } });
}

export async function markProcessed(tokens: unknown, messageId: string): Promise<void> {
  if (!config.GOOGLE_CLIENT_ID || !tokens) return;
  const auth = buildOAuthClient();
  auth.setCredentials(tokens as Parameters<typeof auth.setCredentials>[0]);
  const gmail = google.gmail({ version: "v1", auth });
  const processedLabelId = await ensureLabel(gmail, labels.processed);
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: [processedLabelId],
      removeLabelIds: ["INBOX"]
    }
  });
}

async function fetchMessage(gmail: gmail_v1.Gmail, id: string): Promise<SourceEmail> {
  const message = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const headers = message.data.payload?.headers ?? [];
  const subject = headers.find((header) => header.name?.toLowerCase() === "subject")?.value ?? "(no subject)";
  const from = headers.find((header) => header.name?.toLowerCase() === "from")?.value ?? "";
  const date = headers.find((header) => header.name?.toLowerCase() === "date")?.value ?? new Date().toISOString();
  return {
    id,
    subject,
    from,
    receivedAt: new Date(date).toISOString(),
    body: decodeBody(message.data.payload)
  };
}

async function fetchRawMessage(gmail: gmail_v1.Gmail, id: string): Promise<string> {
  const message = await gmail.users.messages.get({ userId: "me", id, format: "raw" });
  if (!message.data.raw) throw new Error("Original Gmail message could not be loaded for TripIt attachment.");
  return message.data.raw;
}

async function ensureLabel(gmail: gmail_v1.Gmail, name: string): Promise<string> {
  const labelsResponse = await gmail.users.labels.list({ userId: "me" });
  const existing = labelsResponse.data.labels?.find((label) => label.name === name);
  if (existing?.id) return existing.id;
  const created = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelShow" } });
  if (!created.data.id) throw new Error(`Failed to create Gmail label ${name}`);
  return created.data.id;
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part.parts ?? []).map(decodeBody).filter(Boolean).join("\n\n");
}

function createRawEmail(to: string, subject: string, body: string) {
  const message = [
    `From: ${config.FORWARD_FROM_EMAIL}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

export function createRawEmailWithOriginalAttachment(to: string, subject: string, body: string, originalRawEmail: string) {
  const boundary = `zenforwarder-${crypto.randomUUID()}`;
  const originalEmailBase64 = wrapBase64(Buffer.from(originalRawEmail, "base64url").toString("base64"));
  const message = [
    `From: ${config.FORWARD_FROM_EMAIL}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
    `--${boundary}`,
    'Content-Type: message/rfc822; name="original-confirmation.eml"',
    'Content-Disposition: attachment; filename="original-confirmation.eml"',
    "Content-Transfer-Encoding: base64",
    "",
    originalEmailBase64,
    "",
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function isSelfGeneratedForward(email: SourceEmail) {
  return email.subject.startsWith("Hotel Reservation - ") && email.body.includes("Original Email Type:");
}

function mockEmails(): SourceEmail[] {
  return [
    {
      id: "mock-gmail-001",
      from: "booking@example.jp",
      subject: "ホテル予約確認: Sample Hotel Tokyo",
      receivedAt: new Date().toISOString(),
      body: [
        "ホテル: Sample Hotel Tokyo",
        "住所: 1-1-1 Marunouchi, Tokyo, Japan",
        "電話: +81-3-0000-0000",
        "予約番号: ZEN-2026-001",
        "チェックイン: 2026-06-12",
        "チェックアウト: 2026-06-15",
        "料金: JPY 42000",
        "宿泊者: Taro Yamada"
      ].join("\n")
    }
  ];
}
