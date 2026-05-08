import { describe, expect, it } from "vitest";
import { generateForwardEmail, inferMealPlanFromEmailBody } from "../ai";
import { redactPersonalInformation } from "../redaction";

describe("redactPersonalInformation", () => {
  it("redacts member identifiers and credit card numbers on card-labeled lines", () => {
    const redacted = redactPersonalInformation(
      [
        "Guest Name: Taro Yamada",
        "Membership: ABCD-1234",
        "Card: 4111 1111 1111 1111",
        "Reservation Number: 1234567890",
        "Hotel Phone: +81-3-0000-0000"
      ].join("\n")
    );

    expect(redacted).toContain("Guest Name: Taro Yamada");
    expect(redacted).toContain("Membership: [Redacted]");
    expect(redacted).toContain("Card: [Redacted]");
    expect(redacted).toContain("Reservation Number: 1234567890");
    expect(redacted).toContain("Hotel Phone: +81-3-0000-0000");
  });

  it("keeps hotel phone, reservation number, and guest name in generated TripIt and HotelSlash body", async () => {
    const email = await generateForwardEmail({
      hotelName: "Sample Hotel Tokyo",
      hotelPhone: "+81-3-0000-0000",
      bookingSite: "Expedia",
      reservationNumber: "1234567890",
      guestName: "Taro Yamada",
      adultCount: 2,
      childCount: 1,
      reservationConfirmationUrl: "https://www.expedia.com/trips/1234567890",
      status: "Confirmed",
      emailType: "Reservation Confirmation",
      mealPlan: "Breakfast for 2, Free dinner for 2 per day",
      originalCurrency: "USD",
      originalAmount: 671.42,
      jpyAmount: 100817,
      exchangeRate: 150.15,
      exchangeRateDate: "2026-04-30"
    });

    expect(email.body).toContain("Hotel Phone:\n+81-3-0000-0000");
    expect(email.body).toContain("Booking Site / Reservation Number:\nExpedia / 1234567890");
    expect(email.body).toContain("Reservation Number:\n1234567890");
    expect(email.body).toContain("Guest Name:\nTaro Yamada");
    expect(email.body).toContain("Number of Guests:\n2 adults, 1 child");
    expect(email.body).toContain("Meal Plan:\nBreakfast for 2, Free dinner for 2 per day");
    expect(email.body).not.toContain("Reservation Confirmation URL:");
    expect(email.body).not.toContain("https://www.expedia.com/trips/1234567890");
    expect(email.body).not.toContain("Approx. JPY");
    expect(email.body).not.toContain("100817");
  });

  it("extracts meal-plan lines from reservation emails", () => {
    const mealPlan = inferMealPlanFromEmailBody(
      [
        "Accommodation details",
        "Standard Room, 2 Queen Beds",
        "Breakfast for 2",
        "Free dinner for 2 per day",
        "Total price: USD 516.12"
      ].join("\n")
    );

    expect(mealPlan).toBe("Breakfast for 2, Free dinner for 2 per day");
  });
});
