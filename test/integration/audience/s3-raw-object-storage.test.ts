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
import {
  MANDATORY_SENSITIVE_QUERY_PARAMETERS,
  browserVisualSafetyTarget,
} from "../../../src/modules/audience/infrastructure/sources/list-org-browser/browser-raw-sanitizer";
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
    fnsLiveEnabled: false,
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
      actions: [...visualSafetyProof(), {
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
      actions: visualSafetyProof(fixtureSha256(domBytes)),
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
      kind: "browser" as const,
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
      manifest.actions.find((action) => action.kind === "navigate")!.target =
        "https://fixture.invalid/page?nonce=action-secret";
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

  const unsafeRetainedUrlCases: Array<[
    string,
    string,
    (manifest: MutableBrowserManifestFixture) => void,
  ]> = [
    ["fragment in final URL", "final-fragment", (manifest) => {
      manifest.finalUrl = "https://fixture.invalid/page#token=final-secret";
    }],
    ["userinfo in final URL", "final-userinfo", (manifest) => {
      manifest.finalUrl = "https://userinfo-name:userinfo-pass@localhost/page";
    }],
    ["fragment in action target", "action-fragment", (manifest) => {
      manifest.actions.find((action) => action.kind === "navigate")!.target =
        "/page#token=action-secret";
    }],
    ["userinfo in action target", "action-userinfo", (manifest) => {
      manifest.actions.find((action) => action.kind === "navigate")!.target =
        "https://userinfo-name:userinfo-pass@localhost/page";
    }],
    ["fragment in candidate website", "candidate-fragment", (manifest) => {
      manifest.candidateEvidence.website = "https://company.example/#token=candidate-secret";
    }],
    ["userinfo in candidate website", "candidate-userinfo", (manifest) => {
      manifest.candidateEvidence.website = "https://userinfo-name:userinfo-pass@localhost/";
    }],
    ["javascript protocol in final URL", "final-javascript", (manifest) => {
      manifest.finalUrl = "javascript:alert(1)";
    }],
    ["data protocol in action target", "action-data", (manifest) => {
      manifest.actions.find((action) => action.kind === "navigate")!.target =
        "data:text/html,unsafe";
    }],
    ["file protocol in candidate website", "candidate-file", (manifest) => {
      manifest.candidateEvidence.website = "file:///tmp/unsafe";
    }],
  ];

  it.each(unsafeRetainedUrlCases)(
    "rejects checksum-consistent browser manifest with %s",
    async (_case, runSlug, mutate) => {
      const stored = await putChecksumConsistentBrowserManifest(
        `s3-unsafe-url-${runSlug}`,
        mutate,
      );

      const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
      await expect(browserStorage.verify(stored)).rejects.toThrow("raw redaction scan failed");
    },
  );

  it.each([
    ["fragment", "https://fixture.invalid/public#token=dom-secret"],
    ["userinfo", "https://userinfo-name:userinfo-pass@localhost/public"],
    ["named fragment", "https://fixture.invalid/public&num;href-fragment-secret"],
    ["named userinfo", "https://href-user&commat;localhost/public"],
    ["javascript protocol", "javascript:alert(1)"],
    ["data protocol", "data:text/html,unsafe"],
    ["file protocol", "file:///tmp/unsafe"],
    ["encoded javascript protocol", "java&#115;cript:alert(1)"],
  ])("rejects checksum-consistent serialized DOM href with %s", async (_case, href) => {
    const domBytes = new TextEncoder().encode(
      `<!doctype html><html><body><a href="${href}">Public</a></body></html>`,
    );
    const stored = await putChecksumConsistentBrowserManifest(
      `s3-unsafe-dom-href-${_case.replaceAll(" ", "-")}`,
      (manifest) => {
        manifest.pageFingerprintSha256 = fixtureSha256(domBytes);
        manifest.artifacts.sanitizedDom.checksumSha256 = fixtureSha256(domBytes);
        for (const action of manifest.actions.filter(
          (item) => item.kind === "verify-visual-safety",
        )) {
          action.target = browserVisualSafetyTarget(manifest.pageFingerprintSha256);
        }
      },
      () => undefined,
      domBytes,
    );

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow("raw redaction scan failed");
  });

  it("rejects checksum-consistent browser screenshot evidence without visual-safety proof", async () => {
    const stored = await putChecksumConsistentBrowserManifest(
      "s3-missing-visual-safety-proof",
      (manifest) => {
        manifest.actions = manifest.actions.filter(
          (action) => action.kind !== "verify-visual-safety",
        );
      },
    );

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "browser visual safety proof is missing",
    );
  });

  it.each([
    ["a duplicate pair", (actions: MutableBrowserManifestFixture["actions"]) => [
      ...actions,
      ...actions.filter((action) => action.kind === "verify-visual-safety"),
    ]],
    ["an unmatched intent", (actions: MutableBrowserManifestFixture["actions"]) => [{
      ...actions.find((action) => action.kind === "verify-visual-safety")!,
      id: "123e4567-e89b-42d3-a456-426614174008",
    }, ...actions]],
    ["a reordered terminal sequence", (actions: MutableBrowserManifestFixture["actions"]) => {
      const visual = actions.filter((action) => action.kind === "verify-visual-safety");
      const other = actions.filter((action) => action.kind !== "verify-visual-safety");
      return [visual[1]!, visual[0]!, visual[1]!, ...other];
    }],
  ] as const)("rejects checksum-consistent visual proof history with %s", async (
    _case,
    mutate,
  ) => {
    const stored = await putChecksumConsistentBrowserManifest(
      `s3-malformed-visual-proof-${_case.replaceAll(" ", "-")}`,
      (manifest) => {
        manifest.actions = mutate(manifest.actions);
      },
    );

    const browserStorage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(browserStorage.verify(stored)).rejects.toThrow(
      "browser visual safety proof is invalid",
    );
  });

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

  it.each([
    ["contact material", "operator@example.test"],
    ["uppercase UUID", "123E4567-E89B-42D3-A456-426614174000"],
    ["non-v4 UUID", "123e4567-e89b-12d3-a456-426614174000"],
    ["non-standard UUID variant", "123e4567-e89b-42d3-7456-426614174000"],
  ] as const)("rejects checksum-consistent action ID with %s", async (_case, id) => {
    const stored = await putChecksumConsistentBrowserManifest(
      `s3-invalid-action-id-${_case.replaceAll(" ", "-")}`,
      (manifest) => {
        manifest.actions[0]!.id = id;
      },
    );

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

  it.each([
    ["without form policy", (manifest: Record<string, unknown>) => {
      delete manifest.sensitiveFormFieldNames;
    }],
    ["with an empty form policy", (manifest: Record<string, unknown>) => {
      manifest.sensitiveFormFieldNames = [];
    }],
  ] as const)("quarantines legacy browser manifest %s", async (_case, mutate) => {
    const bundle = sampleBundle(`s3-legacy-browser-${_case.replaceAll(" ", "-")}`);
    const legacy = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as Record<string, unknown>;
    legacy.version = 1;
    mutate(legacy);
    const stored = await putManifestBytes(
      bundle,
      new TextEncoder().encode(JSON.stringify(legacy)),
    );

    const storage = new S3RawObjectStorage(env, "list-org-browser", client);
    await expect(storage.verify(stored)).rejects.toThrow(
      "raw manifest version 1 is unsupported for browser evidence",
    );
  });

  it("stores and re-verifies valid List-Org live projection evidence", async () => {
    const storage = new S3RawObjectStorage(env, "list-org-live", client);
    const stored = await storage.put(sampleLiveBundle("s3-live-valid"));

    await expect(storage.verify(stored)).resolves.toMatchObject({
      sourceKind: "list-org-live",
      sourceRecordKey: "1001",
    });
  });

  it("quarantines legacy List-Org live projection evidence", async () => {
    const bundle = sampleLiveBundle("s3-live-legacy");
    const manifest = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as Record<string, unknown>;
    manifest.version = 1;
    delete manifest.sensitiveFormFieldNames;
    const stored = await putManifestBytes(
      bundle,
      new TextEncoder().encode(JSON.stringify(manifest)),
    );

    const storage = new S3RawObjectStorage(env, "list-org-live", client);
    await expect(storage.verify(stored)).rejects.toThrow(
      "raw manifest version 1 is unsupported for browser evidence",
    );
  });

  it.each([
    ["unsafe DOM", (manifest: MutableBrowserManifestFixture, dom: Uint8Array) => {
      manifest.pageFingerprintSha256 = fixtureSha256(dom);
      manifest.artifacts.sanitizedDom.checksumSha256 = fixtureSha256(dom);
    }, new TextEncoder().encode('<!doctype html><html><body><input name="public" value="secret"></body></html>'), undefined],
    ["an incomplete sensitive-field policy", (manifest: MutableBrowserManifestFixture) => {
      manifest.sensitiveFormFieldNames = [];
    }, undefined, undefined],
    ["copied full-page visual proof", (manifest: MutableBrowserManifestFixture) => {
      manifest.actions = [...visualSafetyProof(manifest.pageFingerprintSha256)];
    }, undefined, undefined],
    ["a non-empty screenshot", (manifest: MutableBrowserManifestFixture, _dom: Uint8Array, screenshot: Uint8Array) => {
      manifest.artifacts.redactedScreenshot.checksumSha256 = fixtureSha256(screenshot);
    }, undefined, new Uint8Array([137, 80, 78, 71])],
  ] as const)("rejects checksum-consistent List-Org live evidence with %s", async (
    _case,
    mutate,
    domOverride,
    screenshotOverride,
  ) => {
    const bundle = sampleLiveBundle(`s3-live-${_case.replaceAll(" ", "-")}`);
    const dom = domOverride ?? bundle.sanitizedDomUtf8;
    const screenshot = screenshotOverride ?? bundle.redactedScreenshotPng;
    const manifest = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as MutableBrowserManifestFixture;
    mutate(manifest, dom, screenshot);
    const stored = await putManifestBytes(
      bundle,
      new TextEncoder().encode(JSON.stringify(manifest)),
      {},
      dom,
      screenshot,
    );

    const storage = new S3RawObjectStorage(env, "list-org-live", client);
    await expect(storage.verify(stored)).rejects.toThrow(/browser|redaction/u);
  });

  it.each([
    ["without form policy", (manifest: Record<string, unknown>) => {
      delete manifest.sensitiveFormFieldNames;
    }],
    ["with an empty form policy", (manifest: Record<string, unknown>) => {
      manifest.sensitiveFormFieldNames = [];
    }],
  ] as const)("verifies legacy non-browser manifest %s", async (_case, mutate) => {
    const stored = await putLegacyNonBrowserManifest(
      `s3-legacy-financial-${_case.replaceAll(" ", "-")}`,
      mutate,
    );

    const storage = new S3RawObjectStorage(env, "fns-bfo", client);
    await expect(storage.verify(stored)).resolves.toMatchObject({
      sourceKind: "fns-bfo",
      sourceRecordKey: "1001",
      checksumSha256: stored.checksumSha256,
    });
  });

  it.each([
    ["a non-empty form policy", (manifest: Record<string, unknown>) => {
      manifest.sensitiveFormFieldNames = ["auth"];
    }],
    ["a non-array form policy", (manifest: Record<string, unknown>) => {
      manifest.sensitiveFormFieldNames = "auth";
    }],
    ["an unknown field", (manifest: Record<string, unknown>) => {
      delete manifest.sensitiveFormFieldNames;
      manifest.persistedSecret = "must-not-survive-verification";
    }],
  ] as const)("rejects legacy non-browser manifest with %s", async (_case, mutate) => {
    const stored = await putLegacyNonBrowserManifest(
      `s3-invalid-legacy-financial-${_case.replaceAll(" ", "-")}`,
      mutate,
    );

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

  async function putLegacyNonBrowserManifest(
    runId: string,
    mutate: (manifest: Record<string, unknown>) => void,
  ) {
    const bundle = checksumBrowserRawBundle({
      ...sampleRawBundle(runId),
      sourceKind: "fns-bfo",
      candidateEvidence: null,
    });
    const manifest = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as Record<string, unknown>;
    manifest.version = 1;
    mutate(manifest);
    return putManifestBytes(
      bundle,
      new TextEncoder().encode(JSON.stringify(manifest)),
    );
  }

  async function putChecksumConsistentBrowserManifest(
    runId: string,
    mutate: (manifest: MutableBrowserManifestFixture) => void,
    expectedIdentity: () => StoredManifestIdentityOverrides | void = () => undefined,
    domBytes?: Uint8Array,
  ) {
    const bundle = sampleBundle(runId);
    const manifest = JSON.parse(
      new TextDecoder().decode(bundle.manifestUtf8),
    ) as MutableBrowserManifestFixture;
    mutate(manifest);
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    return putManifestBytes(bundle, manifestBytes, expectedIdentity() ?? {}, domBytes);
  }

  async function putManifestBytes(
    bundle: ReturnType<typeof sampleBundle>,
    manifestBytes: Uint8Array,
    expectedIdentity: StoredManifestIdentityOverrides = {},
    domBytes: Uint8Array = bundle.sanitizedDomUtf8,
    screenshotBytes: Uint8Array = bundle.redactedScreenshotPng,
  ) {
    const checksumSha256 = fixtureSha256(manifestBytes);
    const prefix = `raw/${bundle.identity.runId}/${bundle.sourceKind}/${checksumSha256}`;
    const stored = {
      kind: "browser" as const,
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
        Body: domBytes,
      })),
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
    return stored;
  }
});

function sampleBundle(runId: string) {
  return checksumBrowserRawBundle(sampleRawBundle(runId));
}

function sampleLiveBundle(runId: string) {
  const sanitizedDomUtf8 = new TextEncoder().encode(
    "<!doctype html><html><body><main><dt>ИНН / КПП:</dt><dd>7707083893 / 770001001</dd></main></body></html>",
  );
  return checksumBrowserRawBundle({
    sourceKind: "list-org-live",
    parserVersion: "list-org-live/1.0.0",
    finalUrl: "http://127.0.0.1:33333/company/1001",
    capturedAt: "2026-08-26T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8,
    redactedScreenshotPng: new Uint8Array(),
    pageFingerprintSha256: fixtureSha256(sanitizedDomUtf8),
    identity: { runId, page: 1, sourceRecordKey: "1001" },
    sensitiveFormFieldNames: [...MANDATORY_SENSITIVE_QUERY_PARAMETERS],
    candidateEvidence: {
      sourceRecordKey: "1001",
      inn: "7707083893",
      name: "АО Альфа",
      website: null,
      okvedCode: "43.11",
      isPrimary: true,
      phone: { kind: "null" },
      email: { kind: "null" },
    },
    actions: [],
  });
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
  const pageFingerprintSha256 = fixtureSha256(sanitizedDomUtf8);
  return {
    sourceKind: "list-org-browser",
    parserVersion: "list-org-browser/1.0.0",
    finalUrl: "http://127.0.0.1:33333/results/page-1",
    capturedAt: "2026-08-24T09:00:00.000Z",
    navigationStatus: 200,
    sanitizedDomUtf8,
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256,
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
      ...visualSafetyProof(pageFingerprintSha256),
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

function visualSafetyProof(
  pageFingerprintSha256 = fixtureSha256(new TextEncoder().encode(
    "<!doctype html><main>safe evidence</main>",
  )),
): BrowserRawBundle["actions"] {
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
