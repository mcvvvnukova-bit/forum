import { createHash } from "node:crypto";

import type {
  BrowserRawBundle,
  ChecksummedBrowserRawBundle,
} from "../../domain/discovery";
import { assertPersistableRawBundle } from "../sources/list-org-browser/browser-raw-sanitizer";

export const RAW_MANIFEST_VERSION = 2;

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function checksumBrowserRawBundle(bundle: BrowserRawBundle): ChecksummedBrowserRawBundle {
  assertPersistableRawBundle(bundle);
  const sanitizedDomSha256 = sha256(bundle.sanitizedDomUtf8);
  const redactedScreenshotSha256 = sha256(bundle.redactedScreenshotPng);
  const manifest = {
    version: RAW_MANIFEST_VERSION,
    sourceKind: bundle.sourceKind,
    parserVersion: bundle.parserVersion,
    sensitiveFormFieldNames: bundle.sensitiveFormFieldNames ?? [],
    finalUrl: bundle.finalUrl,
    capturedAt: bundle.capturedAt,
    navigationStatus: bundle.navigationStatus,
    pageFingerprintSha256: bundle.pageFingerprintSha256,
    identity: bundle.identity,
    candidateEvidence: bundle.candidateEvidence,
    actions: bundle.actions,
    artifacts: {
      sanitizedDom: { file: "dom.html", checksumSha256: sanitizedDomSha256 },
      redactedScreenshot: { file: "screenshot.png", checksumSha256: redactedScreenshotSha256 },
    },
  };
  const manifestUtf8 = new TextEncoder().encode(JSON.stringify(manifest));
  const manifestSha256 = sha256(manifestUtf8);

  return {
    ...bundle,
    checksumSha256: manifestSha256,
    artifacts: {
      sanitizedDomSha256,
      redactedScreenshotSha256,
      manifestSha256,
    },
    manifestUtf8,
  };
}
