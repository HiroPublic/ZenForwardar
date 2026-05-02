import { Client } from "@notionhq/client";
import type { EmailType, PendingForward, PreviousProposal, ReservationMetadata } from "../../shared/types";
import { config } from "../config";

const notion = config.NOTION_API_KEY ? new Client({ auth: config.NOTION_API_KEY }) : undefined;
type NotionProperties = Record<string, Record<string, unknown>>;

const requiredDatabaseProperties = {
  "Hotel Name": { rich_text: {} },
  "Booking Site": { rich_text: {} },
  "Reservation Number": { rich_text: {} },
  "Guest Name": { rich_text: {} },
  "Adult Count": { number: { format: "number" } },
  "Child Count": { number: { format: "number" } },
  "Reservation Confirmation URL": { url: {} },
  Status: {
    select: {
      options: [
        { name: "Confirmed", color: "green" },
        { name: "Modified", color: "yellow" },
        { name: "Cancelled", color: "red" },
        { name: "Price Alert", color: "blue" }
      ]
    }
  },
  "Email Type": {
    select: {
      options: [
        { name: "Reservation Confirmation", color: "green" },
        { name: "Change Notice", color: "yellow" },
        { name: "Cancellation Notice", color: "red" },
        { name: "HotelSlash Price Alert", color: "blue" },
        { name: "Low Price Proposal", color: "purple" },
        { name: "Proposal accepted", color: "green" },
        { name: "Proposal Unaccepted", color: "gray" }
      ]
    }
  },
  "Check-in": { date: {} },
  "Check-out": { date: {} },
  Nights: { number: { format: "number" } },
  "Original Currency": { rich_text: {} },
  "Original Amount": { number: { format: "number" } },
  "JPY Amount": { number: { format: "number" } },
  "Exchange Rate": { number: { format: "number" } },
  "Exchange Rate Date": { date: {} },
  "Hotel Address": { rich_text: {} },
  "Hotel Phone": { rich_text: {} },
  "Hotel Arrangement": { checkbox: {} },
  "Original Gmail Message ID": { rich_text: {} },
  "Original Gmail URL": { url: {} },
  "Forwarded To TripIt At": { date: {} },
  "Forwarded To HotelSlash At": { date: {} },
  "Gmail Processed Label": { rich_text: {} },
  "Proposal Room Type": { rich_text: {} },
  "Proposal Conditions": { rich_text: {} },
  "AI Generated Body": { rich_text: {} },
  "Internal JSON": { rich_text: {} },
  "Audit Log": { rich_text: {} },
  "Created At": { date: {} },
  "Updated At": { date: {} }
} as const;

export async function ensureReservationDatabaseSchema() {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return undefined;

  const schema = await notion.databases.retrieve({ database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID });
  const availableProperties = schema.properties ?? {};
  const missingProperties = Object.fromEntries(
    Object.entries(requiredDatabaseProperties).filter(([name]) => !(name in availableProperties))
  );

  if (!("Related Reservation" in availableProperties)) {
    Object.assign(missingProperties, {
      "Related Reservation": {
        relation: {
          database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
          type: "single_property",
          single_property: {}
        }
      }
    });
  }

  if (Object.keys(missingProperties).length > 0) {
    await notion.databases.update({
      database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
      properties: missingProperties as Parameters<typeof notion.databases.update>[0]["properties"]
    });
    return notion.databases.retrieve({ database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID });
  }

  return schema;
}

export async function createReservationRecord(
  item: PendingForward,
  options: { tripIt?: string; hotelSlash?: string; hotelArrangement?: boolean } = {}
) {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return `mock-notion-${item.id}`;
  const metadata = item.metadata;
  const schema = await ensureReservationDatabaseSchema();
  if (!schema) return `mock-notion-${item.id}`;
  const availableProperties = schema.properties ?? {};
  const titlePropertyName = Object.entries(availableProperties).find(([, property]) => property.type === "title")?.[0] ?? "Name";
  const properties: NotionProperties = {
    [titlePropertyName]: { title: [{ text: { content: `${metadata.hotelName} - ${metadata.checkIn ?? "TBD"}` } }] }
  };
  addIfAvailable(properties, availableProperties, "Hotel Name", { rich_text: [{ text: { content: metadata.hotelName } }] });
  addIfAvailable(properties, availableProperties, "Booking Site", { rich_text: [{ text: { content: metadata.bookingSite ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Reservation Number", { rich_text: [{ text: { content: metadata.reservationNumber ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Guest Name", { rich_text: [{ text: { content: metadata.guestName ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Adult Count", typeof metadata.adultCount === "number" ? { number: metadata.adultCount } : { number: null });
  addIfAvailable(properties, availableProperties, "Child Count", typeof metadata.childCount === "number" ? { number: metadata.childCount } : { number: null });
  addIfAvailable(properties, availableProperties, "Reservation Confirmation URL", { url: metadata.reservationConfirmationUrl ?? null });
  addIfAvailable(properties, availableProperties, "Status", { select: { name: metadata.status } });
  addIfAvailable(properties, availableProperties, "Email Type", { select: { name: metadata.emailType } });
  addIfAvailable(properties, availableProperties, "Check-in", metadata.checkIn ? { date: { start: metadata.checkIn } } : { date: null });
  addIfAvailable(properties, availableProperties, "Check-out", metadata.checkOut ? { date: { start: metadata.checkOut } } : { date: null });
  addIfAvailable(properties, availableProperties, "Nights", typeof metadata.nights === "number" ? { number: metadata.nights } : { number: null });
  addIfAvailable(properties, availableProperties, "Original Currency", { rich_text: [{ text: { content: metadata.originalCurrency ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Original Amount", typeof metadata.originalAmount === "number" ? { number: metadata.originalAmount } : { number: null });
  addIfAvailable(properties, availableProperties, "JPY Amount", typeof metadata.jpyAmount === "number" ? { number: metadata.jpyAmount } : { number: null });
  addIfAvailable(properties, availableProperties, "Exchange Rate", typeof metadata.exchangeRate === "number" ? { number: metadata.exchangeRate } : { number: null });
  addIfAvailable(properties, availableProperties, "Exchange Rate Date", metadata.exchangeRateDate ? { date: { start: metadata.exchangeRateDate } } : { date: null });
  addIfAvailable(properties, availableProperties, "Hotel Address", { rich_text: [{ text: { content: metadata.hotelAddress ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Hotel Phone", { rich_text: [{ text: { content: metadata.hotelPhone ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Hotel Arrangement", { checkbox: options.hotelArrangement ?? false });
  addIfAvailable(properties, availableProperties, "Original Gmail Message ID", { rich_text: [{ text: { content: item.gmailMessageId } }] });
  addIfAvailable(properties, availableProperties, "Original Gmail URL", { url: item.gmailUrl });
  addIfAvailable(properties, availableProperties, "Forwarded To TripIt At", options.tripIt ? { date: { start: options.tripIt } } : { date: null });
  addIfAvailable(properties, availableProperties, "Forwarded To HotelSlash At", options.hotelSlash ? { date: { start: options.hotelSlash } } : { date: null });
  addIfAvailable(properties, availableProperties, "Gmail Processed Label", { rich_text: [{ text: { content: "ZenForwarder/Processed" } }] });
  addIfAvailable(properties, availableProperties, "AI Generated Body", { rich_text: [{ text: { content: item.generatedBody.slice(0, 1900) } }] });
  addIfAvailable(properties, availableProperties, "Internal JSON", { rich_text: [{ text: { content: JSON.stringify(item.internalJson).slice(0, 1900) } }] });
  addIfAvailable(properties, availableProperties, "Audit Log", { rich_text: [{ text: { content: JSON.stringify(item.auditLog).slice(0, 1900) } }] });
  addIfAvailable(properties, availableProperties, "Created At", { date: { start: new Date().toISOString() } });
  addIfAvailable(properties, availableProperties, "Updated At", { date: { start: new Date().toISOString() } });

  const page = await notion.pages.create({
    parent: { database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID },
    properties: properties as Parameters<typeof notion.pages.create>[0]["properties"]
  });
  return page.id;
}

export async function createLowPriceProposalRecord(item: PendingForward, relatedReservationId?: string) {
  if (!item.proposal) throw new Error("Low price proposal details are missing.");
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return `mock-notion-${item.id}`;
  const metadata = item.metadata;
  const schema = await ensureReservationDatabaseSchema();
  if (!schema) return `mock-notion-${item.id}`;
  const availableProperties = schema.properties ?? {};
  const titlePropertyName = getTitlePropertyName(availableProperties);
  const now = new Date().toISOString();
  const properties: NotionProperties = {
    [titlePropertyName]: { title: [{ text: { content: getProposalTitle(metadata) } }] }
  };

  addIfAvailable(properties, availableProperties, "Hotel Name", { rich_text: [{ text: { content: metadata.hotelName } }] });
  addIfAvailable(properties, availableProperties, "Booking Site", { rich_text: [{ text: { content: "HotelSlash" } }] });
  addIfAvailable(properties, availableProperties, "Reservation Number", { rich_text: [{ text: { content: metadata.reservationNumber ?? "" } }] });
  addIfAvailable(properties, availableProperties, "Reservation Confirmation URL", { url: item.proposal.pageUrl });
  addIfAvailable(properties, availableProperties, "Status", { select: { name: "Price Alert" } });
  addIfAvailable(properties, availableProperties, "Email Type", { select: { name: "Low Price Proposal" } });
  addIfAvailable(properties, availableProperties, "Check-in", metadata.checkIn ? { date: { start: metadata.checkIn } } : { date: null });
  addIfAvailable(properties, availableProperties, "Check-out", metadata.checkOut ? { date: { start: metadata.checkOut } } : { date: null });
  addIfAvailable(properties, availableProperties, "Nights", typeof metadata.nights === "number" ? { number: metadata.nights } : { number: null });
  addIfAvailable(properties, availableProperties, "Original Currency", { rich_text: [{ text: { content: item.proposal.priceCurrency } }] });
  addIfAvailable(properties, availableProperties, "Original Amount", { number: item.proposal.priceAmount });
  addIfAvailable(properties, availableProperties, "JPY Amount", item.proposal.priceCurrency === "JPY" ? { number: item.proposal.priceAmount } : { number: null });
  addIfAvailable(properties, availableProperties, "Hotel Arrangement", { checkbox: item.proposal.hotelArrangement ?? false });
  addIfAvailable(properties, availableProperties, "Proposal Room Type", { rich_text: [{ text: { content: item.proposal.roomType } }] });
  addIfAvailable(properties, availableProperties, "Proposal Conditions", {
    rich_text: [{ text: { content: item.proposal.conditions.join(", ") } }]
  });
  addIfAvailable(properties, availableProperties, "Room Type", { rich_text: [{ text: { content: item.proposal.roomType } }] });
  addIfAvailable(properties, availableProperties, "Room", { rich_text: [{ text: { content: item.proposal.roomType } }] });
  addIfAvailable(properties, availableProperties, "Original Gmail Message ID", { rich_text: [{ text: { content: item.gmailMessageId } }] });
  addIfAvailable(properties, availableProperties, "Original Gmail URL", { url: item.gmailUrl });
  addIfAvailable(properties, availableProperties, "Gmail Processed Label", { rich_text: [{ text: { content: "ZenForwarder/Processed" } }] });
  addIfAvailable(properties, availableProperties, "Internal JSON", { rich_text: [{ text: { content: JSON.stringify(item.internalJson).slice(0, 1900) } }] });
  addIfAvailable(properties, availableProperties, "Audit Log", { rich_text: [{ text: { content: JSON.stringify(item.auditLog).slice(0, 1900) } }] });
  addIfAvailable(properties, availableProperties, "Created At", { date: { start: now } });
  addIfAvailable(properties, availableProperties, "Updated At", { date: { start: now } });
  if (relatedReservationId) {
    addIfAvailable(properties, availableProperties, "Related Reservation", { relation: [{ id: relatedReservationId }] });
  }

  const page = await notion.pages.create({
    parent: { database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID },
    properties: properties as Parameters<typeof notion.pages.create>[0]["properties"]
  });
  return page.id;
}

export async function findLatestProposalByNameAndCheckIn(metadata: ReservationMetadata): Promise<PreviousProposal | undefined> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID || !metadata.checkIn) return undefined;
  const schema = await ensureReservationDatabaseSchema();
  if (!schema) return undefined;
  const availableProperties = schema.properties ?? {};
  const titlePropertyName = getTitlePropertyName(availableProperties);
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      and: [
        { property: titlePropertyName, title: { equals: getProposalTitle(metadata) } },
        { property: "Check-in", date: { equals: metadata.checkIn } }
      ]
    } as any,
    sorts: [{ property: "Created At", direction: "descending" }],
    page_size: 10
  });
  const page = response.results.find((result) => result.object === "page" && result.id);
  if (!page || !("properties" in page)) return undefined;
  const properties = page.properties as Record<string, unknown>;
  return {
    pageId: page.id,
    title: readTitle(properties),
    receivedAt: readDate(properties, "Created At"),
    priceCurrency: readRichText(properties, "Original Currency"),
    priceAmount: readNumber(properties, "Original Amount") ?? readNumber(properties, "JPY Amount"),
    roomType: readRichText(properties, "Proposal Room Type") ?? readRichText(properties, "Room Type") ?? readRichText(properties, "Room"),
    conditions: splitConditions(readRichText(properties, "Proposal Conditions") ?? readRichText(properties, "Cancellation Policy")),
    emailType: readSelect(properties, "Email Type") as EmailType | undefined
  };
}

export async function hasCheckedHotelArrangementForCheckIn(checkIn?: string): Promise<boolean> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID || !checkIn) return false;
  await ensureReservationDatabaseSchema();
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      and: [
        { property: "Check-in", date: { equals: checkIn } },
        { property: "Hotel Arrangement", checkbox: { equals: true } }
      ]
    },
    page_size: 1
  });
  return response.results.length > 0;
}

export async function findNonHotelSlashBookingSiteForCheckIn(checkIn?: string): Promise<string | undefined> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID || !checkIn) return undefined;
  await ensureReservationDatabaseSchema();
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      and: [
        { property: "Check-in", date: { equals: checkIn } },
        { property: "Booking Site", rich_text: { is_not_empty: true } }
      ]
    },
    sorts: [{ property: "Created At", direction: "descending" }],
    page_size: 25
  });
  for (const page of response.results) {
    if (!("properties" in page)) continue;
    const bookingSite = readRichText(page.properties as Record<string, unknown>, "Booking Site");
    if (bookingSite && bookingSite.trim().toLowerCase() !== "hotelslash") return bookingSite;
  }
  return undefined;
}

export async function updateReservationEmailType(pageId: string, emailType: EmailType, options: { hotelArrangement?: boolean } = {}) {
  if (!notion) return;
  await ensureReservationDatabaseSchema();
  const properties: NotionProperties = {
    "Email Type": { select: { name: emailType } },
    "Updated At": { date: { start: new Date().toISOString() } }
  };
  if (typeof options.hotelArrangement === "boolean") {
    properties["Hotel Arrangement"] = { checkbox: options.hotelArrangement };
  }
  await notion.pages.update({
    page_id: pageId,
    properties: properties as Parameters<typeof notion.pages.update>[0]["properties"]
  });
}

export async function findRelatedReservation(metadata: ReservationMetadata): Promise<string | undefined> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID || metadata.emailType !== "HotelSlash Price Alert") return undefined;

  const filter = metadata.reservationNumber
    ? {
        property: "Reservation Number",
        rich_text: { equals: metadata.reservationNumber }
      }
    : {
        and: [
          { property: "Hotel Name", rich_text: { equals: metadata.hotelName } },
          ...(metadata.checkIn ? [{ property: "Check-in", date: { equals: metadata.checkIn } }] : []),
          ...(metadata.checkOut ? [{ property: "Check-out", date: { equals: metadata.checkOut } }] : [])
        ]
      };

  const result = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter
  });
  return result.results[0]?.id;
}

export interface ReservationPageForBackfill {
  pageId: string;
  title: string;
  bookingSite?: string;
  reservationNumber?: string;
  originalGmailMessageId?: string;
  reservationConfirmationUrl?: string;
  aiGeneratedBody?: string;
  internalJson?: string;
}

export async function listReservationPagesMissingConfirmationUrl(): Promise<ReservationPageForBackfill[]> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return [];
  await ensureReservationDatabaseSchema();
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      property: "Reservation Confirmation URL",
      url: { is_empty: true }
    },
    page_size: 25
  });

  return response.results.map((page) => {
    const properties = "properties" in page ? page.properties : {};
    return {
      pageId: page.id,
      title: readTitle(properties),
      bookingSite: readRichText(properties, "Booking Site"),
      reservationNumber: readRichText(properties, "Reservation Number"),
      originalGmailMessageId: readRichText(properties, "Original Gmail Message ID"),
      reservationConfirmationUrl: readUrl(properties, "Reservation Confirmation URL"),
      aiGeneratedBody: readRichText(properties, "AI Generated Body"),
      internalJson: readRichText(properties, "Internal JSON")
    };
  });
}

export async function listReservationPagesMissingBookingSite(): Promise<ReservationPageForBackfill[]> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return [];
  await ensureReservationDatabaseSchema();
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      property: "Booking Site",
      rich_text: { is_empty: true }
    },
    page_size: 50
  });

  return response.results.map((page) => {
    const properties = "properties" in page ? page.properties : {};
    return {
      pageId: page.id,
      title: readTitle(properties),
      bookingSite: readRichText(properties, "Booking Site"),
      reservationNumber: readRichText(properties, "Reservation Number"),
      originalGmailMessageId: readRichText(properties, "Original Gmail Message ID"),
      reservationConfirmationUrl: readUrl(properties, "Reservation Confirmation URL"),
      aiGeneratedBody: readRichText(properties, "AI Generated Body"),
      internalJson: readRichText(properties, "Internal JSON")
    };
  });
}

export async function listReservationPagesWithGmailMessageIds(): Promise<ReservationPageForBackfill[]> {
  if (!notion || !config.NOTION_HOTEL_RESERVATION_DATABASE_ID) return [];
  await ensureReservationDatabaseSchema();
  const response = await notion.databases.query({
    database_id: config.NOTION_HOTEL_RESERVATION_DATABASE_ID,
    filter: {
      property: "Original Gmail Message ID",
      rich_text: { is_not_empty: true }
    },
    page_size: 50
  });

  return response.results.map((page) => {
    const properties = "properties" in page ? page.properties : {};
    return {
      pageId: page.id,
      title: readTitle(properties),
      bookingSite: readRichText(properties, "Booking Site"),
      reservationNumber: readRichText(properties, "Reservation Number"),
      originalGmailMessageId: readRichText(properties, "Original Gmail Message ID"),
      reservationConfirmationUrl: readUrl(properties, "Reservation Confirmation URL"),
      aiGeneratedBody: readRichText(properties, "AI Generated Body"),
      internalJson: readRichText(properties, "Internal JSON")
    };
  });
}

export async function updateReservationConfirmationUrl(pageId: string, url: string) {
  if (!notion) throw new Error("Notion is not configured");
  await ensureReservationDatabaseSchema();
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Reservation Confirmation URL": { url },
      "Updated At": { date: { start: new Date().toISOString() } }
    }
  });
}

export async function updateReservationBookingSite(pageId: string, bookingSite: string) {
  if (!notion) throw new Error("Notion is not configured");
  await ensureReservationDatabaseSchema();
  await notion.pages.update({
    page_id: pageId,
    properties: {
      "Booking Site": { rich_text: [{ text: { content: bookingSite } }] },
      "Updated At": { date: { start: new Date().toISOString() } }
    }
  });
}

function addIfAvailable(properties: NotionProperties, availableProperties: Record<string, unknown>, name: string, value: Record<string, unknown>) {
  if (name in availableProperties) {
    properties[name] = value;
  }
}

function getTitlePropertyName(availableProperties: Record<string, any>) {
  return Object.entries(availableProperties).find(([, property]) => property.type === "title")?.[0] ?? "Name";
}

function getProposalTitle(metadata: ReservationMetadata) {
  return `${metadata.hotelName} - ${metadata.checkIn ?? "TBD"}`;
}

function readTitle(properties: Record<string, unknown>) {
  for (const property of Object.values(properties) as Array<Record<string, unknown>>) {
    if (property.type === "title" && Array.isArray(property.title)) {
      return property.title.map((item: any) => item.plain_text ?? "").join("");
    }
  }
  return "(untitled)";
}

function readRichText(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  return property?.rich_text?.map((item) => item.plain_text ?? "").join("") || undefined;
}

function readNumber(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { number?: number | null } | undefined;
  return property?.number ?? undefined;
}

function readDate(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { date?: { start?: string } | null } | undefined;
  return property?.date?.start;
}

function readSelect(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { select?: { name?: string } | null } | undefined;
  return property?.select?.name;
}

function splitConditions(value?: string) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readUrl(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { url?: string | null } | undefined;
  return property?.url ?? undefined;
}
