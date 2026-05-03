import { describe, expect, it } from "vitest";
import { normalizeReservationDates } from "../date-normalization";

describe("normalizeReservationDates", () => {
  it("fills missing year in weekday month-day strings from received year", () => {
    const metadata = normalizeReservationDates(
      {
        hotelName: "Sample Hotel",
        status: "Confirmed",
        emailType: "Reservation Confirmation",
        checkIn: "Fri, Jul 10",
        checkOut: "Mon, Jul 13"
      },
      "2026-04-30T00:00:00.000Z"
    );

    expect(metadata.checkIn).toBe("2026-07-10");
    expect(metadata.checkOut).toBe("2026-07-13");
  });

  it("rolls checkout into the next year when normalized checkout is before check-in", () => {
    const metadata = normalizeReservationDates(
      {
        hotelName: "Sample Hotel",
        status: "Confirmed",
        emailType: "Reservation Confirmation",
        checkIn: "Dec 31",
        checkOut: "Jan 2"
      },
      "2026-04-30T00:00:00.000Z"
    );

    expect(metadata.checkIn).toBe("2026-12-31");
    expect(metadata.checkOut).toBe("2027-01-02");
  });

  it("strips time from ISO date-time values for stay dates", () => {
    const metadata = normalizeReservationDates(
      {
        hotelName: "Sample Hotel",
        status: "Confirmed",
        emailType: "Reservation Confirmation",
        checkIn: "2026-07-06T15:00:00",
        checkOut: "2026-07-10T11:00:00"
      },
      "2026-04-30T00:00:00.000Z"
    );

    expect(metadata.checkIn).toBe("2026-07-06");
    expect(metadata.checkOut).toBe("2026-07-10");
  });
});
