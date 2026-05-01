import { describe, expect, it } from "vitest";
import { buildCandidateQuery, createRawEmailWithOriginalAttachment, hasGmailTokens } from "../gmail";

describe("Gmail candidate query", () => {
  it("includes Expedia itinerary terms while keeping processed messages excluded", () => {
    const query = buildCandidateQuery();

    expect(query).toContain("in:inbox");
    expect(query).toContain("newer_than:7d");
    expect(query).toContain('-label:"ZenForwarder/Processed"');
    expect(query).toContain("Expedia");
    expect(query).toContain("itinerary");
    expect(query).toContain('"travel confirmation"');
    expect(query).toContain("-from:do-not-reply@tripit.com");
  });

  it("does not exclude the user's forwarding alias because manual forwarded reservation emails come from it", () => {
    const query = buildCandidateQuery();

    expect(query).not.toContain("-from:sender@example.com");
    expect(query).not.toContain('-subject:"Hotel Reservation -"');
  });
});

describe("hasGmailTokens", () => {
  it("treats empty or missing session tokens as unauthenticated", () => {
    expect(hasGmailTokens(undefined)).toBe(false);
    expect(hasGmailTokens(null)).toBe(false);
    expect(hasGmailTokens({ access_token: "token" })).toBe(true);
  });
});

describe("createRawEmailWithOriginalAttachment", () => {
  it("attaches the full original confirmation email for TripIt submissions", () => {
    const originalEmail = [
      "From: Expedia <expedia@example.com>",
      "Subject: Expedia travel confirmation",
      "",
      "Original vendor confirmation body"
    ].join("\r\n");

    const raw = createRawEmailWithOriginalAttachment(
      "plans@tripit.com",
      "Hotel Reservation - Sample Hotel - 2026-07-10 to 2026-07-12",
      "Booking Site / Reservation Number:\nExpedia / 123456789012",
      Buffer.from(originalEmail).toString("base64url")
    );
    const decoded = Buffer.from(raw, "base64url").toString("utf8");

    expect(decoded).toContain("To: plans@tripit.com");
    expect(decoded).toContain("Content-Type: multipart/mixed;");
    expect(decoded).toContain('Content-Type: message/rfc822; name="original-confirmation.eml"');
    expect(decoded).toContain('Content-Disposition: attachment; filename="original-confirmation.eml"');
    expect(decoded.replace(/\r?\n/g, "")).toContain(Buffer.from(originalEmail).toString("base64"));
  });
});
