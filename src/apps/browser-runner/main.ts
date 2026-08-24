import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { publishFinancialEvidence } from "../../modules/audience/application/publish-financial-evidence";
import { reconcileRun } from "../../modules/audience/application/reconcile-run";
import { runFixtureDiscovery } from "../../modules/audience/application/run-fixture-discovery";
import type { CapturedRawObject } from "../../modules/audience/application/ports/audience-repository";
import { parseLegalEntityInn } from "../../modules/audience/domain/inn";
import { PostgresAudienceRepository } from "../../modules/audience/infrastructure/postgres/audience-repository";
import { PostgresOkvedRepository } from "../../modules/audience/infrastructure/postgres/okved-repository";
import { parseBfo } from "../../modules/audience/infrastructure/sources/fns-bfo/bfo-parser";
import { parseRevexp } from "../../modules/audience/infrastructure/sources/fns-revexp/revexp-parser";
import {
  ListOrgBrowserSource,
  PlaywrightBrowserSessionFactory,
} from "../../modules/audience/infrastructure/sources/list-org-browser/list-org-browser-source";
import { checksumBrowserRawBundle, sha256 } from "../../modules/audience/infrastructure/storage/raw-bundle";
import { S3RawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-raw-object-storage";
import { parseEnv, type AppEnv } from "../../shared/config/env";
import { PgBossJobQueue } from "../../shared/jobs/pg-boss-job-queue";
import { PostgresDatabase } from "../../shared/postgres/database";
import { CliInputError, parseAudienceCli } from "./cli";
import { startListOrgFixtureServer } from "./list-org-fixture-server";

const LIST_ORG_PARSER_VERSION = "list-org-browser/1.0.0";

async function execute(argv: readonly string[], inputEnv: NodeJS.ProcessEnv): Promise<object> {
  const command = parseAudienceCli(argv);
  const env = parseEnv(inputEnv);
  if (env.appMode !== "fixture" || env.listOrgLiveEnabled) {
    throw new PublicOperationError("audience CLI is fixture-only");
  }
  const database = new PostgresDatabase(env.databaseUrl);
  const repository = new PostgresAudienceRepository(database);
  const rawStorage = new S3RawObjectStorage(env, "list-org-browser");

  try {
    switch (command.kind) {
      case "fixture-discover": {
        const okved = await new PostgresOkvedRepository(database).find(command.okved);
        if (okved === null) {
          throw new PublicOperationError("selected OKVED fixture must be imported before discovery");
        }
        const runId = randomUUID();
        const fixture = await startListOrgFixtureServer();
        try {
          const source = new ListOrgBrowserSource({
            searchUrl: `${fixture.origin}/search`,
            sessions: new PlaywrightBrowserSessionFactory(fixture.origin),
            runId,
            parserVersion: LIST_ORG_PARSER_VERSION,
          });
          return await runFixtureDiscovery({
            runId,
            okved: command.okved,
            year: command.year,
            dryRun: true,
            maxPages: command.maxPages,
            maxCompanies: command.maxCompanies,
            fixtureVersion: "list-org-browser-fixture/1.0.0",
            parserVersion: LIST_ORG_PARSER_VERSION,
          }, { repository, source, rawStorage });
        } finally {
          await fixture.close();
        }
      }
      case "replay-write": {
        const state = await repository.runStatus(command.runId);
        if (state?.status === "blocked") {
          throw new PublicOperationError("blocked run cannot be resumed; create a new run");
        }
        if (state?.status !== "succeeded") {
          throw new PublicOperationError("only a succeeded fixture run can be replayed");
        }
        const taskId = randomUUID();
        await repository.prepareTask(taskId, command.runId, "replay_write");
        const queue = new PgBossJobQueue(env.databaseUrl);
        try {
          try {
            const jobId = await queue.publish(
              "audience-replay-write",
              { runId: command.runId, taskId },
              { singletonKey: `audience:${command.runId}:replay_write` },
            );
            return { runId: command.runId, taskId, jobId, queued: true };
          } catch (error) {
            await repository.failPreparedTask(taskId, "replay_enqueue_failed");
            throw error;
          }
        } finally {
          await queue.close();
        }
      }
      case "fixture-finance": {
        const staged = await stageFinancialFixtures(command.runId, command.year, env);
        await publishFinancialEvidence({
          runId: command.runId,
          evidence: staged.evidence,
          rawObjects: staged.rawObjects,
        }, { repository });
        return { runId: command.runId, publishedEvidence: staged.evidence.length };
      }
      case "reconcile":
        return reconcileRun(command.runId, repository);
      case "resume": {
        const state = await repository.runStatus(command.runId);
        if (state?.status === "blocked") {
          throw new PublicOperationError("blocked run cannot be resumed; create a new run");
        }
        throw new PublicOperationError("resume is unsupported; use replay-write or create a new run");
      }
    }
    throw new Error("unsupported audience command");
  } finally {
    try {
      rawStorage.close();
    } finally {
      await database.close();
    }
  }
}

async function stageFinancialFixtures(runId: string, year: number, env: AppEnv) {
  const inn = parseLegalEntityInn("7707083893");
  const bfoBytes = await readFile(new URL("../../../test/fixtures/fns-bfo/report-0710002.json", import.meta.url));
  const revexpBytes = await readFile(new URL("../../../test/fixtures/fns-revexp/revexp.xml", import.meta.url));
  const capturedAt = "2026-08-24T00:00:00.000Z";
  const bfoBundle = fixtureRawBundle({
    runId,
    sourceKind: "fns-bfo",
    page: 1,
    sourceRecordKey: `${inn}:${year}:bfo-fixture`,
    parserVersion: "fns-bfo/1.0.0",
    finalUrl: `http://127.0.0.1/fixtures/fns-bfo/${year}`,
    bytes: bfoBytes,
    capturedAt,
  });
  const revexpBundle = fixtureRawBundle({
    runId,
    sourceKind: "fns-revexp",
    page: 2,
    sourceRecordKey: `${inn}:${year}:revexp-fixture`,
    parserVersion: "fns-revexp/1.0.0",
    finalUrl: `http://127.0.0.1/fixtures/fns-revexp/${year}`,
    bytes: revexpBytes,
    capturedAt,
  });
  const bfoStorage = new S3RawObjectStorage(env, "fns-bfo");
  const revexpStorage = new S3RawObjectStorage(env, "fns-revexp");
  let bfoStored: Awaited<ReturnType<S3RawObjectStorage["put"]>>;
  let revexpStored: Awaited<ReturnType<S3RawObjectStorage["put"]>>;
  try {
    [bfoStored, revexpStored] = await Promise.all([
      bfoStorage.put(bfoBundle),
      revexpStorage.put(revexpBundle),
    ]);
  } finally {
    bfoStorage.close();
    revexpStorage.close();
  }
  const rawObjects: CapturedRawObject[] = [
    capturedFinancialRaw(randomUUID(), "fns-bfo", bfoBundle, bfoStored),
    capturedFinancialRaw(randomUUID(), "fns-revexp", revexpBundle, revexpStored),
  ];
  const bfoEvidence = parseBfo(bfoBytes, {
    inn,
    reportYear: year,
    rawFetchKey: bfoStored.checksumSha256,
    parserVersion: bfoBundle.parserVersion,
  }).evidence;
  const revexpEvidence = parseRevexp(revexpBytes, {
    reportYear: year,
    sourceRecordKey: `${inn}:${year}:revexp`,
    rawFetchKey: revexpStored.checksumSha256,
    parserVersion: revexpBundle.parserVersion,
  });
  return { evidence: [...bfoEvidence, ...revexpEvidence], rawObjects };
}

function fixtureRawBundle(input: {
  runId: string;
  sourceKind: string;
  page: number;
  sourceRecordKey: string;
  parserVersion: string;
  finalUrl: string;
  bytes: Uint8Array;
  capturedAt: string;
}) {
  return checksumBrowserRawBundle({
    sourceKind: input.sourceKind,
    parserVersion: input.parserVersion,
    finalUrl: input.finalUrl,
    capturedAt: input.capturedAt,
    navigationStatus: 200,
    sanitizedDomUtf8: input.bytes,
    redactedScreenshotPng: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pageFingerprintSha256: sha256(input.bytes),
    identity: { runId: input.runId, page: input.page, sourceRecordKey: input.sourceRecordKey },
    candidateEvidence: null,
    actions: [],
  });
}

function capturedFinancialRaw(
  id: string,
  sourceKind: string,
  bundle: ReturnType<typeof fixtureRawBundle>,
  stored: Awaited<ReturnType<S3RawObjectStorage["put"]>>,
): CapturedRawObject {
  const sourceRecordKey = bundle.identity.sourceRecordKey;
  if (sourceRecordKey === undefined) throw new Error("financial fixture source key is missing");
  return {
    id,
    sourceKind,
    sourceRecordKey,
    finalUrl: bundle.finalUrl,
    navigationStatus: bundle.navigationStatus,
    capturedAt: bundle.capturedAt,
    parserVersion: bundle.parserVersion,
    stored,
  };
}

class PublicOperationError extends Error {}

function publicError(error: unknown): string {
  if (error instanceof CliInputError || error instanceof PublicOperationError) return error.message;
  if (error instanceof Error && error.message.startsWith("blocked run cannot be resumed")) {
    return "blocked run cannot be resumed; create a new run";
  }
  return "operation failed";
}

execute(process.argv.slice(2), process.env)
  .then((result) => {
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  })
  .catch((error: unknown) => {
    process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ ok: false, error: publicError(error) })}\n`);
  });
