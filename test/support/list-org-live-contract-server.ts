import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ListOrgLiveContractServer {
  readonly origin: string;
  requests(): readonly string[];
  companyRequestIds(): readonly string[];
  submittedSearches(): readonly Readonly<Record<string, readonly string[]>>[];
  close(): Promise<void>;
}

type CompanyFixture = {
  name: string;
  inn: string;
  inactive?: boolean;
  ip?: boolean;
  primaryOkved?: string;
  additionalOkveds?: readonly string[];
};

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/list-org-live",
);

const companies: Readonly<Record<string, CompanyFixture>> = {
  "1001": { name: "ООО «Альфа Снос»", inn: "7700000016" },
  "1002": { name: "ООО «Бета Ликвидирована»", inn: "7700000023", inactive: true },
  "1003": { name: "ИП Иванов", inn: "123456789012", ip: true },
  "1004": { name: "ООО «Альфа Дубль»", inn: "7700000016" },
  "1005": {
    name: "ООО «Гамма Строй»",
    inn: "7700000030",
    primaryOkved: "41.20",
    additionalOkveds: ["43.11", "43.12"],
  },
  "1006": { name: "ООО «Дельта Демонтаж»", inn: "7700000048" },
  "1007": { name: "ООО «Эпсилон»", inn: "7700000055" },
  "1008": { name: "ООО «Дзета»", inn: "7700000062" },
  "1009": { name: "ООО «Эта»", inn: "7700000070" },
  "1010": { name: "ООО «Тета»", inn: "7700000087" },
  "1011": { name: "ООО «Йота»", inn: "7700000094" },
  "1012": { name: "ООО «Каппа»", inn: "7700000104" },
  "1013": { name: "ООО «Лямбда»", inn: "7700000111" },
};

export async function startListOrgLiveContractServer(): Promise<ListOrgLiveContractServer> {
  const fixture = await loadFixtures();
  const requestLog: string[] = [];
  const companyIds: string[] = [];
  const searches: Array<Readonly<Record<string, readonly string[]>>> = [];
  let activeScenario = "default";
  let currentPage = 1;
  let transientAttempts = 0;
  let captchaResponses = 0;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    requestLog.push(`${request.method ?? "GET"} ${url.pathname}${url.search}`);
    const submitted = url.pathname === "/search" && url.searchParams.has("okved");

    if (url.pathname === "/search" && !submitted) {
      activeScenario = url.searchParams.get("scenario") ?? "default";
      responseHtml(response, fixture.search.replace(
        "{{SCENARIO_INPUT}}",
        activeScenario === "default"
          ? ""
          : `<input type="hidden" name="scenario" value="${escapeHtml(activeScenario)}">`,
      ));
      return;
    }

    if (submitted) {
      activeScenario = url.searchParams.get("scenario") ?? activeScenario;
      currentPage = url.searchParams.get("page") === "2" ? 2 : 1;
      searches.push(Object.fromEntries(
        [...new Set(url.searchParams.keys())].map((key) => [key, url.searchParams.getAll(key)]),
      ));
      if (activeScenario === "transient-then-ok" && transientAttempts++ < 2) {
        responseHtml(response, "<main><h1>Temporary upstream failure</h1></main>", 503);
        return;
      }
      if (activeScenario === "transient-exhausted") {
        transientAttempts += 1;
        responseHtml(response, "<main><h1>Temporary upstream failure</h1></main>", 503);
        return;
      }
      if (activeScenario === "http-403") {
        responseHtml(response, '<main aria-label="Forbidden"><h1>Forbidden</h1></main>', 403);
        return;
      }
      if (activeScenario === "soft-block") {
        responseHtml(response, '<main aria-label="Доступ временно ограничен"><h1>Слишком много запросов</h1></main>');
        return;
      }
      if (activeScenario === "captcha" && captchaResponses++ === 0) {
        responseHtml(response, fixture.captcha);
        return;
      }
      const results = currentPage === 1 ? fixture.page1 : fixture.page2;
      responseHtml(response, retainScenario(results, activeScenario));
      return;
    }

    const companyMatch = /^\/company\/([1-9][0-9]*)$/u.exec(url.pathname);
    if (companyMatch?.[1] !== undefined && companies[companyMatch[1]] !== undefined) {
      const id = companyMatch[1];
      companyIds.push(id);
      if (activeScenario === "foreign-redirect" && id === "1001") {
        response.writeHead(302, { location: "https://foreign.invalid/company/1001" });
        response.end();
        return;
      }
      responseHtml(response, renderCompany(
        fixture,
        id,
        companies[id]!,
        currentPage,
        activeScenario,
      ));
      return;
    }

    responseHtml(response, "<main><h1>Not found</h1></main>", 404);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture server did not bind TCP");
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    requests: () => [...requestLog],
    companyRequestIds: () => [...companyIds],
    submittedSearches: () => searches.map((search) => ({ ...search })),
    close: () => closeServer(server),
  };
}

function renderCompany(
  fixture: Awaited<ReturnType<typeof loadFixtures>>,
  id: string,
  company: CompanyFixture,
  page: number,
  scenario: string,
): string {
  const primaryOkved = company.primaryOkved ?? "43.11";
  const rows = (company.additionalOkveds ?? []).map((code) =>
    `<tr><td>${code}</td><td>Тестовый дополнительный вид</td></tr>`
  ).join("");
  const template = company.ip ? fixture.ip : company.inactive ? fixture.inactive : fixture.active;
  let html = template
    .replaceAll("{{NAME}}", company.name)
    .replaceAll("{{INN}}", company.inn)
    .replaceAll("{{PRIMARY_OKVED}}", primaryOkved)
    .replaceAll("{{PRIMARY_TEXT}}", "Разборка и снос зданий")
    .replaceAll("{{ADDITIONAL_ROWS}}", rows)
    .replaceAll("{{BACK_HREF}}", searchHref(page, scenario));
  if (scenario === "malformed-inn" && id === "1001") {
    html = html.replace("7700000016 / 770001001", "7700000017 / 770001001");
  }
  if (scenario === "missing-label" && id === "1001") {
    html = html.replace("ИНН / КПП:", "Реестровый номер:");
  }
  return html;
}

function retainScenario(html: string, scenario: string): string {
  if (scenario === "default") return html;
  return html.replace(
    "/search?okved=43.11&amp;page=2",
    `/search?okved=43.11&amp;page=2&amp;scenario=${encodeURIComponent(scenario)}`,
  );
}

function searchHref(page: number, scenario: string): string {
  const query = new URLSearchParams({ okved: "43.11", ...(page === 2 ? { page: "2" } : {}) });
  if (scenario !== "default") query.set("scenario", scenario);
  return `/search?${query.toString().replaceAll("&", "&amp;")}`;
}

async function loadFixtures() {
  const read = (name: string) => readFile(join(fixtureDirectory, name), "utf8");
  const [search, page1, page2, active, inactive, ip, captcha] = await Promise.all([
    read("search.html"),
    read("results-page-1.html"),
    read("results-page-2.html"),
    read("company-active.html"),
    read("company-inactive.html"),
    read("company-ip.html"),
    read("captcha.html"),
  ]);
  return { search, page1, page2, active, inactive, ip, captcha };
}

function responseHtml(response: import("node:http").ServerResponse, body: string, status = 200): void {
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
