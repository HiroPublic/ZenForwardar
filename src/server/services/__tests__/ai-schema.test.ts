import { describe, expect, it } from "vitest";
import { reservationJsonSchema } from "../ai";

describe("reservationJsonSchema", () => {
  it("keeps the OpenAI strict JSON schema compatible by requiring every declared property", () => {
    const propertyNames = Object.keys(reservationJsonSchema.properties).sort();
    const requiredNames = [...reservationJsonSchema.required].sort();

    expect(requiredNames).toEqual(propertyNames);
    expect(reservationJsonSchema.additionalProperties).toBe(false);
  });

  it("allows nullable values for optional reservation fields while keeping required fields present", () => {
    expect(reservationJsonSchema.properties.hotelName).toEqual({ type: "string" });
    expect(reservationJsonSchema.properties.hotelAddress).toEqual({ type: ["string", "null"] });
    expect(reservationJsonSchema.properties.bookingSite).toEqual({ type: ["string", "null"] });
    expect(reservationJsonSchema.properties.adultCount).toEqual({ type: ["number", "null"] });
    expect(reservationJsonSchema.properties.childCount).toEqual({ type: ["number", "null"] });
    expect(reservationJsonSchema.properties.originalAmount).toEqual({ type: ["number", "null"] });
    expect(reservationJsonSchema.properties.reservationConfirmationUrl).toEqual({ type: ["string", "null"] });
  });
});
