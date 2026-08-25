import { createHash, randomUUID } from "node:crypto";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../../../src/shared/config/env";
import type { BrowserRawBundle } from "../../../src/modules/audience/domain/discovery";
import { MANDATORY_SENSITIVE_QUERY_PARAMETERS } from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
import { S3RawObjectStorage } from "../../../src/modules/audience/infrastructure/storage/s3-raw-object-storage";
import { checksumBrowserRawBundle } from "../../../src/modules/audience/infrastructure/storage/raw-bundle";

describe("S3RawObjectStorage", () => {
  const bucket = `okved-raw-test-${randomUUID()}`;
  const env: AppEnv = {
    appMode: "fixture",
    databaseUrl: "postgresql://unused",
    s3Endpoint: "http://127.0.0.1:9000",
    s3Bucket: bucket,
    s3AccessKeyId: "okved-local",
    s3SecretAccessKey: "okved-local-secret",
    listOrgLiveEnabled: false,
  };
  const client = new S3Client({
    endpoint: env.s3Endpoint,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
  });

  beforeAll(async () => {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  });

  afterAll(async () => {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket }));
    const objects = (listed.Contents ?? []).flatMap((item) => item.Key === undefined ? [] : [{ Key: item.Key }]);
    if (objects.length > 0) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
    }
    await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    client.destroy();
  });

  it("writes a checksummed bundle once and treats identical conditional retries as success", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    const bundle = sampleBundle("s3-idempotent");

    const first = await storage.put(bundle);
    const second = await storage.put(bundle);

    expect(second).toEqual(first);
    expect(first.prefix).toBe(
      `raw/s3-idempotent/list-org-browser/${bundle.checksumSha256}`,
    );
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${first.prefix}/`,
    }));
    expect(listed.Contents?.map((item) => item.Key).sort()).toEqual([
      first.domKey,
      first.manifestKey,
      first.screenshotKey,
    ].sort());

    const manifestResponse = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: first.manifestKey,
    }));
    const manifest = JSON.parse(await manifestResponse.Body!.transformToString()) as {
      version: number;
      artifacts: { sanitizedDom: { checksumSha256: string } };
      candidateEvidence: unknown;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.artifacts.sanitizedDom.checksumSha256).toBe(
      bundle.artifacts.sanitizedDomSha256,
    );
    expect(manifest.candidateEvidence).toEqual(bundle.candidateEvidence);
    expect(JSON.stringify(manifest)).not.toMatch(/\+7 \(495\) 111-22-33|info@alpha\.example/i);
  });

  it("destroys an owned S3 client exactly once on close", () => {
    const destroy = vi.spyOn(S3Client.prototype, "destroy");
    const storage = new S3RawObjectStorage(env, "list-org-browser");
    try {
      storage.close();
      storage.close();
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      destroy.mockRestore();
    }
  });

  it("fails an immutable-key collision when existing bytes differ", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    const bundle = sampleBundle("s3-collision");
    const manifestKey = [
      "raw",
      bundle.identity.runId,
      "list-org-browser",
      bundle.checksumSha256,
      "manifest.json",
    ].join("/");
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: manifestKey,
      Body: "corrupt existing bytes",
      ContentType: "application/json",
    }));

    await expect(storage.put(bundle)).rejects.toThrow(`immutable object collision at ${manifestKey}`);
  });

  it("does not publish the manifest commit marker when an artifact write fails", async () => {
    const faultClient = new S3Client({
      endpoint: env.s3Endpoint,
      region: "us-east-1",
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
    faultClient.middlewareStack.add(
      (next) => async (args) => {
        const input = args.input as { Key?: string };
        if (input.Key?.endsWith("/screenshot.png") === true) {
          throw new Error("injected screenshot artifact failure");
        }
        return next(args);
      },
      { step: "initialize", name: "injectScreenshotArtifactFailure" },
    );
    const bundle = sampleBundle("s3-artifact-failure");
    const prefix = `raw/${bundle.identity.runId}/list-org-browser/${bundle.checksumSha256}`;

    try {
      const storage = new S3RawObjectStorage(env, "list-org-browser", faultClient);
      await expect(storage.put(bundle)).rejects.toThrow("injected screenshot artifact failure");

      const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/` }));
      expect(listed.Contents?.map((item) => item.Key)).toEqual([`${prefix}/dom.html`]);
    } finally {
      faultClient.destroy();
    }
  });

  it.each([
    ["contact in DOM", { sanitizedDomUtf8: new TextEncoder().encode('<a href="mailto:info@alpha.example">email</a>') }],
    ["secret query in final URL", { finalUrl: "https://fixture.invalid/page?token=must-not-persist" }],
    ["secret in action metadata", {
      actions: [{
        id: "123e4567-e89b-42d3-a456-426614174000",
        at: "2026-08-24T09:00:00.000Z",
        kind: "navigate",
        target: "https://fixture.invalid/?tenant_secret=must-not-persist",
        outcome: "completed" as const,
        navigationStatus: 200,
      }],
    }],
    ["contact in manifest candidate evidence", {
      candidateEvidence: {
        ...sampleRawBundle("ignored").candidateEvidence!,
        name: "АО info@alpha.example",
      },
    }],
    ["secret in manifest candidate website", {
      candidateEvidence: {
        ...sampleRawBundle("ignored").candidateEvidence!,
        website: "https://alpha.example/?tenant_secret=must-not-persist",
      },
    }],
  ])("fails closed before checksumming raw evidence with %s", (_case, override) => {
    const raw = {
      ...sampleRawBundle("s3-redaction-rejected"),
      ...override,
    };

    expect(() => checksumBrowserRawBundle(raw)).toThrow("raw redaction scan failed");
  });

  it("rejects checksum-consistent stored DOM that violates its configured form policy", async () => {
    const runId = "s3-configured-form-policy";
    const domBytes = new TextEncoder().encode(
      '<!doctype html><html><body><input type="text" name="nonce"></body></html>',
    );
    const screenshotBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const manifestBytes = new TextEncoder().encode(JSON.stringify({
      version: 2,
      sourceKind: "list-org-browser",
      parserVersion: "list-org-browser/1.0.0",
      sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS, "nonce"],
      finalUrl: "http://127.0.0.1:33333/results/page-1",
      capturedAt: "2026-08-24T09:00:00.000Z",
      navigationStatus: 200,
      pageFingerprintSha256: fixtureSha256(domBytes),
      identity: { runId, page: 1, sourceRecordKey: "1001" },
      candidateEvidence: null,
      actions: [],
      artifacts: {
        sanitizedDom: { file: "dom.html", checksumSha256: fixtureSha256(domBytes) },
        redactedScreenshot: {
          file: "screenshot.png",
          checksumSha256: fixtureSha256(screenshotBytes),
        },
      },
    }));
    const checksumSha256 = fixtureSha256(manifestBytes);
    const prefix = `raw/${runId}/list-org-browser/${checksumSha256}`;
    const stored = {
      runId,
      sourceKind: "list-org-browser",
      sourceRecordKey: "1001",
      parserVersion: "list-org-browser/1.0.0",
      checksumSha256,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      domKey: `${prefix}/dom.html`,
      screenshotKey: `${prefix}/screenshot.png`,
    };
    await Promise.all([
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.domKey, Body: domBytes })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.screenshotKey,
        Body: screenshotBytes,
      })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.manifestKey,
        Body: manifestBytes,
      })),
    ]);

    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(storage.verify(stored)).rejects.toThrow("raw redaction scan failed");
  });

  const hostileManifestCases: Array<[
    string,
    string,
    (manifest: MutableBrowserManifestFixture) => void,
  ]> = [
    ["final URL", "final-url", (manifest: MutableBrowserManifestFixture) => {
      manifest.finalUrl = "https://fixture.invalid/page?nonce=final-secret";
    }],
    ["action target", "action-target", (manifest: MutableBrowserManifestFixture) => {
      manifest.actions[0]!.target = "https://fixture.invalid/page?nonce=action-secret";
    }],
    ["candidate website", "candidate-website", (manifest: MutableBrowserManifestFixture) => {
      manifest.candidateEvidence.website = "https://fixture.invalid/?nonce=website-secret";
    }],
  ];

  it.each(hostileManifestCases)(
    "rejects checksum-consistent configured secret in %s",
    async (_case, runSlug, mutate) => {
      const stored = await putChecksumConsistentBrowserManifest(
        `s3-hostile-${runSlug}`,
        (manifest) => {
          manifest.sensitiveFormFieldNames = [
            ...MANDATORY_SENSITIVE_QUERY_PARAMETERS,
            "nonce",
          ];
          mutate(manifest);
        },
      );

      const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
      await expect(browserStorage.verify(stored)).rejects.toThrow("raw redaction scan failed");
    },
  );

  it("rejects a checksum-consistent browser manifest with an incomplete policy", async () => {
    const stored = await putChecksumConsistentBrowserManifest(
      "s3-incomplete-browser-policy",
      (manifest) => {
        manifest.sensitiveFormFieldNames = [];
        manifest.finalUrl = "https://fixture.invalid/page?auth=must-not-pass";
      },
    );

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "browser raw bundle sensitive form policy is incomplete",
    );
  });

  it("rejects checksum-consistent manifest bytes that are not valid UTF-8", async () => {
    const bundle = sampleBundle("s3-invalid-utf8-manifest");
    const manifestBytes = bundle.manifestUtf8.slice();
    const capturedAtOffset = indexOfBytes(
      manifestBytes,
      new TextEncoder().encode(bundle.capturedAt),
    );
    expect(capturedAtOffset).toBeGreaterThanOrEqual(0);
    manifestBytes[capturedAtOffset] = 0x80;
    const stored = await putManifestBytes(bundle, manifestBytes);

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "raw object checksum verification failed",
    );
  });

  it.each([
    ["an unknown top-level secret", "unknown-top-level", (manifest: MutableBrowserManifestFixture) => {
      manifest.persistedSecret = "must-not-survive-verification";
    }],
    ["an extra artifact field", "extra-artifact-field", (manifest: MutableBrowserManifestFixture) => {
      manifest.artifacts.sanitizedDom.persistedSecret = "must-not-survive-verification";
    }],
  ] as const)("rejects checksum-consistent v2 manifest with %s", async (
    _case,
    runSlug,
    mutate,
  ) => {
    const stored = await putChecksumConsistentBrowserManifest(`s3-${runSlug}`, mutate);

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "raw object checksum verification failed",
    );
  });

  it.each([
    ["a non-canonical capture timestamp", "capture-time", (manifest: MutableBrowserManifestFixture) => {
      manifest.capturedAt = "2026-08-24T09:00:00Z";
    }],
    ["an impossible capture timestamp", "impossible-capture-time", (manifest: MutableBrowserManifestFixture) => {
      manifest.capturedAt = "2026-02-30T09:00:00.000Z";
    }],
    ["an out-of-range navigation status", "navigation-status", (manifest: MutableBrowserManifestFixture) => {
      manifest.navigationStatus = 99;
    }],
    ["an uppercase page fingerprint hash", "uppercase-page-hash", (manifest: MutableBrowserManifestFixture) => {
      manifest.pageFingerprintSha256 = "A".repeat(64);
    }],
    ["a non-canonical action timestamp", "action-time", (manifest: MutableBrowserManifestFixture) => {
      manifest.actions[0]!.at = "not-an-iso-timestamp";
    }],
    ["a non-positive identity page", "identity-page", (manifest: MutableBrowserManifestFixture) => {
      manifest.identity.page = 0;
    }],
  ] as const)("rejects checksum-consistent v2 manifest with %s", async (
    _case,
    runSlug,
    mutate,
  ) => {
    const stored = await putChecksumConsistentBrowserManifest(`s3-invalid-${runSlug}`, mutate);

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "raw object checksum verification failed",
    );
  });

  it("rejects a checksum-consistent page fingerprint that does not match the verified DOM", async () => {
    const stored = await putChecksumConsistentBrowserManifest(
      "s3-page-fingerprint-dom-mismatch",
      (manifest) => {
        manifest.pageFingerprintSha256 = "d".repeat(64);
      },
    );

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "raw object checksum verification failed",
    );
  });

  const unsafeRetainedTextCases: Array<[
    string,
    string,
    (manifest: MutableBrowserManifestFixture) => StoredManifestIdentityOverrides | void,
  ]> = [
    ["empty final URL", "empty-final-url", (manifest) => {
      manifest.finalUrl = "";
    }],
    ["unsafe parser version", "unsafe-parser-version", (manifest) => {
      const parserVersion = "list-org-browser/1.0.0\u0000forged";
      manifest.parserVersion = parserVersion;
      return { parserVersion };
    }],
    ["unsafe source record identity", "unsafe-source-record-key", (manifest) => {
      const sourceRecordKey = "1001\u0000forged";
      manifest.identity.sourceRecordKey = sourceRecordKey;
      manifest.candidateEvidence.sourceRecordKey = sourceRecordKey;
      return { sourceRecordKey };
    }],
    ["empty candidate INN", "empty-candidate-inn", (manifest) => {
      manifest.candidateEvidence.inn = "";
    }],
    ["empty candidate name", "empty-candidate-name", (manifest) => {
      manifest.candidateEvidence.name = "";
    }],
    ["empty candidate website", "empty-candidate-website", (manifest) => {
      manifest.candidateEvidence.website = "";
    }],
    ["empty candidate OKVED", "empty-candidate-okved", (manifest) => {
      manifest.candidateEvidence.okvedCode = "";
    }],
    ["empty configured sensitive name", "empty-sensitive-name", (manifest) => {
      manifest.sensitiveFormFieldNames.push("");
    }],
    ["empty action id", "empty-action-id", (manifest) => {
      manifest.actions[0]!.id = "";
    }],
    ["empty action kind", "empty-action-kind", (manifest) => {
      manifest.actions[0]!.kind = "";
    }],
    ["empty action target", "empty-action-target", (manifest) => {
      manifest.actions[0]!.target = "";
    }],
  ];

  it.each(unsafeRetainedTextCases)(
    "rejects checksum-consistent v2 manifest with %s",
    async (_case, runSlug, mutate) => {
      let overrides: StoredManifestIdentityOverrides | void;
      const stored = await putChecksumConsistentBrowserManifest(
        `s3-retained-text-${runSlug}`,
        (manifest) => {
          overrides = mutate(manifest);
        },
        () => overrides,
      );

      const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
      await expect(browserStorage.verify(stored)).rejects.toThrow(
        /raw object (?:checksum|identity) verification failed/,
      );
    },
  );

  it("quarantines a legacy browser manifest that has no persisted form policy", async () => {
    const bundle = sampleBundle("s3-legacy-browser-manifest");
    const legacy = JSON.parse(new TextDecoder().decode(bundle.manifestUtf8)) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.sensitiveFormFieldNames;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(legacy));
    const checksumSha256 = fixtureSha256(manifestBytes);
    const prefix = `raw/${bundle.identity.runId}/list-org-browser/${checksumSha256}`;
    const stored = {
      runId: bundle.identity.runId,
      sourceKind: "list-org-browser",
      sourceRecordKey: "1001",
      parserVersion: bundle.parserVersion,
      checksumSha256,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      domKey: `${prefix}/dom.html`,
      screenshotKey: `${prefix}/screenshot.png`,
    };
    await Promise.all([
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.domKey, Body: bundle.sanitizedDomUtf8 })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.screenshotKey,
        Body: bundle.redactedScreenshotPng,
      })),
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.manifestKey, Body: manifestBytes })),
    ]);

    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(storage.verify(stored)).rejects.toThrow(
      "raw manifest version 1 is unsupported for browser evidence",
    );
  });

  it("intentionally verifies a legacy non-browser manifest without browser form policy", async () => {
    const bundle = checksumBrowserRawBundle({
      ...sampleRawBundle("s3-legacy-financial-manifest"),
      sourceKind: "fns-bfo",
      candidateEvidence: null,
    });
    const legacy = JSON.parse(new TextDecoder().decode(bundle.manifestUtf8)) as Record<string, unknown>;
    legacy.version = 1;
    delete legacy.sensitiveFormFieldNames;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(legacy));
    const checksumSha256 = fixtureSha256(manifestBytes);
    const prefix = `raw/${bundle.identity.runId}/fns-bfo/${checksumSha256}`;
    const stored = {
      runId: bundle.identity.runId,
      sourceKind: "fns-bfo",
      sourceRecordKey: "1001",
      parserVersion: bundle.parserVersion,
      checksumSha256,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      domKey: `${prefix}/dom.html`,
      screenshotKey: `${prefix}/screenshot.png`,
    };
    await Promise.all([
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.domKey, Body: bundle.sanitizedDomUtf8 })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.screenshotKey,
        Body: bundle.redactedScreenshotPng,
      })),
      client.send(new PutObjectCommand({ Bucket: bucket, Key: stored.manifestKey, Body: manifestBytes })),
    ]);

    const storage = new S3RawObjectStorage(env, "fns-bfo", client);
    await expect(storage.verify(stored)).resolves.toMatchObject({
      sourceKind: "fns-bfo",
      sourceRecordKey: "1001",
      checksumSha256,
    });
  });

  it("rejects a legacy non-browser manifest carrying a v2-only policy field", async () => {
    const bundle = checksumBrowserRawBundle({
      ...sampleRawBundle("s3-legacy-financial-extra-field"),
      sourceKind: "fns-bfo",
      candidateEvidence: null,
    });
    const legacy = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as Record<string, unknown>;
    legacy.version = 1;
    const manifestBytes = new TextEncoder().encode(JSON.stringify(legacy));
    const stored = await putManifestBytes(bundle, manifestBytes);

    const storage = new S3RawObjectStorage(env, "fns-bfo", client);
    await expect(storage.verify(stored)).rejects.toThrow(
      "raw object checksum verification failed",
    );
  });

  it("rejects replay verification when a referenced raw artifact no longer matches its manifest", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    const stored = await storage.put(sampleBundle("s3-verified-read"));

    await expect(storage.verify(stored)).resolves.toMatchObject({
      checksumSha256: stored.checksumSha256,
      parserVersion: "list-org-browser/1.0.0",
      candidateEvidence: sampleBundle("ignored").candidateEvidence,
    });

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: stored.domKey,
      Body: "corrupted after capture",
      ContentType: "text/html; charset=utf-8",
    }));

    await expect(storage.verify(stored)).rejects.toThrow("raw object checksum verification failed");
  });

  it.each([
    ["run", { runId: "s3-expected-owner" }],
    ["source", { sourceKind: "fns-bfo" }],
    ["record", { sourceRecordKey: "9999" }],
    ["parser", { parserVersion: "list-org-browser/9.9.9" }],
  ])("rejects a checksum-valid manifest with the wrong expected %s identity", async (
    _case,
    expectedOverride,
  ) => {
    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    const stored = await storage.put(sampleBundle("s3-foreign-owner"));
    const expected = {
      ...stored,
      runId: "s3-foreign-owner",
      sourceKind: "list-org-browser",
      sourceRecordKey: "1001",
      parserVersion: "list-org-browser/1.0.0",
      ...expectedOverride,
    };

    await expect(storage.verify(expected)).rejects.toThrow("raw object identity verification failed");
  });

  it("rejects a self-consistent object owned by a different source adapter", async () => {
    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    const foreignStorage = new S3RawObjectStorage(env, "fns-bfo", client);
    const foreignBundle = checksumBrowserRawBundle({
      ...sampleRawBundle("s3-foreign-source"),
      sourceKind: "fns-bfo",
      candidateEvidence: null,
    });
    const foreignObject = await foreignStorage.put(foreignBundle);

    await expect(browserStorage.verify(foreignObject)).rejects.toThrow(
      "raw object identity verification failed",
    );
  });

  async function putChecksumConsistentBrowserManifest(
    runId: string,
    mutate: (manifest: MutableBrowserManifestFixture) => void,
    expectedIdentity: () => StoredManifestIdentityOverrides | void = () => undefined,
  ) {
    const bundle = sampleBundle(runId);
    const manifest = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as MutableBrowserManifestFixture;
    mutate(manifest);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return putManifestBytes(bundle, manifestBytes, expectedIdentity() ?? {});
  }

  async function putManifestBytes(
    bundle: ReturnType<typeof sampleBundle>,
    manifestBytes: Uint8Array,
    expectedIdentity: StoredManifestIdentityOverrides = {},
  ) {
    const checksumSha256 = fixtureSha256(manifestBytes);
    const prefix = `raw/${bundle.identity.runId}/${bundle.sourceKind}/${checksumSha256}`;
    const stored = {
      runId: bundle.identity.runId,
      sourceKind: bundle.sourceKind,
      sourceRecordKey: expectedIdentity.sourceRecordKey ?? "1001",
      parserVersion: expectedIdentity.parserVersion ?? bundle.parserVersion,
      checksumSha256,
      prefix,
      manifestKey: `${prefix}/manifest.json`,
      domKey: `${prefix}/dom.html`,
      screenshotKey: `${prefix}/screenshot.png`,
    };
    await Promise.all([
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.domKey,
        Body: bundle.sanitizedDomUtf8,
      })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.screenshotKey,
        Body: bundle.redactedScreenshotPng,
      })),
      client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: stored.manifestKey,
        Body: manifestBytes,
      })),
    ]);
    return stored;
  }
});

function sampleBundle(runId: string) {
  return checksumBrowserRawBundle(sampleRawBundle(runId));
}

interface MutableBrowserManifestFixture extends Record<string, unknown> {
  parserVersion: string;
  sensitiveFormFieldNames: string[];
  finalUrl: string;
  capturedAt: string;
  navigationStatus: unknown;
  pageFingerprintSha256: string;
  identity: { runId: string; page: number; sourceRecordKey?: string };
  actions: Array<{
    id: string;
    at: string;
    kind: string;
    target: string;
    outcome: string;
    navigationStatus: number | null;
  }>;
  candidateEvidence: {
    sourceRecordKey: string;
    inn: string;
    name: string;
    website: string | null;
    okvedCode: string;
    isPrimary: boolean;
  };
  artifacts: {
    sanitizedDom: { file: string; checksumSha256: string; persistedSecret?: string };
    redactedScreenshot: { file: string; checksumSha256: string };
  };
}

interface StoredManifestIdentityOverrides {
  sourceRecordKey?: string;
  parserVersion?: string;
}

function fixtureSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((byte, index) => haystack[offset + index] === byte)) return offset;
  }
  return -1;
}

function sampleRawBundle(runId: string): BrowserRawBundle {
  const sanitizedDomUtf8 = new TextEncoder().encode(
    "<!doctype html><main>safe evidence</main>",
  );
  return {
    sourceKind: "list-org-browser",
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "http://127.0.0.1:33333/results/page-1",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8,
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: fixtureSha256(sanitizedDomUtf8),
    identity: { runId, page: 1, sourceRecordKey: "1001" },
    sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
    candidateEvidence: {
      sourceRecordKey: "1001",
      inn: "7707083893",
      name: "АО Альфа",
      website: "https://alpha.example",
      okvedCode: "43.11",
      isPrimary: true,
      phone: { kind: "sha256", normalizedValueSha256: "b".repeat(64) },
      email: { kind: "sha256", normalizedValueSha256: "c".repeat(64) },
    },
    actions: [
      {
        id: "123e4567-e89b-42d3-a456-426614174000",
        at: "2026-08-24T09:00:00.000Z",
        kind: "navigate",
        target: "/results/page-1",
        outcome: "completed",
        navigationStatus: 200,
      },
    ],
  };
}
