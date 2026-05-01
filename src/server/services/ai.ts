import OpenAI from "openai";
import type { ReservationMetadata } from "../../shared/types";
import { config } from "../config";
import { inferBookingSiteFromEmail } from "./booking-site";
import { redactPersonalInformation } from "./redaction";

const client = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : undefined;

export const reservationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "hotelName",
    "hotelAddress",
    "hotelPhone",
    "bookingSite",
    "reservationNumber",
    "guestName",
    "adultCount",
    "childCount",
    "reservationConfirmationUrl",
    "status",
    "emailType",
    "checkIn",
    "checkOut",
    "nights",
    "room",
    "originalCurrency",
    "originalAmount",
    "cancellationPolicy",
    "notes"
  ],
  properties: {
    hotelName: { type: "string" },
    hotelAddress: { type: ["string", "null"] },
    hotelPhone: { type: ["string", "null"] },
    bookingSite: { type: ["string", "null"] },
    reservationNumber: { type: ["string", "null"] },
    guestName: { type: ["string", "null"] },
    adultCount: { type: ["number", "null"] },
    childCount: { type: ["number", "null"] },
    reservationConfirmationUrl: { type: ["string", "null"] },
    status: { enum: ["Confirmed", "Modified", "Cancelled", "Price Alert"] },
    emailType: {
      enum: ["Reservation Confirmation", "Change Notice", "Cancellation Notice", "HotelSlash Price Alert"]
    },
    checkIn: { type: ["string", "null"] },
    checkOut: { type: ["string", "null"] },
    nights: { type: ["number", "null"] },
    room: { type: ["string", "null"] },
    originalCurrency: { type: ["string", "null"] },
    originalAmount: { type: ["number", "null"] },
    cancellationPolicy: { type: ["string", "null"] },
    notes: { type: ["string", "null"] }
  }
} as const;

export interface SourceEmail {
  id: string;
  from: string;
  subject: string;
  receivedAt: string;
  body: string;
}

export async function extractReservationJson(email: SourceEmail): Promise<ReservationMetadata> {
  if (!client) return mockExtract(email);

  const response = await client.responses.create({
    model: config.OPENAI_MODEL,
    input: [
      {
        role: "system",
        content:
          "Extract only hotel reservation metadata from the email. Preserve the booking site, reservation/itinerary number, guest name, adult/child guest counts, and reservation confirmation URL for internal records. Remove unrelated personal information. Return strict JSON matching the requested keys."
      },
      {
        role: "user",
        content: `Email subject: ${email.subject}\n\nEmail body:\n${email.body}`
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "hotel_reservation",
        schema: reservationJsonSchema
      }
    }
  });

  return compactNulls(JSON.parse(response.output_text) as ReservationMetadata);
}

export async function generateForwardEmail(metadata: ReservationMetadata): Promise<{ subject: string; body: string }> {
  const subject = `Hotel Reservation - ${metadata.hotelName} - ${metadata.checkIn ?? "TBD"} to ${metadata.checkOut ?? "TBD"}`;
  const body = redactPersonalInformation(`Hotel Reservation

Hotel Name:
${metadata.hotelName}

Hotel Address:
${metadata.hotelAddress ?? "Not provided"}

Hotel Phone:
${metadata.hotelPhone ?? "Not provided"}

Booking Site / Reservation Number:
${formatBookingReference(metadata)}

Reservation Number:
${metadata.reservationNumber ?? "Not provided"}

Guest Name:
${metadata.guestName ?? "Not provided"}

Number of Guests:
${formatGuestCounts(metadata)}

Status:
${metadata.status}

Check-in:
${metadata.checkIn ?? "Not provided"}

Check-out:
${metadata.checkOut ?? "Not provided"}

Number of Nights:
${metadata.nights ?? "Not provided"}

Room:
${metadata.room ?? "Not provided"}

Guests:
${metadata.guestName ?? "Not provided"}

Total Price:
${metadata.originalAmount ? `${metadata.originalCurrency ?? ""} ${metadata.originalAmount}`.trim() : "Not provided"}

Cancellation Policy:
${metadata.cancellationPolicy ?? "Not provided"}

Notes:
${metadata.notes ?? "None"}

Original Email Type:
${metadata.emailType}`);

  return { subject, body };
}

function formatBookingReference(metadata: ReservationMetadata) {
  return `${metadata.bookingSite ?? "Not provided"} / ${metadata.reservationNumber ?? "Not provided"}`;
}

function formatGuestCounts(metadata: ReservationMetadata) {
  const parts = [];
  if (typeof metadata.adultCount === "number") parts.push(`${metadata.adultCount} ${metadata.adultCount === 1 ? "adult" : "adults"}`);
  if (typeof metadata.childCount === "number") parts.push(`${metadata.childCount} ${metadata.childCount === 1 ? "child" : "children"}`);
  return parts.length ? parts.join(", ") : "Not provided";
}

function mockExtract(email: SourceEmail): ReservationMetadata {
  const lower = `${email.subject}\n${email.body}`.toLowerCase();
  const isCancel = /cancel|キャンセル/.test(lower);
  const isChange = /change|変更/.test(lower);
  const isPriceAlert = /hotelslash|price|低価格|値下げ/.test(lower);
  return {
    hotelName: findLine(email.body, ["ホテル", "hotel"]) ?? "Sample Hotel Tokyo",
    hotelAddress: findLine(email.body, ["住所", "address"]) ?? "1-1-1 Marunouchi, Tokyo, Japan",
    hotelPhone: findLine(email.body, ["電話", "phone"]) ?? "+81-3-0000-0000",
    bookingSite: inferBookingSiteFromEmail(email),
    reservationNumber: findLine(email.body, ["予約番号", "reservation", "itinerary"]) ?? email.id.slice(0, 8).toUpperCase(),
    guestName: findLine(email.body, ["guest", "guest name", "宿泊者", "氏名", "お名前"]),
    adultCount: findGuestCount(email.body, ["adult", "adults", "大人"]),
    childCount: findGuestCount(email.body, ["child", "children", "子供", "子ども", "こども"]),
    reservationConfirmationUrl: findUrl(email.body),
    status: isPriceAlert ? "Price Alert" : isCancel ? "Cancelled" : isChange ? "Modified" : "Confirmed",
    emailType: isPriceAlert
      ? "HotelSlash Price Alert"
      : isCancel
        ? "Cancellation Notice"
        : isChange
          ? "Change Notice"
          : "Reservation Confirmation",
    checkIn: "2026-06-12",
    checkOut: "2026-06-15",
    nights: 3,
    room: "Standard room",
    originalCurrency: "JPY",
    originalAmount: 42000,
    cancellationPolicy: "Free cancellation policy not provided in mock data.",
    notes: "Generated in mock mode because live AI credentials are not configured."
  };
}

function findLine(body: string, labels: string[]): string | undefined {
  const line = body.split(/\r?\n/).find((candidate) => labels.some((label) => candidate.toLowerCase().includes(label)));
  return line?.replace(/^.*?[:：]\s*/, "").trim();
}

function findUrl(body: string): string | undefined {
  return body.match(/https?:\/\/[^\s"'<>]+/)?.[0];
}

function findGuestCount(body: string, labels: string[]): number | undefined {
  for (const line of body.split(/\r?\n/)) {
    const lowerLine = line.toLowerCase();
    if (!labels.some((label) => lowerLine.includes(label.toLowerCase()))) continue;
    const value = line.match(/\d+/)?.[0];
    if (value) return Number(value);
  }
  return undefined;
}

function compactNulls(metadata: ReservationMetadata): ReservationMetadata {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null)) as unknown as ReservationMetadata;
}
