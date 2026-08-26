import { describe, expect, it } from "vitest";

import {
  isTerminalBlockReason,
  sanitizePolicyViolationIdentifier,
} from "../../../src/modules/audience/domain/terminal-block-reason";

describe("terminal source blockers", () => {
  it.each([
    "captcha", "captcha_aborted", "http_403", "http_failure", "soft_block",
    "policy_block", "contract_drift", "transport_failure", "duplicate_conflict",
  ])("accepts the shared terminal reason %s", (reason) => {
    expect(isTerminalBlockReason(reason)).toBe(true);
  });

  it("sanitizes policy evidence to origin/path and hashes non-HTTP payloads", () => {
    expect(sanitizePolicyViolationIdentifier(
      "https://user:password@example.test/private/path?token=secret#fragment",
    )).toBe("https://example.test/private/path");
    expect(sanitizePolicyViolationIdentifier("data:text/html,secret-payload"))
      .toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(sanitizePolicyViolationIdentifier("data:text/html,secret-payload"))
      .not.toContain("secret-payload");
    const hashed = sanitizePolicyViolationIdentifier("secondary-page");
    expect(sanitizePolicyViolationIdentifier(hashed)).toBe(hashed);
  });
});
