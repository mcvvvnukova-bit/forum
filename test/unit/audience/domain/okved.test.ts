import { describe, expect, it } from "vitest";
import { parseOkvedCode } from "../../../../src/modules/audience/domain/okved";

describe("parseOkvedCode", () => {
  it("returns a canonical OKVED code after trimming surrounding whitespace", () => {
    expect(parseOkvedCode(" 43.11 ")).toBe("43.11");
  });

  it("rejects a code with a removed dot instead of repairing its punctuation", () => {
    expect(() => parseOkvedCode("4311")).toThrow("canonical OKVED");
  });

  it("rejects an OKVED code with more than two hierarchy levels", () => {
    expect(() => parseOkvedCode("43.11.1.2")).toThrow("canonical OKVED");
  });
});
