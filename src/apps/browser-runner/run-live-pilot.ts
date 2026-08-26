import { randomUUID } from "node:crypto";

import { runLivePilot, type LivePilotRunResult } from "../../modules/audience/application/run-live-pilot";
import { publishFinancialEvidence } from "../../modules/audience/application/publish-financial-evidence";
import { reconcileLivePilotRun } from "../../modules/audience/application/reconcile-run";
import { replayRun } from "../../modules/audience/application/replay-run";
import { runFixtureDiscovery } from "../../modules/audience/application/run-fixture-discovery";
import { finalizeRawUploads, stageRawUpload } from "../../modules/audience/application/raw-upload-coordinator";
import { withRenewingTaskLease } from "../../modules/audience/application/task-lease";
import type {
  AudienceRepository,
  CapturedRawObject,
  FencedTask,
  FinancialMetricOutcomes,
  PreparedTask,
} from "../../modules/audience/application/ports/audience-repository";
import type { RawObjectStorage } from "../../modules/audience/application/ports/raw-object-storage";
import { parseLegalEntityInn } from "../../modules/audience/domain/inn";
import { PolicyBrowserSessionFactory } from "../../modules/audience/infrastructure/sources/browser/policy-browser";
import { BfoLiveSource, type BfoLiveSourceOptions } from "../../modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source";
import { downloadRevexpArchive, resolveRevexpRelease, type RevexpTransport, type RevexpTransportRequest, type RevexpTransportResponse } from "../../modules/audience/infrastructure/sources/fns-revexp/revexp-release";
import { selectRevexpMetrics } from "../../modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser";
import { ListOrgLiveSource, type ListOrgLiveSourceOptions } from "../../modules/audience/infrastructure/sources/list-org-live/list-org-live-source";
import { checksumFileRawEvidenceFromPath } from "../../modules/audience/infrastructure/storage/file-raw-evidence";
import { S3FileRawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-file-raw-object-storage";
import { S3RawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-raw-object-storage";
import type { AppEnv } from "../../shared/config/env";
import { HumanVerificationGate } from "./human-verification";
import { parseAudienceCli } from "./cli";
import type { RunLivePilotDependencies } from "../../modules/audience/application/run-live-pilot";
import { buildLivePilotReport } from "./live-pilot-report";
import {
  assertLivePilotPolicyChecksum,
  LIVE_PILOT_POLICY,
  type LivePilotPolicy,
} from "../../modules/audience/domain/live-pilot-policy";

const LIST_ORG_URL = "https://www.list-org.com/search";
const BFO_URL = "https://bo.nalog.gov.ru/";
const REVEXP_METADATA_URL = "https://www.nalog.gov.ru/opendata/7707329152-revexp/";

type LivePilotBfoRawStorage = Pick<S3RawObjectStorage, "plan" | "put" | "verify" | "close">;
type LivePilotRevexpRawStorage = Pick<S3FileRawObjectStorage, "plan" | "put" | "verify" | "close">;

/** Typed construction seam shared by the public runner and loopback contract tests. */
export interface LivePilotFactories {
  readonly endpoints: {
    readonly listOrgSearchUrl: string;
    readonly bfoSearchUrl: string;
    readonly revexpMetadataUrl: string;
  };
  readonly financeTaskLease?: {
    readonly leaseSeconds: number;
    readonly renewalIntervalMs?: number;
  };
  createListBrowserSessions(origin: string): PolicyBrowserSessionFactory;
  createBfoBrowserSessions(origin: string): PolicyBrowserSessionFactory;
  createListSource(options: ListOrgLiveSourceOptions): ListOrgLiveSource;
  createBfoSource(options: BfoLiveSourceOptions): BfoLiveSource;
  createRevexpTransport(): RevexpTransport;
  createBfoRawStorage(env: AppEnv): LivePilotBfoRawStorage;
  createRevexpRawStorage(env: AppEnv): LivePilotRevexpRawStorage;
}

export async function executeLivePilot(input: {
  env: AppEnv;
  repository: AudienceRepository;
  discoveryRawStorage: RawObjectStorage;
  factories?: LivePilotFactories;
  /** Test-only seam. Runtime live mode can use only the reviewed in-code policy. */
  testOnlyActivePolicy?: LivePilotPolicy;
}): Promise<object> {
  const policy = input.testOnlyActivePolicy ?? LIVE_PILOT_POLICY;
  assertLivePilotPolicyChecksum(policy);
  if (policy.authorization.status !== "active") {
    throw new Error("LIVE_PILOT_AUTHORIZATION_CONSUMED");
  }
  if (input.testOnlyActivePolicy !== undefined) {
    assertTestOnlyPolicyInjection(input.env, input.factories, policy);
  }
  const attemptAcquired = await input.repository.acquireLivePilotAttempt({
    scopeKey: policy.scopeKey,
    commandContract: policy.command,
    policyChecksumSha256: policy.checksumSha256,
  });
  if (!attemptAcquired) {
    throw new Error("LIVE_PILOT_ATTEMPT_ALREADY_CONSUMED");
  }
  const runId = randomUUID();
  const factories = input.factories ?? productionLivePilotFactories();
  const verification = new HumanVerificationGate({ input: process.stdin, output: process.stdout });
  const listOrigin = new URL(factories.endpoints.listOrgSearchUrl).origin;
  const listSource = factories.createListSource({
    searchUrl: factories.endpoints.listOrgSearchUrl,
    sessions: factories.createListBrowserSessions(listOrigin),
    humanVerification: verification,
    runId,
    parserVersion: "list-org-live/1.0.0",
  });
  let selected: readonly { inn: string; sourceRecordKey: string }[] = [];
  const companyMetrics: Array<{ inn: string; metric: "revenue" | "income" | "expenses"; value: string; sourceAttemptStatus: "published" } | { inn: string; metric: "revenue" | "income" | "expenses"; outcome: "no_data"; sourceAttemptStatus: "no_data" }> = [];
  let reconciliation: { companies: number; companyOkveds: number } | undefined;
  let bfoRawStorage: LivePilotBfoRawStorage | undefined;
  let revexpRawStorage: LivePilotRevexpRawStorage | undefined;
  try {
    bfoRawStorage = factories.createBfoRawStorage(input.env);
    revexpRawStorage = factories.createRevexpRawStorage(input.env);
    const activeBfoRawStorage = bfoRawStorage;
    const activeRevexpRawStorage = revexpRawStorage;
    const summary = await runLivePilot({ runId, okved: "43.11", year: 2025, maxCompanies: 10 }, {
      discover: async () => {
        const summary = await runFixtureDiscovery({
          runId, okved: "43.11", year: 2025, dryRun: true, maxPages: 2, maxCompanies: 10,
          fixtureVersion: "list-org-live/1.0.0", parserVersion: "list-org-live/1.0.0",
          taskKind: "live_discovery", onlyActive: false, sourceKind: "list-org-live",
        }, { repository: input.repository, source: listSource, rawStorage: input.discoveryRawStorage });
        const replayInput = await input.repository.loadReplayInput(runId);
        selected = replayInput.candidates;
        return {
          ...summary,
          acceptedCompanies: replayInput.discoveryAudit.acceptedCompanies,
          acceptedSourceRecordKeys: replayInput.discoveryAudit.acceptedSourceRecordKeys ?? [],
          occurrences: replayInput.discoveryAudit.occurrences,
          uniqueSourceRecords: replayInput.discoveryAudit.uniqueSourceRecords,
          skips: replayInput.discoveryAudit.skips ?? [],
          pageIdentities: (replayInput.discoveryAudit.pageIdentities ?? []).map((page) => ({
            page: page.page,
            orderedSourceRecordKeys: page.orderedSourceRecordKeys,
          })),
          candidates: selected.map((candidate) => ({
            inn: candidate.inn,
            sourceRecordKey: candidate.sourceRecordKey,
          })),
        };
      },
      replay: async () => { await replayRun({ runId, dryRun: false }, { repository: input.repository, rawStorage: input.discoveryRawStorage }); },
      finance: async () => {
        const financeTaskLease = factories.financeTaskLease ?? { leaseSeconds: 300 };
        const financeTasks: Array<{ inn: string; task: PreparedTask }> = [];
        const acquiredFinanceTasks = new Map<string, FencedTask>();
        let runFailureRecorded = false;
        const failPreparedTask = async (
          financeTask: { task: PreparedTask },
          errorCode: string,
          failRun: boolean,
        ): Promise<boolean> => {
          const existingFence = acquiredFinanceTasks.get(financeTask.task.id);
          if (existingFence !== undefined) {
            if (await input.repository.failRawUploads(
              existingFence,
              "before_db_commit",
              "raw_upload_before_db_commit",
              failRun,
            )) return true;
            if (await input.repository.failTask(existingFence, errorCode, failRun)) return true;
          }
          const acquired = await input.repository.acquireTask(
            financeTask.task.id,
            financeTaskLease.leaseSeconds,
          );
          if (acquired === null) return false;
          acquiredFinanceTasks.set(financeTask.task.id, acquired);
          return input.repository.failTask(acquired, errorCode, failRun);
        };
        try {
          // Persist all ten immutable owners without starting their leases.
          // Each company lease begins only when its sequential turn starts.
          for (const company of selected) {
            const task = await input.repository.prepareLiveFinanceTask(runId, company.inn);
            financeTasks.push({ inn: company.inn, task });
          }

          const transport = factories.createRevexpTransport();
          const release = await resolveRevexpRelease(factories.endpoints.revexpMetadataUrl, transport);
          const parserVersion = `fns-revexp/structure-${release.structureVersion}`;
          const archive = await downloadRevexpArchive(release, transport);
          const archiveDownload = archive.archiveDownload;
          let revexpRaw: CapturedRawObject;
          let parsedRevexp: Awaited<ReturnType<typeof selectRevexpMetrics>>;
          try {
            const captureTask = await input.repository.createTask(
              runId,
              "live_revexp_capture",
              financeTaskLease.leaseSeconds,
            );
            try {
              const revexpEvidence = checksumFileRawEvidenceFromPath({
                sourceKind: "fns-revexp", parserVersion, finalUrl: archiveDownload.finalUrl,
                capturedAt: archiveDownload.capturedAt, navigationStatus: archiveDownload.status,
                identity: { runId, sourceRecordKey: "7707329152-revexp:2025" },
                mimeType: archiveDownload.headers.contentType,
                filePath: archive.filePath,
                byteLength: archive.byteLength,
                dataChecksumSha256: archive.dataChecksumSha256,
                provenance: {
                  datasetId: release.datasetId,
                  reportYear: release.reportYear,
                  publishedAt: release.publishedAt,
                  updatedAt: release.updatedAt,
                  structureVersion: release.structureVersion,
                  xsdUrl: release.xsdUrl,
                  metadata: release.capture.metadata,
                  archiveResolution: release.capture.archiveResolution,
                  archiveDownload,
                },
              });
              const revexpStaged = await stageRawUpload({
                task: captureTask,
                input: revexpEvidence,
                storage: activeRevexpRawStorage,
                repository: input.repository,
              });
              const revexpStored = revexpStaged.stored;
              revexpRaw = {
                id: randomUUID(), sourceKind: "fns-revexp", sourceRecordKey: "7707329152-revexp:2025",
                mimeType: archiveDownload.headers.contentType, finalUrl: archiveDownload.finalUrl,
                navigationStatus: archiveDownload.status, capturedAt: archiveDownload.capturedAt,
                parserVersion, stored: revexpStored,
                uploadIntentId: revexpStaged.intentId,
              };
              if (!await finalizeRawUploads(captureTask, input.repository, () =>
                input.repository.completeRawCapture(captureTask, revexpRaw))) {
                throw new Error("stale revexp capture task before registration");
              }
              parsedRevexp = await selectRevexpMetrics(archive.openStream(), selected.map((item) => item.inn), {
                reportYear: 2025, sourceRecordKey: (inn) => `${inn}:2025:revexp`,
                observedAt: release.updatedAt, rawFetchKey: revexpStored.checksumSha256,
                parserVersion,
              });
            } catch (error) {
              if (await input.repository.failTask(
                captureTask,
                "live_revexp_capture_failed",
                true,
              )) runFailureRecorded = true;
              throw error;
            }
          } finally {
            await archive.cleanup();
          }
          const bfoOrigin = new URL(factories.endpoints.bfoSearchUrl).origin;
          const bfoSource = factories.createBfoSource({
            searchUrl: factories.endpoints.bfoSearchUrl,
            sessions: factories.createBfoBrowserSessions(bfoOrigin),
            humanVerification: verification, runId, parserVersion: "fns-bfo-live/1.0.0",
          });

          for (let index = 0; index < selected.length; index += 1) {
            const inn = parseLegalEntityInn(selected[index]!.inn);
            const preparedFinanceTask = financeTasks[index]!;
            const task = await input.repository.acquireTask(
              preparedFinanceTask.task.id,
              financeTaskLease.leaseSeconds,
            );
            if (task === null || task.runId !== runId || task.taskKind !== "live_finance") {
              throw new Error("live finance task could not be acquired for its company turn");
            }
            acquiredFinanceTasks.set(task.id, task);
            const { bfo, bfoRaw } = await withRenewingTaskLease(
              input.repository,
              task,
              financeTaskLease,
              async (signal) => {
                const bfo = await bfoSource.collectRevenue({ inn, reportYear: 2025 }, {
                  signal,
                  actionLedger: { record: async (event) => {
                    if (!await input.repository.recordBrowserAction(task, event)) {
                      throw new Error("stale live finance task collector");
                    }
                  } },
                });
                const bfoStaged = await stageRawUpload({
                  task,
                  input: bfo.raw,
                  storage: activeBfoRawStorage,
                  repository: input.repository,
                });
                const bfoStored = bfoStaged.stored;
                const bfoRaw: CapturedRawObject = {
                  id: randomUUID(), sourceKind: "fns-bfo-live", sourceRecordKey: bfo.raw.identity.sourceRecordKey!,
                  mimeType: "application/json", finalUrl: bfo.raw.finalUrl, navigationStatus: bfo.raw.navigationStatus,
                  capturedAt: bfo.raw.capturedAt, parserVersion: bfo.raw.parserVersion, stored: bfoStored,
                  uploadIntentId: bfoStaged.intentId,
                };
                return { bfo, bfoRaw };
              },
            );
            if (!await input.repository.renewTaskLease(task, financeTaskLease.leaseSeconds)) {
              throw new Error("stale live finance task before publication");
            }
            if (bfo.outcome === "blocked") {
              if (!await finalizeRawUploads(task, input.repository, () =>
                input.repository.blockRun(task, bfo.reason, [bfoRaw]))) {
                throw new Error("stale live finance task blocker");
              }
              runFailureRecorded = true;
              throw new Error(`LIVE_PILOT_SOURCE_BLOCKED:${bfo.reason}`);
            }
            const revexpForCompany = parsedRevexp.filter((item) => item.inn === inn);
            const outcomes: FinancialMetricOutcomes = {
              revenue: bfo.outcome === "published"
                ? { outcome: "published", evidence: 1 }
                : { outcome: "no_data", evidence: 0, sourceAttempt: bfo.sourceAttempt },
              income: revexpForCompany.some((item) => item.metric === "income")
                ? { outcome: "published", evidence: 1 }
                : { outcome: "no_data", evidence: 0, sourceAttempt: revexpAttempt(revexpRaw, release.updatedAt) },
              expenses: revexpForCompany.some((item) => item.metric === "expenses")
                ? { outcome: "published", evidence: 1 }
                : { outcome: "no_data", evidence: 0, sourceAttempt: revexpAttempt(revexpRaw, release.updatedAt) },
            };
            const reportMetric = (metric: "revenue" | "income" | "expenses", value: string | undefined) => {
              companyMetrics.push(value === undefined
                ? { inn, metric, outcome: "no_data", sourceAttemptStatus: "no_data" }
                : { inn, metric, value, sourceAttemptStatus: "published" });
            };
            reportMetric("revenue", bfo.outcome === "published" ? bfo.evidence.value : undefined);
            reportMetric("income", revexpForCompany.find((item) => item.metric === "income")?.value);
            reportMetric("expenses", revexpForCompany.find((item) => item.metric === "expenses")?.value);
            await publishFinancialEvidence({ runId, reportYear: 2025, taskKind: "live_finance", companyInn: inn, task,
              evidence: [...(bfo.outcome === "published" ? [bfo.evidence] : []), ...revexpForCompany],
              metricOutcomes: outcomes, rawObjects: [bfoRaw],
            }, { repository: input.repository });
          }
        } catch (error) {
          if (!runFailureRecorded) {
            const status = await input.repository.runStatus(runId);
            runFailureRecorded = status?.status === "failed" || status?.status === "blocked";
          }
          if (!runFailureRecorded) {
            for (const financeTask of financeTasks) {
              if (await failPreparedTask(financeTask, "live_finance_failed", true)) {
                runFailureRecorded = true;
                break;
              }
            }
          }
          for (const financeTask of financeTasks) {
            await failPreparedTask(financeTask, "live_finance_cancelled", false);
          }
          throw error;
        }
      },
      reconcile: async () => {
        const report = await reconcileLivePilotRun(runId, input.repository);
        reconciliation = { companies: report.companies, companyOkveds: report.companyOkveds };
      },
    });
    if (summary.terminalCode === "LIVE_PILOT_DISCOVERY_INCOMPLETE") return summary;
    if (reconciliation === undefined || selected.length !== 10 || companyMetrics.length !== 30) {
      throw new Error("live pilot report contract is incomplete");
    }
    return buildLivePilotReport({
      summary,
      inns: selected.map((company) => company.inn),
      outcomes: companyMetrics.length,
      sourceAttempts: companyMetrics.map((metric) => metric.sourceAttemptStatus),
      reconciliation: { companies: reconciliation.companies, relations: reconciliation.companyOkveds, outcomes: companyMetrics.length },
      companyMetrics,
    });
  } finally {
    try {
      bfoRawStorage?.close();
    } finally {
      revexpRawStorage?.close();
    }
  }
}

function assertTestOnlyPolicyInjection(
  env: AppEnv,
  factories: LivePilotFactories | undefined,
  policy: LivePilotPolicy,
): void {
  if (env.appMode !== "fixture" || env.listOrgLiveEnabled || env.fnsLiveEnabled
    || !policy.scopeKey.startsWith("test-only/") || factories === undefined) {
    throw new Error("LIVE_PILOT_TEST_POLICY_FORBIDDEN");
  }
  const endpoints = Object.values(factories.endpoints);
  if (endpoints.some((value) => {
    const hostname = new URL(value).hostname;
    return hostname !== "127.0.0.1" && hostname !== "::1" && hostname !== "localhost";
  })) {
    throw new Error("LIVE_PILOT_TEST_POLICY_REQUIRES_LOOPBACK");
  }
}

function productionLivePilotFactories(): LivePilotFactories {
  return {
    endpoints: {
      listOrgSearchUrl: LIST_ORG_URL,
      bfoSearchUrl: BFO_URL,
      revexpMetadataUrl: REVEXP_METADATA_URL,
    },
    createListBrowserSessions: (origin) => new PolicyBrowserSessionFactory({
      allowedOrigins: [origin],
      allowedNavigationUrls: [
        { origin, pathname: "/search" },
        { origin, pathname: "/company/*" },
      ],
    }, { sourceKind: "list-org-live" }),
    createBfoBrowserSessions: (origin) => new PolicyBrowserSessionFactory({
      allowedOrigins: [origin],
      allowedNavigationUrls: [`${origin}/`],
    }, { sourceKind: "fns-bfo-live" }),
    createListSource: (options) => new ListOrgLiveSource(options),
    createBfoSource: (options) => new BfoLiveSource(options),
    createRevexpTransport: () => new FetchRevexpTransport(),
    createBfoRawStorage: (env) => new S3RawObjectStorage(env, "fns-bfo-live"),
    createRevexpRawStorage: (env) => new S3FileRawObjectStorage(env, "fns-revexp"),
  };
}

/** Local-contract entry point used by the CLI acceptance test. It parses the
 * exact public grammar before any injected source port can be opened. */
export async function executeInjectedLivePilot<TReport>(
  argv: readonly string[],
  dependencies: RunLivePilotDependencies & { report(summary: LivePilotRunResult): TReport },
): Promise<TReport> {
  const command = parseAudienceCli(argv);
  if (command.kind !== "live-pilot") throw new Error("live-pilot command is required");
  const summary = await runLivePilot({
    runId: randomUUID(),
    okved: command.okved,
    year: command.year,
    maxCompanies: command.maxCompanies,
  }, dependencies);
  return dependencies.report(summary);
}

function revexpAttempt(raw: CapturedRawObject, observedAt: string) {
  return { sourceKind: "fns_revexp" as const, rawSourceKind: "fns-revexp" as const,
    sourceRecordKey: raw.sourceRecordKey, observedAt, capturedAt: raw.capturedAt,
    rawFetchKey: raw.stored.checksumSha256, parserVersion: raw.parserVersion };
}
class FetchRevexpTransport implements RevexpTransport {
  async request(input: RevexpTransportRequest): Promise<RevexpTransportResponse> {
    const response = await fetch(input.url, { method: input.method, redirect: "manual" });
    return { url: response.url, status: response.status, headers: Object.fromEntries(response.headers.entries()),
      capturedAt: new Date().toISOString(), ...(response.body === null ? {} : { body: webBody(response.body) }) };
  }
}
async function* webBody(body: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = body.getReader();
  try { for (;;) { const item = await reader.read(); if (item.done) return; yield item.value; } }
  finally { reader.releaseLock(); }
}
