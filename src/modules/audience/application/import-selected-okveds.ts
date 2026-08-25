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
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new Error("selected OKVED CSV has an invalid quoted field");
      }
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (quoted) {
    throw new Error("selected OKVED CSV has an unterminated quoted field");
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((parsedRow) => parsedRow.some((value) => value !== ""));
}
