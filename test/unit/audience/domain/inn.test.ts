import { describe, expect, it } from "vitest";
import { parseLegalEntityInn } from "../../../../src/modules/audience/domain/inn";

describe("parseLegalEntityInn", () => {
  it("accepts the known valid legal-entity INN 7707083893", () => {
    expect(parseLegalEntityInn("7707083893")).toBe("7707083893");
  });

  it("rejects an INN whose tenth digit is not the Russian legal-entity checksum", () => {
    expect(() => parseLegalEntityInn("7707083894")).toThrow("checksum");
  });

  it("rejects a twelve-digit individual INN instead of treating it as a legal entity", () => {
    expect(() => parseLegalEntityInn("123456789012")).toThrow("legal entity");
  });

  it("rejects non-ASCII digits even when they look numeric", () => {
    expect(() => parseLegalEntityInn("770708389٣")).toThrow("legal entity");
  });
});
