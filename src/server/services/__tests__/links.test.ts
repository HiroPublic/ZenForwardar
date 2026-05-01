import { describe, expect, it } from "vitest";
import { extractReservationConfirmationUrl } from "../links";

describe("extractReservationConfirmationUrl", () => {
  it("extracts likely reservation confirmation links from href attributes", () => {
    const url = extractReservationConfirmationUrl(`
      <a href="https://example.com/privacy">Privacy</a>
      <a href="https://www.expedia.com/trips/1234567890?token=abc&amp;source=email">View full itinerary</a>
    `);

    expect(url).toBe("https://www.expedia.com/trips/1234567890?token=abc&source=email");
  });

  it("ignores low-value links", () => {
    const url = extractReservationConfirmationUrl(`
      <a href="https://example.com/unsubscribe">unsubscribe</a>
      <a href="https://example.com/terms">terms</a>
    `);

    expect(url).toBeUndefined();
  });
});
