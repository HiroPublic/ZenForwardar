import { describe, expect, it } from "vitest";
import { inferBookingSite } from "../booking-site";

describe("inferBookingSite", () => {
  it("detects Expedia from confirmation URLs and email text", () => {
    expect(inferBookingSite(["https://www.expedia.com/trips/1234567890?token=abc"])).toBe("Expedia");
    expect(inferBookingSite(["From: Expedia <expedia@eg.expedia.com>"])).toBe("Expedia");
  });

  it("detects other common hotel booking vendors", () => {
    expect(inferBookingSite(["https://secure.booking.com/confirmation.html"])).toBe("Booking.com");
    expect(inferBookingSite(["Agoda booking confirmation"])).toBe("Agoda");
    expect(inferBookingSite(["楽天トラベル 予約確認"])).toBe("Rakuten Travel");
  });

  it("returns undefined when no booking vendor can be inferred", () => {
    expect(inferBookingSite(["Hotel Reservation - Sample Hotel"])).toBeUndefined();
  });
});
