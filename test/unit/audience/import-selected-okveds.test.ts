import { describe, expect, it } from "vitest";

import { parseSelectedOkvedsCsv } from "../../../src/modules/audience/application/import-selected-okveds";

const header = "code,name,source_version\n";

describe("parseSelectedOkvedsCsv strict grammar", () => {
  it.each([
    ["text after closing quote", `${header}43.11,"Разборка"x,v1\n`],
    ["space after closing quote", `${header}43.11,"Разборка" ,v1\n`],
    ["bare quote in unquoted field", `${header}43.11,Раз"борка,v1\n`],
    ["unterminated quoted field", `${header}43.11,"Разборка,v1\n`],
    ["lone carriage return", `${header}43.11,Разборка,v1\r`],
  ])("rejects %s", (_case, csv) => {
    expect(() => parseSelectedOkvedsCsv(csv, "v1")).toThrow("selected OKVED CSV");
  });

  it.each([
    ["escaped quote with LF", `${header}43.11,"Разборка ""Альфа""",v1\n`, "Разборка \"Альфа\""],
    ["CRLF", "code,name,source_version\r\n43.11,Разборка,v1\r\n", "Разборка"],
    ["quoted CRLF content", `${header}43.11,"Разборка\r\nстроения",v1\n`, "Разборка\r\nстроения"],
    ["quoted final field at EOF", `${header}43.11,Разборка,"v1"`, "Разборка"],
  ])("accepts %s", (_case, csv, expectedName) => {
    expect(parseSelectedOkvedsCsv(csv, "v1")).toEqual([
      { code: "43.11", name: expectedName, sourceVersion: "v1" },
    ]);
  });
});
