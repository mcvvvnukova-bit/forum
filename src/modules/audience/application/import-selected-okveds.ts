import { parseOkvedCode, type OkvedCode } from "../domain/okved";

export interface OkvedRecord {
  code: OkvedCode;
  name: string;
  sourceVersion: string;
  datasetReleaseId: string;
}

export interface OkvedRepository {
  upsertMany(
    datasetReleaseId: string,
    rows: readonly Omit<OkvedRecord, "datasetReleaseId">[],
  ): Promise<number>;
  find(code: OkvedCode): Promise<OkvedRecord | null>;
}

export async function importSelectedOkveds(
  csv: string,
  repository: OkvedRepository,
  datasetReleaseId: string,
): Promise<number> {
  const rows = parseSelectedOkvedsCsv(csv);
  return repository.upsertMany(datasetReleaseId, rows);
}

export function parseSelectedOkvedsCsv(
  csv: string,
  expectedSourceVersion?: string,
): readonly Omit<OkvedRecord, "datasetReleaseId">[] {
  const rows = parseCsv(csv);

  if (rows.length === 0 || rows[0]?.join(",") !== "code,name,source_version") {
    throw new Error("selected OKVED CSV must start with code,name,source_version");
  }
  if (rows.length === 1) {
    throw new Error("selected OKVED CSV must contain at least one data row");
  }

  return rows.slice(1).map((row, index) => {
    if (row.length !== 3) {
      throw new Error(`selected OKVED CSV row ${index + 2} must have three columns`);
    }

    const [code, name, sourceVersion] = row;
    if (name.trim() === "") {
      throw new Error(`selected OKVED CSV row ${index + 2} must have a name`);
    }
    if (sourceVersion.trim() === "") {
      throw new Error(`selected OKVED CSV row ${index + 2} must have a source version`);
    }
    if (expectedSourceVersion !== undefined && sourceVersion !== expectedSourceVersion) {
      throw new Error(
        `selected OKVED CSV row ${index + 2} source version does not match requested release`,
      );
    }

    return { code: parseOkvedCode(code), name, sourceVersion };
  });
}

function parseCsv(csv: string): string[][] {
  type CsvState = "unquoted" | "quoted" | "afterQuote";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: CsvState = "unquoted";
  const finishField = () => {
    row.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
    state = "unquoted";
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;

    if (state === "quoted") {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "afterQuote";
        }
      } else if (character === "\r") {
        if (csv[index + 1] !== "\n") {
          throw new Error("selected OKVED CSV has an invalid carriage return");
        }
        field += "\r\n";
        index += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (state === "afterQuote") {
      if (character === ",") {
        finishField();
        state = "unquoted";
      } else if (character === "\n") {
        finishRow();
      } else if (character === "\r" && csv[index + 1] === "\n") {
        finishRow();
        index += 1;
      } else {
        throw new Error("selected OKVED CSV has text after a closing quote");
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new Error("selected OKVED CSV has an invalid quoted field");
      }
      state = "quoted";
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
    } else if (character === "\r" && csv[index + 1] === "\n") {
      finishRow();
      index += 1;
    } else if (character === "\r") {
      throw new Error("selected OKVED CSV has an invalid carriage return");
    } else {
      field += character;
    }
  }

  if (state === "quoted") {
    throw new Error("selected OKVED CSV has an unterminated quoted field");
  }
  if (state === "afterQuote" || field !== "" || row.length > 0) {
    finishRow();
  }

  return rows.filter((parsedRow) => parsedRow.some((value) => value !== ""));
}
