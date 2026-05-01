import { Client } from "@notionhq/client";
import type { PendingForward, ReservationMetadata } from "../../shared/types";
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
        { name: "HotelSlash Price Alert", color: "blue" }
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
  "Original Gmail Message ID": { rich_text: {} },
  "Original Gmail URL": { url: {} },
  "Forwarded To TripIt At": { date: {} },
  "Forwarded To HotelSlash At": { date: {} },
  "Gmail Processed Label": { rich_text: {} },
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

export async function createReservationRecord(item: PendingForward, forwardedAt: { tripIt: string; hotelSlash: string }) {
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
  addIfAvailable(properties, availableProperties, "Original Gmail Message ID", { rich_text: [{ text: { content: item.gmailMessageId } }] });
  addIfAvailable(properties, availableProperties, "Original Gmail URL", { url: item.gmailUrl });
  addIfAvailable(properties, availableProperties, "Forwarded To TripIt At", { date: { start: forwardedAt.tripIt } });
  addIfAvailable(properties, availableProperties, "Forwarded To HotelSlash At", { date: { start: forwardedAt.hotelSlash } });
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

function readUrl(properties: Record<string, unknown>, name: string) {
  const property = properties[name] as { url?: string | null } | undefined;
  return property?.url ?? undefined;
}
