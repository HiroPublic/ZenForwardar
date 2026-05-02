import { describe, expect, it } from "vitest";
import { parseTopHotelSlashOffer } from "../hotelslash";

describe("parseTopHotelSlashOffer", () => {
  it("extracts the top HotelSlash proposal from rendered page text", () => {
    const text = `
      Hello, traveler!
      Your HotelSlash Rates
      Rebook your 4-night stay at a lower rate:
      Suite (2 Bed)
      Breakfast Included
      Fully Refundable
      JPY 125,559
      Save JPY38,989
      PAY DEPOSIT
      Photos, Amenities, Description
      Other deals for Jun 7 - Jun 11 at this hotel:
      Suite (1 Bed)
      JPY 125,559
    `;

    expect(parseTopHotelSlashOffer(text, "https://hotelslash.com/rates")).toEqual({
      pageUrl: "https://hotelslash.com/rates",
      priceCurrency: "JPY",
      priceAmount: 125559,
      roomType: "Suite (2 Bed)",
      conditions: ["Breakfast Included", "Fully Refundable", "Pay Deposit"],
      currentReservation: undefined
    });
  });

  it("extracts local-currency proposals without relying on JPY", () => {
    const text = `
      Your HotelSlash Rates
      Rebook your 2-night stay at a lower rate:
      Deluxe Cave Room
      Breakfast included
      Fully Refundable
      TRY 12.345,67
      PAY DEPOSIT
      Photos, Amenities, Description
    `;

    expect(parseTopHotelSlashOffer(text, "https://hotelslash.com/rates")).toEqual({
      pageUrl: "https://hotelslash.com/rates",
      priceCurrency: "TRY",
      priceAmount: 12345.67,
      roomType: "Deluxe Cave Room",
      conditions: ["Breakfast Included", "Fully Refundable", "Pay Deposit"],
      currentReservation: undefined
    });
  });

  it("ignores SlashCash and extracts current reservation details", () => {
    const text = `
      Here are the details of your current reservation.
      Jun 7 - Jun 11, 2 adults
      Suite
      Room Only
      Cancel before May 17, 2026
      $1,048
      4 nights
      PREPAID
      at the
      Aydinli Cave House
      Your HotelSlash Rates
      Rebook your 4-night stay at a lower rate:
      Suite (1 Bed)
      Breakfast Included
      Fully Refundable
      $799
      Save $248
      PAY DEPOSIT
      Earn $7.99 SlashCash
      Photos, Amenities, Description
    `;

    expect(parseTopHotelSlashOffer(text, "https://hotelslash.com/rates")).toEqual({
      pageUrl: "https://hotelslash.com/rates",
      priceCurrency: "USD",
      priceAmount: 799,
      roomType: "Suite (1 Bed)",
      conditions: ["Breakfast Included", "Fully Refundable", "Pay Deposit"],
      currentReservation: {
        priceCurrency: "USD",
        priceAmount: 1048,
        roomType: "Suite",
        conditions: ["Room Only"],
        cancellationDeadline: "Cancel before May 17, 2026",
        paymentTerms: "PREPAID"
      }
    });
  });

  it("extracts compact currency-code prices from HotelSlash", () => {
    const text = `
      Your HotelSlash Rates
      Rebook your 4-night stay at a lower rate:
      Suite (1 Bed)
      Breakfast Included
      Fully Refundable
      JPY125,559
      Save JPY38,989
      PAY DEPOSIT
      Earn $7.99 SlashCash
      Photos Amenities Description
    `;

    expect(parseTopHotelSlashOffer(text, "https://hotelslash.com/rates")).toMatchObject({
      priceCurrency: "JPY",
      priceAmount: 125559,
      roomType: "Suite (1 Bed)"
    });
  });
});
