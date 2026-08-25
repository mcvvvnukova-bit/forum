import { describe, expect, it } from "vitest";

import type { BrowserRawBundle } from "../../../src/modules/audience/domain/discovery";
import {
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  sanitizeBrowserActionTarget,
  sanitizeBrowserUrl,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
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

  it.each([
    ["configured textarea", '<textarea name="nonce">nonce-secret</textarea>', ["nonce"]],
    ["generic API-key select", '<select name="api_key"><option selected>api-secret</option></select>', []],
    ["configured button", '<button name="nonce">nonce-secret</button>', ["nonce"]],
  ])("rejects serialized %s content at the checksum boundary", (_case, control, names) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body>${control}</body></html>`,
      names,
    ))).toThrow("raw redaction scan failed");
  });

  it.each(["api_key", "apikey"])("removes generic %s parameters from URLs and action targets", (name) => {
    const target = `https://fixture.invalid/search?public=kept&${name}=must-not-persist`;

    expect(sanitizeBrowserUrl(target, [])).toBe("https://fixture.invalid/search?public=kept");
    expect(sanitizeBrowserActionTarget(target, [], [])).toBe(
      "https://fixture.invalid/search?public=kept",
    );
  });

  it("rejects browser evidence whose persisted sensitive-name policy is missing", () => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    delete bundle.sensitiveFormFieldNames;

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser raw bundle sensitive form policy is incomplete",
    );
  });

  it("rejects a browser policy that omits a mandatory sensitive name", () => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    bundle.sensitiveFormFieldNames = MANDATORY_SENSITIVE_QUERY_PARAMETERS.filter(
      (name) => name !== "auth",
    );

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser raw bundle sensitive form policy is incomplete",
    );
  });

  it("rejects a configured-only query parameter during checksum verification", () => {
    expect(() => checksumBrowserRawBundle({
      ...rawBundle("<!doctype html><html><body><main>safe</main></body></html>", ["nonce"]),
      finalUrl: "https://fixture.invalid/company/1001?nonce=must-not-persist",
    })).toThrow("raw redaction scan failed");
  });
});

function rawBundle(
  dom: string,
  configuredSensitiveFormFieldNames: readonly string[] = [],
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
    sensitiveFormFieldNames: [
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...configuredSensitiveFormFieldNames,
    ],
  };
}
