import { createHash } from "node:crypto";

export const TERMINAL_BLOCK_REASONS = [
  "captcha",
  "captcha_aborted",
  "http_403",
  "http_failure",
  "soft_block",
  "policy_block",
  "contract_drift",
  "transport_failure",
  "duplicate_conflict",
] as const;

export type TerminalBlockReason = typeof TERMINAL_BLOCK_REASONS[number];

const terminalReasons = new Set<string>(TERMINAL_BLOCK_REASONS);

export function isTerminalBlockReason(value: unknown): value is TerminalBlockReason {
  return typeof value === "string" && terminalReasons.has(value);
}

/** Durable policy evidence is intentionally limited to a public origin/path.
 * Everything else is represented by a non-reversible digest. */
export function sanitizePolicyViolationIdentifier(value: string): string {
  if (/^sha256:[0-9a-f]{64}$/u.test(value)) return value;
  try {
    const url = new URL(value);
    if ((url.protocol === "http:" || url.protocol === "https:")
      && url.hostname !== "") {
      return `${url.origin}${url.pathname}`;
    }
  } catch { /* hashed below */ }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
