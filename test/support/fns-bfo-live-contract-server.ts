import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface FnsBfoLiveContractServer {
  readonly origin: string;
  requests(): readonly string[];
  submittedInns(): readonly string[];
  initialSearchDispatchCount(): number;
  reportRequestCount(): number;
  maxConcurrentReportRequests(): number;
  apiRequestCount(): number;
  downloadRequestCount(): number;
  foreignDestinationRequestCount(): number;
  close(): Promise<void>;
}

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fns-bfo-live",
);

const DEFAULT_INN = "7707083893";
const WRONG_INN = "7700000016";

export async function startFnsBfoLiveContractServer(): Promise<FnsBfoLiveContractServer> {
  const fixtures = await loadFixtures();
  const requestLog: string[] = [];
  const searches: string[] = [];
  let activeScenario = "default";
  let transientSearchAttempts = 0;
  let searchDispatches = 0;
  let reportRequests = 0;
  let activeReportRequests = 0;
  let maximumConcurrentReportRequests = 0;
  let apiRequests = 0;
  let downloadRequests = 0;
  let captchaResponses = 0;
  let foreignDestinationRequests = 0;
  let requestedInn = DEFAULT_INN;

  const foreignServer = createServer((_request, response) => {
    foreignDestinationRequests += 1;
    responseHtml(response, "<!doctype html><main>foreign destination</main>");
  });
  await listen(foreignServer);
  const foreignOrigin = serverOrigin(foreignServer);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    requestLog.push(`${request.method ?? "GET"} ${url.pathname}${url.search}`);

    if (url.pathname === "/api/report") {
      apiRequests += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ forbidden: "adapter must not call this" }));
      return;
    }
    if (url.pathname === "/download/report.pdf") {
      downloadRequests += 1;
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end("not a real report");
      return;
    }

    if (url.pathname === "/") {
      activeScenario = url.searchParams.get("scenario") ?? "default";
      responseHtml(response, renderSearch(fixtures.search, activeScenario));
      return;
    }

    if (url.pathname === "/search") {
      activeScenario = url.searchParams.get("scenario") ?? activeScenario;
      const query = url.searchParams.get("query") ?? "";
      searches.push(query);
      requestedInn = query;
      searchDispatches += 1;
      if (activeScenario === "transport-reset-exhausted") {
        request.socket.destroy();
        return;
      }
      if (activeScenario === "transient-then-ok" && transientSearchAttempts++ < 2) {
        responseHtml(response, "<!doctype html><main>temporary upstream failure</main>", 503);
        return;
      }
      if (activeScenario === "transient-exhausted") {
        transientSearchAttempts += 1;
        responseHtml(response, "<!doctype html><main>temporary upstream failure</main>", 503);
        return;
      }
      if (activeScenario === "http-403") {
        responseHtml(response, '<!doctype html><main aria-label="Forbidden">Forbidden</main>', 403);
        return;
      }
      if (activeScenario === "http-418") {
        responseHtml(response, '<!doctype html><main aria-label="Failure">Do not retry</main>', 418);
        return;
      }
      const resultInn = activeScenario === "wrong-result-inn" ? WRONG_INN : requestedInn;
      const localHref = "/cards/record-1";
      const resultHref = activeScenario === "foreign-navigation"
        ? `${foreignOrigin}/cards/record-1`
        : localHref;
      const result = `<section><h2>Найденные организации</h2><a href="${escapeHtml(resultHref)}">АО «Тестовая организация», ИНН ${resultInn}</a>${
        activeScenario === "ambiguous-result"
          ? `<a href="${escapeHtml(localHref)}">АО «Дубль», ИНН ${resultInn}</a>`
          : ""
      }</section>`;
      responseHtml(response, renderSearch(fixtures.search, activeScenario, result));
      return;
    }

    const organizationMatch = /^\/cards\/(record-[1-9][0-9]*)$/u.exec(url.pathname);
    if (organizationMatch?.[1] !== undefined) {
      responseHtml(response, organizationPage(organizationMatch[1], requestedInn, activeScenario));
      return;
    }

    const reportMatch = /^\/statements\/(record-[1-9][0-9]*)$/u.exec(url.pathname);
    if (reportMatch?.[1] !== undefined) {
      reportRequests += 1;
      activeReportRequests += 1;
      maximumConcurrentReportRequests = Math.max(maximumConcurrentReportRequests, activeReportRequests);
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        activeReportRequests -= 1;
      };
      response.once("finish", finish);
      response.once("close", finish);

      const inn = requestedInn;
      const year = url.searchParams.get("year");
      activeScenario = url.searchParams.get("scenario") ?? activeScenario;
      if (year !== "2025") {
        responseHtml(response, "<!doctype html><main>wrong requested year</main>", 400);
        return;
      }
      if (activeScenario === "report-403") {
        responseHtml(response, '<!doctype html><main aria-label="Forbidden">Forbidden</main>', 403);
        return;
      }
      if (activeScenario === "report-soft-block") {
        responseHtml(response, '<!doctype html><main aria-label="Доступ временно ограничен"><p>soft-block-secret</p></main>');
        return;
      }
      if (activeScenario === "captcha" && captchaResponses++ === 0) {
        responseHtml(response, fixtures.captcha);
        return;
      }
      if (activeScenario === "restricted") {
        responseHtml(response, fixtures.restricted.replaceAll("{{INN}}", inn));
        return;
      }
      if (activeScenario === "conflicting-status") {
        responseHtml(response, fixtures.restricted
          .replaceAll("{{INN}}", inn)
          .replace(
            "<p>Доступ к отчетности ограничен</p>",
            "<p>Доступ к отчетности ограничен</p><p>Отчетность за 2025 год отсутствует</p>",
          ));
        return;
      }
      if (activeScenario === "unavailable") {
        responseHtml(response, fixtures.restricted
          .replaceAll("{{INN}}", inn)
          .replace("Доступ к отчетности ограничен", "Отчетность за 2025 год отсутствует"));
        return;
      }
      if (activeScenario === "no-line-2110") {
        responseHtml(response, fixtures.noLine.replaceAll("{{INN}}", inn));
        return;
      }

      let reportInn = activeScenario === "wrong-inn" ? WRONG_INN : inn;
      let revenueRows = '<tr><td>Выручка</td><td>2110</td><td>1 654 023</td></tr>';
      if (activeScenario === "duplicate-line") {
        revenueRows += '<tr><td>Выручка</td><td>2110</td><td>1 654 024</td></tr>';
      }
      if (activeScenario === "hidden-duplicate-line") {
        revenueRows += '<tr style="display:none"><td>Выручка</td><td>2110</td><td>hidden-row-secret</td></tr>';
      }
      const displayed = displayedRevenue(activeScenario);
      revenueRows = revenueRows.replace("1 654 023", displayed);
      let html = fixtures.report
        .replaceAll("{{INN}}", reportInn)
        .replace("{{REVENUE_ROWS}}", revenueRows);
      if (activeScenario === "wrong-year") html = html.replaceAll("2025", "2024");
      if (activeScenario === "wrong-unit") html = html.replace("Ед. измерения: тыс. ₽", "Ед. измерения: ₽");
      if (activeScenario === "wrong-form") html = html.replaceAll("0710002", "0710001");
      if (activeScenario === "wrong-column-year") html = html.replace("За 2025 год", "За 2024 год");
      if (activeScenario === "invalid-correction") html = html.replace(
        "<dt>Номер корректировки</dt><dd>2</dd>",
        "<dt>Номер корректировки</dt><dd>02</dd>",
      );
      if (activeScenario === "invalid-source-date") html = html.replace("01.04.2026", "31.02.2026");
      if (activeScenario === "missing-official-metadata") html = html
        .replace("<dt>Номер корректировки</dt><dd>2</dd>", "")
        .replace("<dt>Дата представления отчетности</dt><dd>01.04.2026</dd>", "");
      if (activeScenario === "truncated-table") html = html.replace(/<table>[\s\S]*?<\/table>/u, "");
      if (activeScenario === "slow-report") {
        setTimeout(() => responseHtml(response, html), 75);
        return;
      }
      responseHtml(response, html);
      return;
    }

    responseHtml(response, "<!doctype html><main>Not found</main>", 404);
  });

  await listen(server);
  return {
    origin: serverOrigin(server),
    requests: () => [...requestLog],
    submittedInns: () => [...searches],
    initialSearchDispatchCount: () => searchDispatches,
    reportRequestCount: () => reportRequests,
    maxConcurrentReportRequests: () => maximumConcurrentReportRequests,
    apiRequestCount: () => apiRequests,
    downloadRequestCount: () => downloadRequests,
    foreignDestinationRequestCount: () => foreignDestinationRequests,
    close: async () => { await Promise.all([closeServer(server), closeServer(foreignServer)]); },
  };
}

function renderSearch(template: string, scenario: string, results = ""): string {
  return template
    .replaceAll("{{LANDMARK}}", results === "" ? "Поиск организации" : "Результаты поиска")
    .replace("{{SCENARIO_INPUT}}", scenario === "default"
      ? ""
      : `<input type="hidden" name="scenario" value="${escapeHtml(scenario)}">`)
    .replace("{{RESULTS}}", results);
}

function organizationPage(recordId: string, inn: string, scenario: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>БФО — организация</title></head><body>
    <main aria-label="Организация"><h1>АО «Тестовая организация»</h1><dl><dt>ИНН</dt><dd>${inn}</dd></dl>
      <form action="/statements/${recordId}" method="get"><input type="hidden" name="year" value="2025">${scenario === "default" ? "" : `<input type="hidden" name="scenario" value="${escapeHtml(scenario)}">`}<button type="submit">Отчетность за 2025 год</button></form>
      <a href="/api/report">Внутренний API</a>
    </main></body></html>`;
}

function displayedRevenue(scenario: string): string {
  if (scenario === "decimal-number") return "1 654 023,5";
  if (scenario === "unsafe-separator") return "1\u202f654\u202f023";
  if (scenario === "malformed-grouping") return "16 54 023";
  if (scenario === "overflow") return "10 000 000 000 000";
  return "1 654 023";
}

async function loadFixtures() {
  const read = (name: string) => readFile(join(fixtureDirectory, name), "utf8");
  const [search, report, restricted, noLine, captcha] = await Promise.all([
    read("search.html"),
    read("report-2025.html"),
    read("report-restricted.html"),
    read("report-no-line-2110.html"),
    read("captcha.html"),
  ]);
  return { search, report, restricted, noLine, captcha };
}

function responseHtml(
  response: import("node:http").ServerResponse,
  body: string,
  status = 200,
): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function serverOrigin(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}
