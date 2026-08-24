import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ListOrgFixtureServer {
  origin: string;
  close(): Promise<void>;
}

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/list-org-browser");

export async function startListOrgFixtureServer(): Promise<ListOrgFixtureServer> {
  const files = await loadFixtures();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    const scenario = url.searchParams.get("scenario") ?? "";
    let status = 200;
    let body: string | undefined;

    if (url.pathname === "/search") {
      const scenarioInput = scenario === ""
        ? ""
        : `<input type="hidden" name="scenario" value="${escapeHtml(scenario)}">`;
      body = files.search.replace("{{SCENARIO_INPUT}}", scenarioInput);
    } else if (url.pathname === "/captcha") {
      body = files.captcha;
    } else if (url.pathname === "/forbidden") {
      status = 403;
      body = "Forbidden";
    } else if (url.pathname === "/soft-block") {
      body = files.softBlock;
    } else if (url.pathname === "/contract-drift") {
      body = files.contractDrift;
    } else if (url.pathname === "/results/page-1") {
      body = renderResult(files.page1, scenario)
        .replace(
          "{{EXTERNAL_RESOURCE}}",
          scenario === "external"
            ? '<img src="https://external.invalid/tracker.png" alt="external tracker">'
            : "",
        );
    } else if (url.pathname === "/results/page-2") {
      body = renderResult(files.page2, scenario).replace(
        "{{TERMINAL_MARKER}}",
        scenario === "missing-terminal"
          ? ""
          : '<p role="status">Последняя страница</p>',
      );
    } else {
      const companyMatch = /^\/company\/(1001|1002|1003)$/.exec(url.pathname);
      if (companyMatch !== null) {
        const from = url.searchParams.get("from") === "2" ? "2" : "1";
        const suffix = scenario === "" ? "" : `&amp;scenario=${encodeURIComponent(scenario)}`;
        body = files.companies[companyMatch[1] as keyof typeof files.companies]
          .replace("{{BACK_HREF}}", `/results/page-${from}?okved=43.11&amp;status=work${suffix}`);
        if (scenario === "conflicting-identity" && companyMatch[1] === "1001") {
          body = body.replace(
            "<dt>ИНН</dt><dd>7707083893</dd>",
            "<dt>ИНН</dt><dd>7707083893</dd><dt>ИНН</dt><dd>7710140679</dd>",
          );
        }
      }
    }

    if (body === undefined) {
      status = 404;
      body = "Not found";
    }

    response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("fixture server did not allocate a TCP port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function renderResult(template: string, scenario: string): string {
  const scenarioQuery = scenario === "" ? "" : `&amp;scenario=${encodeURIComponent(scenario)}`;
  return template.replaceAll("{{SCENARIO_QUERY}}", scenarioQuery);
}

async function loadFixtures() {
  const load = (name: string) => readFile(join(fixtureDirectory, name), "utf8");
  const [search, page1, page2, company1001, company1002, company1003, captcha, softBlock, contractDrift] =
    await Promise.all([
      load("search.html"),
      load("results-page-1.html"),
      load("results-page-2.html"),
      load("company-1001.html"),
      load("company-1002.html"),
      load("company-1003.html"),
      load("captcha.html"),
      load("soft-block.html"),
      load("contract-drift.html"),
    ]);
  return {
    search,
    page1,
    page2,
    companies: { "1001": company1001, "1002": company1002, "1003": company1003 },
    captcha,
    softBlock,
    contractDrift,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
