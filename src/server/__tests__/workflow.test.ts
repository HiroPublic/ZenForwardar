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
let lowerRate = false;

vi.mock("../services/gmail", () => ({
  fetchCandidateEmails: vi.fn(async () => emails),
  ensureSendAsAlias: vi.fn(),
  extractLowerRateButtonUrl: vi.fn(() => "https://hotelslash.example/rates"),
  isLowerRateEmail: vi.fn(() => lowerRate),
  markProcessed: vi.fn(),
  sendForward: vi.fn()
}));

vi.mock("../services/hotelslash", () => ({
  extractTopHotelSlashOffer: vi.fn(async () => ({
    pageUrl: "https://hotelslash.example/rates",
    priceCurrency: "JPY",
    priceAmount: 12000,
    roomType: "Standard Room",
    conditions: ["Refundable"]
  }))
}));

vi.mock("../services/ai", () => ({
  extractReservationJson: vi.fn(async () => ({
    hotelName: "Sample Hotel",
    reservationNumber: "SAMPLE-RESERVATION-1",
    checkIn: "2026-06-01",
    checkOut: "2026-06-03",
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
  createLowPriceProposalRecord: vi.fn(async () => "low-price-notion-page-id"),
  createReservationRecord: vi.fn(async () => "notion-page-id"),
  ensureReservationDatabaseSchema: vi.fn(async () => undefined),
  findLatestProposalByNameAndCheckIn: vi.fn(async () => undefined),
  findNonHotelSlashBookingSiteForCheckIn: vi.fn(async () => undefined),
  findRelatedReservation: vi.fn(async () => undefined),
  hasCheckedHotelArrangementForCheckIn: vi.fn(async () => false),
  updateReservationEmailType: vi.fn(async () => undefined)
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
    lowerRate = false;
    vi.clearAllMocks();
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

  it("inherits checked Hotel Arrangement when an approved forward creates a Notion entry", async () => {
    const gmail = await import("../services/gmail");
    const notion = await import("../services/notion");
    vi.mocked(notion.hasCheckedHotelArrangementForCheckIn).mockResolvedValueOnce(true);
    const workflow = await import("../workflow");
    const [item] = await workflow.syncReservations();

    await workflow.approveForward(item.id, item.generatedBody);

    expect(notion.createReservationRecord).toHaveBeenCalledWith(
      item,
      expect.objectContaining({ hotelArrangement: true })
    );
    expect(gmail.sendForward).toHaveBeenCalled();
  });

  it("registers a pending message in Notion without forwarding and inherits checked Hotel Arrangement", async () => {
    const gmail = await import("../services/gmail");
    const notion = await import("../services/notion");
    vi.mocked(notion.hasCheckedHotelArrangementForCheckIn).mockResolvedValueOnce(true);
    const workflow = await import("../workflow");
    const [item] = await workflow.syncReservations();

    const result = await workflow.registerForwardInNotionOnly(item.id);

    expect(result.hotelArrangement).toBe(true);
    expect(notion.createReservationRecord).toHaveBeenCalledWith(item, { hotelArrangement: true });
    expect(gmail.ensureSendAsAlias).not.toHaveBeenCalled();
    expect(gmail.sendForward).not.toHaveBeenCalled();
    expect(gmail.markProcessed).toHaveBeenCalledWith(undefined, "sample-message-1");
    expect(workflow.listPending()).toEqual([]);
  });

  it("inherits checked Hotel Arrangement when deciding a HotelSlash proposal", async () => {
    lowerRate = true;
    const notion = await import("../services/notion");
    vi.mocked(notion.hasCheckedHotelArrangementForCheckIn).mockResolvedValue(true);
    const workflow = await import("../workflow");
    const [item] = await workflow.syncReservations();

    await workflow.decideLowPriceProposal(item.id, "accepted");

    expect(notion.updateReservationEmailType).toHaveBeenCalledWith("low-price-notion-page-id", "Proposal accepted", {
      hotelArrangement: true
    });
  });

  it("uses a non-HotelSlash booking site from matching Check-in entries for proposal display", async () => {
    lowerRate = true;
    const notion = await import("../services/notion");
    vi.mocked(notion.findNonHotelSlashBookingSiteForCheckIn).mockResolvedValueOnce("Expedia.com");
    const workflow = await import("../workflow");

    const [item] = await workflow.syncReservations();

    expect(item.proposal?.bookingSite).toBe("Expedia.com");
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
