import { createHash } from "node:crypto";

import type {
  CandidateContactEvidence,
  CandidateEvidence,
  DiscoveredCompany,
} from "./discovery";

type CandidateFields = Pick<
  DiscoveredCompany,
  "sourceRecordKey" | "inn" | "name" | "website" | "phone" | "email" | "okvedCode" | "isPrimary"
>;

export function createCandidateEvidence(candidate: CandidateFields): CandidateEvidence {
  return {
    sourceRecordKey: candidate.sourceRecordKey,
    inn: candidate.inn,
    name: candidate.name,
    website: candidate.website,
    okvedCode: candidate.okvedCode,
    isPrimary: candidate.isPrimary,
    phone: contactEvidence(candidate.phone, false),
    email: contactEvidence(candidate.email, true),
  };
}

export function candidateMatchesEvidence(
  candidate: DiscoveredCompany,
  evidence: CandidateEvidence,
  parserVersion: string,
): boolean {
  const expected = createCandidateEvidence(candidate);
  return candidate.parserVersion === parserVersion
    && expected.sourceRecordKey === evidence.sourceRecordKey
    && expected.inn === evidence.inn
    && expected.name === evidence.name
    && expected.website === evidence.website
    && expected.okvedCode === evidence.okvedCode
    && expected.isPrimary === evidence.isPrimary
    && contactsEqual(expected.phone, evidence.phone)
    && contactsEqual(expected.email, evidence.email);
}

function contactEvidence(value: string | null, lowerCase: boolean): CandidateContactEvidence {
  if (value === null) return { kind: "null" };
  const normalized = value.replace(/\s+/g, " ").trim();
  const hashInput = lowerCase ? normalized.toLowerCase() : normalized;
  return {
    kind: "sha256",
    normalizedValueSha256: createHash("sha256").update(hashInput).digest("hex"),
  };
}

function contactsEqual(left: CandidateContactEvidence, right: CandidateContactEvidence): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "null" || right.kind === "null") return true;
  return left.normalizedValueSha256 === right.normalizedValueSha256;
}
