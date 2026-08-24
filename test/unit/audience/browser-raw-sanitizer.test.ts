import { describe, expect, it } from "vitest";

import type { BrowserRawBundle } from "../../../src/modules/audience/domain/discovery";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";

describe("browser raw sanitizer persistence boundary", () => {
  it.each([
    ["password", '<input type="password" name="password" value="pw-123">'],
    ["csrf", '<input type="text" name="csrf_token" value="csrf-123">'],
    ["api key", '<input type="text" name="api_key" value="api-123">'],
    ["unknown visible value", '<input type="text" name="public_field" value="visible-123">'],
  ])("rejects %s markup at the checksum boundary", (_case, input) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body>${input}</body></html>`,
    ))).toThrow("raw redaction scan failed");
  });

  it("rejects unsafe attributes after a quoted greater-than at the checksum boundary", () => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      '<!doctype html><html><body><input name="public>field" value="visible-123"></body></html>',
    ))).toThrow("raw redaction scan failed");
  });

  it.each([
    ["slash separator", "<input/value=visible-123>"],
    ["self-closing slash separator", "<input/value=visible-123/>"],
    ["whitespace then slash separator", "<input /value=visible-123>"],
    ["tab then slash separator", "<input \t/value=visible-123>"],
    ["repeated spaced slash separator", "<input / /value=visible-123>"],
    ["repeated slash separator", "<input //value=visible-123>"],
    ["newline-separated slashes", "<input /\n/value=visible-123>"],
    ["slash then tab separator", "<input / \tvalue=visible-123>"],
  ])("rejects a malformed %s at the checksum boundary", (_case, input) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body>${input}</body></html>`,
    ))).toThrow("raw redaction scan failed");
  });

  it.each([
    ["empty", "<input/>"],
    ["safe attributes", '<input type="text" name="public_field" />'],
  ])("accepts a valid %s self-closing input", (_case, input) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body>${input}</body></html>`,
    ))).not.toThrow();
  });

  it("rejects a configured-only sensitive name at the checksum boundary", () => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      '<!doctype html><html><body><input type="text" name="nonce"></body></html>',
      ["NoNcE"],
    ))).toThrow("raw redaction scan failed");
  });
});

function rawBundle(
  dom: string,
  sensitiveFormFieldNames: readonly string[] = [],
): BrowserRawBundle {
  return {
    sourceKind: "list-org-browser",
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "https://fixture.invalid/company/1001",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8: new TextEncoder().encode(dom),
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71]),
    pageFingerprintSha256: "0".repeat(64),
    identity: { runId: "browser-sanitizer-test", page: 1, sourceRecordKey: "1001" },
    candidateEvidence: null,
    actions: [],
    sensitiveFormFieldNames,
  };
}
