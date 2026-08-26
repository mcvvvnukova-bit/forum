import { describe, expect, it } from "vitest";

import type { BrowserRawBundle } from "../../../src/modules/audience/domain/discovery";
import {
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  assertBrowserCaptureSafe,
  browserVisualSafetyTarget,
  sanitizeBrowserActionTarget,
  sanitizeBrowserUrl,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import { checksumBrowserRawBundle, sha256 } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";

describe("browser raw sanitizer persistence boundary", () => {
  it.each(["list-org-live", "fns-bfo-live"])(
    "applies browser DOM and sensitive-policy checks to %s projection evidence",
    (sourceKind) => {
      expect(() => checksumBrowserRawBundle(liveProjectionBundle(
        '<!doctype html><html><body><input name="public" value="must-not-persist"></body></html>',
        sourceKind,
      ))).toThrow("raw redaction scan failed");

      const incomplete = liveProjectionBundle(
        "<!doctype html><html><body><main>safe</main></body></html>",
        sourceKind,
      );
      incomplete.sensitiveFormFieldNames = [];
      expect(() => checksumBrowserRawBundle(incomplete)).toThrow(
        "browser raw bundle sensitive form policy is incomplete",
      );
    },
  );

  it.each([
    ["a non-empty screenshot", (bundle: BrowserRawBundle) => {
      bundle.redactedScreenshotPng = new Uint8Array([137, 80, 78, 71]);
    }],
    ["a visual-safety action copied from a full-page capture", (bundle: BrowserRawBundle) => {
      bundle.actions = visualSafetyProof(bundle.pageFingerprintSha256);
    }],
    ["a fingerprint unrelated to the projection DOM", (bundle: BrowserRawBundle) => {
      bundle.pageFingerprintSha256 = "f".repeat(64);
    }],
  ] as const)("rejects every projection-profile source with %s", (_case, mutate) => {
    for (const sourceKind of ["list-org-live", "fns-bfo-live"]) {
      const bundle = liveProjectionBundle(
        "<!doctype html><html><body><main>safe</main></body></html>",
        sourceKind,
      );
      mutate(bundle);

      expect(() => checksumBrowserRawBundle(bundle)).toThrow(/live browser projection|fingerprint/u);
    }
  });

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

  it.each([
    ["final URL", (value: string) => sanitizeBrowserUrl(value, [])],
    ["candidate website", (value: string) => sanitizeBrowserUrl(value, [])],
    ["action target", (value: string) => sanitizeBrowserActionTarget(value, [], [])],
  ] as const)("strips userinfo and fragments from a retained %s", (_surface, sanitize) => {
    expect(sanitize(
      "https://userinfo-name:userinfo-pass@localhost/results?public=kept#token=fragment-secret",
    )).toBe("https://localhost/results?public=kept");
  });

  it("strips fragments from a relative action target without making it absolute", () => {
    expect(sanitizeBrowserActionTarget(
      "/results/page-1?public=kept#token=fragment-secret",
      [],
      [],
    )).toBe("/results/page-1?public=kept");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///tmp/unsafe",
  ])("rejects the non-http retained URL protocol in %s", (value) => {
    expect(() => sanitizeBrowserUrl(value, [])).toThrow(
      "retained browser URL protocol is not allowed",
    );
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,unsafe"],
    ["file", "file:///tmp/unsafe"],
    ["encoded javascript", "java&#115;cript:alert(1)"],
  ])("rejects a serialized %s DOM href at the checksum boundary", (_case, href) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body><a href="${href}">unsafe</a></body></html>`,
    ))).toThrow("raw redaction scan failed");
  });

  it.each([
    "/relative/path",
    "../relative/path",
    "//fixture.invalid/protocol-relative",
  ])("retains safe relative or protocol-relative DOM navigation %s", (href) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body><a href="${href}">safe</a></body></html>`,
    ))).not.toThrow();
  });

  it("rejects a non-http candidate website at the checksum boundary", () => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    bundle.candidateEvidence = {
      sourceRecordKey: "1001",
      inn: "7707083893",
      name: "Safe company",
      website: "javascript:alert(1)",
      okvedCode: "43.11",
      isPrimary: true,
      phone: { kind: "null" },
      email: { kind: "null" },
    };

    expect(() => checksumBrowserRawBundle(bundle)).toThrow("raw redaction scan failed");
  });

  it.each([
    ["relative action target", "action", "/results/page-1#overview"],
    ["relative DOM href", "dom", "/public#overview"],
  ])("structurally rejects a fragment in a stored %s", (_case, surface, value) => {
    const bundle = rawBundle(
      surface === "dom"
        ? `<!doctype html><html><body><a href="${value}">Public</a></body></html>`
        : "<!doctype html><html><body><main>safe</main></body></html>",
    );
    if (surface === "action") {
      bundle.actions = [...visualSafetyProof(), {
        id: "123e4567-e89b-42d3-a456-426614174000",
        at: "2026-08-24T09:00:00.000Z",
        kind: "navigate",
        target: value,
        outcome: "completed",
        navigationStatus: 200,
      }];
    }

    expect(() => checksumBrowserRawBundle(bundle)).toThrow("raw redaction scan failed");
  });

  it.each([
    ["named fragment", "https://fixture.invalid/public&num;href-fragment-secret"],
    ["semicolonless named-like form", "https://fixture.invalid/public&num"],
    ["named userinfo", "https://href-user&commat;localhost/public"],
    ["unknown name", "https://fixture.invalid/public&unknown;value"],
    ["raw ambiguous ampersand", "https://fixture.invalid/public?a=1&next=2"],
  ])("rejects a noncanonical serialized DOM href with %s", (_case, href) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body><a href="${href}">Public</a></body></html>`,
    ))).toThrow("raw redaction scan failed");
  });

  it.each([
    "https://fixture.invalid/public?a=1&amp;next=2",
    "https://fixture.invalid/public/a&amp;b",
    "https://fixture.invalid/public/a&quot;b",
    "https://fixture.invalid/public/a&apos;b",
    "https://fixture.invalid/public/a&#38;b",
  ])("accepts a canonical serialized DOM href %s", (href) => {
    expect(() => checksumBrowserRawBundle(rawBundle(
      `<!doctype html><html><body><a href="${href}">Public</a></body></html>`,
    ))).not.toThrow();
  });

  it.each([
    ["plain 8", "Phone8 (495) 111-22-33"],
    ["compact +7", "Phone+7 (495) 111-22-33"],
  ])("rejects a %s phone number in action metadata at the checksum boundary", (_case, target) => {
    const bundle = rawBundle(
      "<!doctype html><html><body><main>safe</main></body></html>",
    );
    bundle.actions = [...visualSafetyProof(), {
      id: "123e4567-e89b-42d3-a456-426614174000",
      at: "2026-08-24T09:00:00.000Z",
      kind: "navigate",
      target,
      outcome: "completed",
      navigationStatus: 200,
    }];

    expect(() => checksumBrowserRawBundle(bundle)).toThrow("raw redaction scan failed");
  });

  it.each([
    ["plain 8", "Phone8 (495) 111-22-33", "Phone[REDACTED]"],
    ["compact +7", "Phone+7 (495) 111-22-33", "Phone[REDACTED]"],
  ])("redacts a %s phone number from an action target", (_case, target, expected) => {
    expect(sanitizeBrowserActionTarget(target, [], [])).toBe(expected);
  });

  it("redacts after a length-changing Unicode fold without shifting original offsets", () => {
    expect(sanitizeBrowserActionTarget("İfoo", [], ["foo"])).toBe("İ[REDACTED]");
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

  it("rejects browser screenshot evidence without a completed versioned visual-safety proof", () => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    bundle.actions = [];

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser visual safety proof is missing",
    );
  });

  it.each([
    ["an incomplete intent", (proof: BrowserRawBundle["actions"]) => [proof[0]!]],
    ["a reordered pair", (proof: BrowserRawBundle["actions"]) => [proof[1]!, proof[0]!, proof[1]!]],
    ["a duplicate pair", (proof: BrowserRawBundle["actions"]) => [...proof, ...proof]],
    ["an unmatched intent", (proof: BrowserRawBundle["actions"]) => [{
      ...proof[0]!,
      id: "123e4567-e89b-42d3-a456-426614174008",
    }, ...proof]],
  ] as const)("rejects visual-safety proof history with %s", (_case, mutate) => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    bundle.actions = mutate(visualSafetyProof());

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser visual safety proof is invalid",
    );
  });

  it("binds the visual-safety proof to the exact sanitized page fingerprint", () => {
    const bundle = rawBundle("<!doctype html><html><body><main>safe</main></body></html>");
    bundle.pageFingerprintSha256 = "b".repeat(64);

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser visual safety proof is invalid",
    );
  });

  it("rejects contact material in an action ID at the checksum boundary", () => {
    const bundle = rawBundle(
      "<!doctype html><html><body><main>safe</main></body></html>",
    );
    bundle.actions = [...visualSafetyProof(), {
      id: "operator@example.test",
      at: "2026-08-24T09:00:00.000Z",
      kind: "navigate",
      target: "/results/page-1",
      outcome: "completed",
      navigationStatus: 200,
    }];

    expect(() => checksumBrowserRawBundle(bundle)).toThrow("raw redaction scan failed");
  });

  it("rejects a noncanonical action ID at the checksum boundary", () => {
    const bundle = rawBundle(
      "<!doctype html><html><body><main>safe</main></body></html>",
    );
    bundle.actions = [...visualSafetyProof(), {
      id: "action-1",
      at: "2026-08-24T09:00:00.000Z",
      kind: "navigate",
      target: "/results/page-1",
      outcome: "completed",
      navigationStatus: 200,
    }];

    expect(() => checksumBrowserRawBundle(bundle)).toThrow(
      "browser action id is not a canonical UUID v4",
    );
  });

  it("accepts a canonical action ID with a phone-like UUID substring", () => {
    const bundle = rawBundle(
      "<!doctype html><html><body><main>safe</main></body></html>",
    );
    bundle.actions = [...visualSafetyProof(), {
      id: "0b59e20b-7697-4506-945d-3167da214976",
      at: "2026-08-24T09:00:00.000Z",
      kind: "navigate",
      target: "/results/page-1",
      outcome: "completed",
      navigationStatus: 200,
    }];

    expect(() => checksumBrowserRawBundle(bundle)).not.toThrow();
  });

  it("rejects a canonical action ID supplied as a sensitive value", () => {
    const id = "0b59e20b-7697-4506-945d-3167da214976";
    const bundle = rawBundle(
      "<!doctype html><html><body><main>safe</main></body></html>",
    );
    bundle.actions = [...visualSafetyProof(), {
      id,
      at: "2026-08-24T09:00:00.000Z",
      kind: "navigate",
      target: "/results/page-1",
      outcome: "completed",
      navigationStatus: 200,
    }];

    expect(() => assertBrowserCaptureSafe(bundle, [id])).toThrow("raw redaction scan failed");
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
    actions: visualSafetyProof(),
    sensitiveFormFieldNames: [
      ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
      ...configuredSensitiveFormFieldNames,
    ],
  };
}

function liveProjectionBundle(dom: string, sourceKind = "list-org-live"): BrowserRawBundle {
  const sanitizedDomUtf8 = new TextEncoder().encode(dom);
  return {
    sourceKind,
    parserVersion: `${sourceKind}/1.0.0`,
    finalUrl: "https://fixture.invalid/company/1001",
    capturedAt: "2026-08-26T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8,
    redactedScreenshotPng: new Uint8Array(),
    pageFingerprintSha256: sha256(sanitizedDomUtf8),
    identity: { runId: "live-browser-sanitizer-test", page: 1, sourceRecordKey: "1001" },
    candidateEvidence: null,
    actions: [],
    sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
  };
}

function visualSafetyProof(pageFingerprintSha256 = "0".repeat(64)): BrowserRawBundle["actions"] {
  const id = "123e4567-e89b-42d3-a456-426614174009";
  const event = {
    id,
    at: "2026-08-24T09:00:00.000Z",
    kind: "verify-visual-safety",
    target: browserVisualSafetyTarget(pageFingerprintSha256),
    navigationStatus: 200,
  } as const;
  return [
    { ...event, outcome: "intent" },
    { ...event, outcome: "completed" },
  ];
}
