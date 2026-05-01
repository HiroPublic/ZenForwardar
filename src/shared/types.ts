export type ReservationStatus = "Confirmed" | "Modified" | "Cancelled" | "Price Alert";

export type EmailType =
  | "Reservation Confirmation"
  | "Change Notice"
  | "Cancellation Notice"
  | "HotelSlash Price Alert";

export type ProcessingState = "pending" | "processed" | "error";

export interface ReservationMetadata {
  hotelName: string;
  hotelAddress?: string;
  hotelPhone?: string;
  bookingSite?: string;
  reservationNumber?: string;
  guestName?: string;
  adultCount?: number;
  childCount?: number;
  reservationConfirmationUrl?: string;
  status: ReservationStatus;
  emailType: EmailType;
  checkIn?: string;
  checkOut?: string;
  nights?: number;
  room?: string;
  originalCurrency?: string;
  originalAmount?: number;
  jpyAmount?: number;
  exchangeRate?: number;
  exchangeRateDate?: string;
  cancellationPolicy?: string;
  notes?: string;
  relatedReservationId?: string;
}

export interface AuditEvent {
  at: string;
  step: string;
  status: "ok" | "error" | "info";
  message: string;
  details?: Record<string, unknown>;
}

export interface PendingForward {
  id: string;
  gmailMessageId: string;
  gmailUrl: string;
  from: string;
  receivedAt: string;
  subject: string;
  metadata: ReservationMetadata;
  generatedSubject: string;
  generatedBody: string;
  internalJson: ReservationMetadata;
  state: ProcessingState;
  auditLog: AuditEvent[];
}

export interface ForwardResult {
  item: PendingForward;
  tripItSentAt: string;
  hotelSlashSentAt: string;
  notionPageId?: string;
}
