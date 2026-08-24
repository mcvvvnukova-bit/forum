import type { BrowserSession } from "../../../application/ports/browser-session";
import type {
  DiscoveryRejectReason,
  DiscoveryScope,
  DiscoveredCompany,
} from "../../../domain/discovery";
import { parseLegalEntityInn } from "../../../domain/inn";
import { parseOkvedCode } from "../../../domain/okved";

export class BrowserContractError extends Error {}

export async function verifyRenderedFilters(
  session: BrowserSession,
  scope: DiscoveryScope,
): Promise<void> {
  const renderedOkved = parseOkvedCode(await session.readLabeledText("ОКВЭД"));
  const renderedStatus = await session.readLabeledText("Статус");
  if (renderedOkved !== scope.okved
    || renderedStatus !== (scope.onlyActive ? "Только действующие" : "Все")) {
    throw new BrowserContractError("rendered filters do not match the requested scope");
  }
}

export async function readCompany(
  session: BrowserSession,
  scope: DiscoveryScope,
): Promise<
  | {
    kind: "accepted";
    sourceRecordKey: string;
    company: Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion">;
  }
  | { kind: "rejected"; sourceRecordKey: string; reason: DiscoveryRejectReason }
> {
  const optional = (value: string) => value === "—" ? null : value.replace(/\s+/g, " ").trim();
  const sourceRecordKey = (await session.readLabeledText("Ключ записи")).trim();
  if (!/^[0-9]+$/.test(sourceRecordKey)) {
    throw new BrowserContractError("company source record key is invalid");
  }

  const innText = (await session.readLabeledText("ИНН")).trim();
  let inn: ReturnType<typeof parseLegalEntityInn>;
  try {
    inn = parseLegalEntityInn(innText);
  } catch {
    return { kind: "rejected", sourceRecordKey, reason: "invalid_inn" };
  }
  const okvedValues = await session.readLabeledTexts("ОКВЭД");
  if (okvedValues.length === 0) throw new BrowserContractError("company OKVED is missing");
  if (okvedValues.length > 1) {
    return { kind: "rejected", sourceRecordKey, reason: "ambiguous_okved" };
  }
  let okvedCode: ReturnType<typeof parseOkvedCode>;
  try {
    okvedCode = parseOkvedCode(okvedValues[0]!);
  } catch {
    return { kind: "rejected", sourceRecordKey, reason: "mismatched_okved" };
  }
  if (okvedCode !== scope.okved) {
    return { kind: "rejected", sourceRecordKey, reason: "mismatched_okved" };
  }
  const role = await session.readLabeledText("Тип ОКВЭД");
  if (role !== "Основной" && role !== "Дополнительный") {
    return { kind: "rejected", sourceRecordKey, reason: "unknown_okved_role" };
  }

  const company = {
    sourceRecordKey,
    inn,
    name: (await session.readLabeledText("Наименование")).trim(),
    website: optional(await session.readLabeledText("Сайт")),
    phone: optional(await session.readFirstLabeledText("Телефон")),
    email: optional(await session.readFirstLabeledText("Email"))?.toLowerCase() ?? null,
    okvedCode,
    isPrimary: role === "Основной",
  };
  return { kind: "accepted", sourceRecordKey, company };
}

export function sameCompany(
  left: Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion">,
  right: Omit<DiscoveredCompany, "rawFetchKey" | "parserVersion">,
): boolean {
  return left.inn === right.inn
    && left.name === right.name
    && left.website === right.website
    && left.phone === right.phone
    && left.email === right.email
    && left.okvedCode === right.okvedCode
    && left.isPrimary === right.isPrimary;
}
