import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceEmail } from "../services/ai";

let emails: SourceEmail[] = [
  {
    id: "sample-message-1",
    from: "booking@example.jp",
    subject: "ホテル予約確認",
    receivedAt: "2026-04-30T00:00:00.000Z",
    body: "ホテル: Sample Hotel"
  }
];

vi.mock("../services/gmail", () => ({
  fetchCandidateEmails: vi.fn(async () => emails),
  ensureSendAsAlias: vi.fn(),
  markProcessed: vi.fn(),
  sendForward: vi.fn()
}));

vi.mock("../services/ai", () => ({
  extractReservationJson: vi.fn(async () => ({
    hotelName: "Sample Hotel",
    reservationNumber: "SAMPLE-RESERVATION-1",
    status: "Confirmed",
    emailType: "Reservation Confirmation"
  })),
  generateForwardEmail: vi.fn(async () => ({
    subject: "Hotel Reservation - Sample Hotel - TBD to TBD",
    body: "Hotel Reservation\n\nGuests:\n[Redacted]"
  }))
}));

vi.mock("../services/exchange", () => ({
  convertToJpy: vi.fn(async () => undefined)
}));

vi.mock("../services/notion", () => ({
  createReservationRecord: vi.fn(async () => "notion-page-id"),
  ensureReservationDatabaseSchema: vi.fn(async () => undefined),
  findRelatedReservation: vi.fn(async () => undefined)
}));

describe("workflow dismiss and reload", () => {
  beforeEach(() => {
    emails = [
      {
        id: "sample-message-1",
        from: "booking@example.jp",
        subject: "ホテル予約確認",
        receivedAt: "2026-04-30T00:00:00.000Z",
        body: "ホテル: Sample Hotel"
      }
    ];
    vi.resetModules();
  });

  it("excludes the dismissed Gmail message from the reloaded candidate list", async () => {
    const workflow = await import("../workflow");
    const [item] = await workflow.syncReservations();

    expect(item.gmailMessageId).toBe("sample-message-1");

    const reloaded = await workflow.dismissForwardAndReload(item.id);

    expect(reloaded).toEqual([]);
    expect(workflow.listPending()).toEqual([]);
  });

  it("removes approved messages from the app queue and prevents them from reappearing on sync", async () => {
    const workflow = await import("../workflow");
    const [item] = await workflow.syncReservations();

    await workflow.approveForward(item.id, item.generatedBody);

    expect(workflow.listPending()).toEqual([]);
    expect(await workflow.syncReservations()).toEqual([]);
  });

  it("collapses multiple Gmail messages for the same reservation into one app candidate", async () => {
    emails = [
      { ...emails[0], id: "sample-message-1" },
      { ...emails[0], id: "sample-message-2" }
    ];
    const workflow = await import("../workflow");

    const pending = await workflow.syncReservations();

    expect(pending).toHaveLength(1);
  });
});
