import { randomUUID } from "node:crypto";

import { runLivePilot, type LivePilotRunResult } from "../../modules/audience/application/run-live-pilot";
import { publishFinancialEvidence } from "../../modules/audience/application/publish-financial-evidence";
import { reconcileLivePilotRun } from "../../modules/audience/application/reconcile-run";
import { replayRun } from "../../modules/audience/application/replay-run";
import { runFixtureDiscovery } from "../../modules/audience/application/run-fixture-discovery";
import type { AudienceRepository, CapturedRawObject, FinancialMetricOutcomes } from "../../modules/audience/application/ports/audience-repository";
import type { RawObjectStorage } from "../../modules/audience/application/ports/raw-object-storage";
import { parseLegalEntityInn } from "../../modules/audience/domain/inn";
import { PolicyBrowserSessionFactory } from "../../modules/audience/infrastructure/sources/browser/policy-browser";
import { BfoLiveSource, type BfoLiveSourceOptions } from "../../modules/audience/infrastructure/sources/fns-bfo-live/bfo-live-source";
import { downloadRevexpArchive, resolveRevexpRelease, type RevexpTransport, type RevexpTransportRequest, type RevexpTransportResponse } from "../../modules/audience/infrastructure/sources/fns-revexp/revexp-release";
import { selectRevexpMetrics } from "../../modules/audience/infrastructure/sources/fns-revexp/revexp-archive-parser";
import { ListOrgLiveSource, type ListOrgLiveSourceOptions } from "../../modules/audience/infrastructure/sources/list-org-live/list-org-live-source";
import { checksumFileRawEvidence } from "../../modules/audience/infrastructure/storage/file-raw-evidence";
import { S3FileRawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-file-raw-object-storage";
import { S3RawObjectStorage } from "../../modules/audience/infrastructure/storage/s3-raw-object-storage";
import type { AppEnv } from "../../shared/config/env";
import { HumanVerificationGate } from "./human-verification";
import { parseAudienceCli } from "./cli";
import type { RunLivePilotDependencies } from "../../modules/audience/application/run-live-pilot";
import { buildLivePilotReport } from "./live-pilot-report";

const LIST_ORG_URL = "https://www.list-org.com/search";
const BFO_URL = "https://bo.nalog.gov.ru/";
const REVEXP_METADATA_URL = "https://www.nalog.gov.ru/opendata/7707329152-revexp/";

type LivePilotBfoRawStorage = Pick<S3RawObjectStorage, "put" | "close">;
type LivePilotRevexpRawStorage = Pick<S3FileRawObjectStorage, "put" | "close">;

/** Typed construction seam shared by the public runner and loopback contract tests. */
export interface LivePilotFactories {
  readonly endpoints: {
    readonly listOrgSearchUrl: string;
    readonly bfoSearchUrl: string;
    readonly revexpMetadataUrl: string;
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
}): Promise<object> {
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
  let selected: readonly { inn: string }[] = [];
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
        selected = (await input.repository.loadReplayInput(runId)).candidates;
        return {
          ...summary,
          acceptedCompanies: selected.length,
          candidates: selected.map((candidate) => ({ inn: candidate.inn })),
        };
      },
      replay: async () => { await replayRun({ runId, dryRun: false }, { repository: input.repository, rawStorage: input.discoveryRawStorage }); },
      finance: async () => {
        const financeTasks = [] as Array<{ inn: string; task: Awaited<ReturnType<AudienceRepository["createTask"]>> }>;
        let runFailureRecorded = false;
        try {
          // Bind all ten owners before any shared or company-specific finance
          // collection so every later failure has terminal task attribution.
          for (const company of selected) {
            const task = await input.repository.createTask(runId, "live_finance", 300);
            financeTasks.push({ inn: company.inn, task });
            if (!await input.repository.bindTaskCompany(task, company.inn)) {
              throw new Error("live finance task ownership could not be bound");
            }
          }

          const transport = factories.createRevexpTransport();
          const release = await resolveRevexpRelease(factories.endpoints.revexpMetadataUrl, transport);
          const archive = await downloadRevexpArchive(release, transport);
          const revexpEvidence = checksumFileRawEvidence({
            sourceKind: "fns-revexp", parserVersion: "fns-revexp/1.0.0", finalUrl: archive.finalUrl,
            capturedAt: archive.capturedAt, navigationStatus: archive.status,
            identity: { runId, sourceRecordKey: "7707329152-revexp:2025" },
            mimeType: archive.contentType, data: archive.data,
          });
          const revexpStored = await activeRevexpRawStorage.put(revexpEvidence);
          const revexpRaw: CapturedRawObject = {
            id: randomUUID(), sourceKind: "fns-revexp", sourceRecordKey: "7707329152-revexp:2025",
            mimeType: archive.contentType, finalUrl: archive.finalUrl, navigationStatus: archive.status,
            capturedAt: archive.capturedAt, parserVersion: "fns-revexp/1.0.0", stored: revexpStored,
          };
          const parsedRevexp = await selectRevexpMetrics(singleChunk(archive.data), selected.map((item) => item.inn), {
            reportYear: 2025, sourceRecordKey: (inn) => `${inn}:2025:revexp`,
            observedAt: release.updatedAt, rawFetchKey: revexpStored.checksumSha256,
            parserVersion: "fns-revexp/1.0.0",
          });
          const bfoOrigin = new URL(factories.endpoints.bfoSearchUrl).origin;
          const bfoSource = factories.createBfoSource({
            searchUrl: factories.endpoints.bfoSearchUrl,
            sessions: factories.createBfoBrowserSessions(bfoOrigin),
            humanVerification: verification, runId, parserVersion: "fns-bfo-live/1.0.0",
          });

          for (let index = 0; index < selected.length; index += 1) {
            const inn = parseLegalEntityInn(selected[index]!.inn);
            const financeTask = financeTasks[index]!;
            const bfo = await bfoSource.collectRevenue({ inn, reportYear: 2025 }, {
              actionLedger: { record: async (event) => {
                if (!await input.repository.recordBrowserAction(financeTask.task, event)) {
                  throw new Error("stale live finance task collector");
                }
              } },
            });
            const bfoStored = await activeBfoRawStorage.put(bfo.raw);
            const bfoRaw: CapturedRawObject = {
              id: randomUUID(), sourceKind: "fns-bfo-live", sourceRecordKey: bfo.raw.identity.sourceRecordKey!,
              mimeType: "application/json", finalUrl: bfo.raw.finalUrl, navigationStatus: bfo.raw.navigationStatus,
              capturedAt: bfo.raw.capturedAt, parserVersion: bfo.raw.parserVersion, stored: bfoStored,
            };
            if (bfo.outcome === "blocked") {
              if (!await input.repository.recordFinancialRaw(financeTask.task, bfoRaw)) {
                throw new Error("stale live finance task raw audit");
              }
              if (!await input.repository.failTask(financeTask.task, "live_finance_blocked", true)) {
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
            await publishFinancialEvidence({ runId, reportYear: 2025, taskKind: "live_finance", companyInn: inn, task: financeTask.task,
              evidence: [...(bfo.outcome === "published" ? [bfo.evidence] : []), ...revexpForCompany],
              metricOutcomes: outcomes, rawObjects: index === 0 ? [bfoRaw, revexpRaw] : [bfoRaw],
            }, { repository: input.repository });
          }
        } catch (error) {
          if (!runFailureRecorded) {
            const status = await input.repository.runStatus(runId);
            runFailureRecorded = status?.status === "failed" || status?.status === "blocked";
          }
          if (!runFailureRecorded) {
            for (const financeTask of financeTasks) {
              if (await input.repository.failTask(financeTask.task, "live_finance_failed", true)) {
                runFailureRecorded = true;
                break;
              }
            }
          }
          for (const financeTask of financeTasks) {
            await input.repository.failTask(financeTask.task, "live_finance_cancelled", false);
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
      allowedNavigationUrls: [{ origin, pathname: "/*" }],
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
async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> { yield data; }

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
