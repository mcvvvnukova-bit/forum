import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ListOrgFixtureServer {
  origin: string;
  webSocketUpgradeCount(): number;
  close(): Promise<void>;
}

export interface ListOrgFixtureServerOptions {
  externalWebSocketUrl?: string;
}

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../test/fixtures/list-org-browser",
);

export async function startListOrgFixtureServer(
  options: ListOrgFixtureServerOptions = {},
): Promise<ListOrgFixtureServer> {
  const files = await loadFixtures();
  let webSocketUpgrades = 0;
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
      if (scenario === "403-after-click") {
        status = 403;
        body = "<!doctype html><html><body><main><h1>Forbidden</h1></main></body></html>";
      } else {
        body = renderResult(files.page1, scenario).replace(
          "{{EXTERNAL_RESOURCE}}",
          scenario === "external"
            ? '<img src="https://external.invalid/tracker.png" alt="external tracker">'
            : webSocketFixtureScript(scenario, options.externalWebSocketUrl),
        );
        if (scenario === "mismatched-scope") {
          body = body.replace("<dt>ОКВЭД</dt><dd>43.11</dd>", "<dt>ОКВЭД</dt><dd>43.12</dd>");
        }
      }
    } else if (url.pathname === "/results/page-2") {
      body = renderResult(files.page2, scenario).replace(
        "{{TERMINAL_MARKER}}",
        scenario === "missing-terminal" ? "" : '<p role="status">Последняя страница</p>',
      );
    } else {
      const companyMatch = /^\/company\/(1001|1002|1003)$/.exec(url.pathname);
      const companyKey = companyMatch?.[1];
      if (isCompanyKey(companyKey)) {
        const from = url.searchParams.get("from") === "2" ? "2" : "1";
        const suffix = scenario === "" ? "" : `&amp;scenario=${encodeURIComponent(scenario)}`;
        body = files.companies[companyKey]
          .replace("{{BACK_HREF}}", `/results/page-${from}?okved=43.11&amp;status=work${suffix}`);
        if (scenario === "conflicting-identity" && companyKey === "1001") {
          body = body.replace(
            "<dt>ИНН</dt><dd>7707083893</dd>",
            "<dt>ИНН</dt><dd>7707083893</dd><dt>ИНН</dt><dd>7710140679</dd>",
          );
        }
        if (scenario === "newer-organization" && companyKey === "1001") {
          body = body
            .replace("ООО «Альфа Строй»", "ООО «Альфа Строй Новая»")
            .replace("https://alpha.example", "https://alpha-new.example")
            .replace("<dt>Тип ОКВЭД</dt><dd>Основной</dd>", "<dt>Тип ОКВЭД</dt><dd>Дополнительный</dd>");
        }
        if (scenario === "invalid-inn" && companyKey === "1001") {
          body = body.replace("<dt>ИНН</dt><dd>7707083893</dd>", "<dt>ИНН</dt><dd>7707083894</dd>");
        }
        if (scenario === "ambiguous-okved" && companyKey === "1001") {
          body = body.replace(
            "<dt>ОКВЭД</dt><dd>43.11</dd>",
            "<dt>ОКВЭД</dt><dd>43.11</dd><dt>ОКВЭД</dt><dd>43.12</dd>",
          );
        }
        if (scenario === "mismatched-okved" && companyKey === "1001") {
          body = body.replace("<dt>ОКВЭД</dt><dd>43.11</dd>", "<dt>ОКВЭД</dt><dd>43.12</dd>");
        }
        if (scenario === "unknown-role" && companyKey === "1001") {
          body = body.replace(
            "<dt>Тип ОКВЭД</dt><dd>Основной</dd>",
            "<dt>Тип ОКВЭД</dt><dd>Неизвестный</dd>",
          );
        }
        if (scenario === "conflicting-duplicate" && companyKey === "1002" && from === "2") {
          body = body.replace("АО «Бета Демонтаж»", "АО «Бета Демонтаж Конфликт»");
        }
        if (companyKey === "1002") {
          const mismatchedOkved = () => {
            body = body!.replace("<dt>ОКВЭД</dt><dd>43.11</dd>", "<dt>ОКВЭД</dt><dd>43.12</dd>");
          };
          const invalidInn = () => {
            body = body!.replace("<dt>ИНН</dt><dd>7710140679</dd>", "<dt>ИНН</dt><dd>not-an-inn</dd>");
          };
          if (scenario === "accepted-then-rejected" && from === "2") mismatchedOkved();
          if (scenario === "rejected-then-accepted" && from === "1") mismatchedOkved();
          if (scenario === "rejected-reason-conflict") {
            if (from === "1") invalidInn();
            else mismatchedOkved();
          }
          if (scenario === "duplicate-rejected-same") mismatchedOkved();
        }
        if (scenario === "redaction-surfaces" && companyKey === "1001") {
          body = body.replace(
            "</head>",
            '<meta name="description" content="info@alpha.example default-secret configured-secret"></head>',
          ).replace(
            "</dl>",
            `</dl><!-- backup@alpha.example default-secret -->
             <p aria-label="Call +7 (495) 111-22-33" data-copy="configured-secret">
               Duplicate: +7 (495) 111-22-33
             </p>
             <a class="contact-value" href="mailto:backup@alpha.example" title="info@alpha.example">Contact</a>`,
          );
        }
        if (scenario === "form-secrets" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<input style="display:block;width:260px;height:24px;margin:4px 0" type="password" name="password" value="pw-123">
             <input style="display:block;width:260px;height:24px;margin:4px 0" type="text" name="csrf_token" value="csrf-123">
             <input style="display:block;width:260px;height:24px;margin:4px 0" type="text" name="api_key" value="api-123">
             <input style="display:block;width:260px;height:24px;margin:4px 0" type="text" name="public_field" value="visible-123">
             </dl>`,
          );
        }
        if (scenario === "configured-form-secret" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<input style="display:block;width:260px" type="text" name="nonce" value="nonce-123">
             </dl>`,
          );
        }
        if (scenario === "empty-form-secret" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<input style="display:block;width:260px;height:24px;margin:4px 0" type="password" name="password" value="" placeholder="password reminder">
             <input style="display:block;width:260px;height:24px;margin:4px 0" type="text" name="nonce" value="" placeholder="nonce reminder">
             <button style="display:block;width:260px;height:24px;margin:4px 0"
                     type="button" name="nonce" value="">nonce button reminder</button>
             </dl>`,
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
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    const key = request.headers["sec-websocket-key"];
    if (url.pathname !== "/fixture-websocket" || typeof key !== "string") {
      socket.destroy();
      return;
    }
    webSocketUpgrades += 1;
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.end([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"));
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
    webSocketUpgradeCount: () => webSocketUpgrades,
    close: () => closeServer(server),
  };
}

function isCompanyKey(value: string | undefined): value is "1001" | "1002" | "1003" {
  return value === "1001" || value === "1002" || value === "1003";
}

function renderResult(template: string, scenario: string): string {
  const query = scenario === "" ? "" : `&amp;scenario=${encodeURIComponent(scenario)}`;
  return template.replaceAll("{{SCENARIO_QUERY}}", query);
}

function webSocketFixtureScript(
  scenario: string,
  externalWebSocketUrl: string | undefined,
): string {
  if (scenario === "same-origin-websocket") {
    return `<script>new WebSocket("ws://" + location.host + "/fixture-websocket");</script>`;
  }
  if (scenario === "external-websocket" && externalWebSocketUrl !== undefined) {
    return `<script>new WebSocket(${JSON.stringify(externalWebSocketUrl)});</script>`;
  }
  return "";
}

async function loadFixtures() {
  const load = (name: string) => readFile(join(fixtureDirectory, name), "utf8");
  const [search, page1, page2, company1001, company1002, company1003, captcha, softBlock, contractDrift] =
    await Promise.all([
      load("search.html"), load("results-page-1.html"), load("results-page-2.html"),
      load("company-1001.html"), load("company-1002.html"), load("company-1003.html"),
      load("captcha.html"), load("soft-block.html"), load("contract-drift.html"),
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
