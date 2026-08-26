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
  externalHttpUrl?: string;
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

    if (url.pathname === "/fixture-service-worker.js") {
      response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      response.end(`
        self.addEventListener("install", () => self.skipWaiting());
        self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
        self.addEventListener("message", (event) => event.waitUntil(
          fetch(event.data.url)
            .then(() => event.source.postMessage("probe-complete"))
            .catch(() => event.source.postMessage("probe-complete"))
        ));
      `);
      return;
    } else if (url.pathname === "/fixture-download") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=fixture.bin",
      });
      response.end("fixture download");
      return;
    } else if (url.pathname === "/search") {
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
            : browserIsolationFixtureScript(scenario, options),
        );
        if (scenario === "pagination-no-op") {
          body = body.replace(
            /href="\/results\/page-2\?[^"]+"/u,
            `href="/results/page-1?okved=43.11&amp;status=work&amp;scenario=${scenario}"`,
          );
        }
        if (scenario === "action-ledger-secret" || scenario === "action-ledger-secret-failure") {
          const target = scenario === "action-ledger-secret"
            ? "/company/1001?from=1&amp;scenario=action-ledger-secret#dom-only-action-secret"
            : "/forbidden#dom-only-action-secret";
          body = body.replace(
            /<a href="\/company\/1001\?[^"]+">[^<]+<\/a>/u,
            `<a href="${target}">Открыть карточку 1001 dom-only-action-secret</a>`,
          );
        }
        if (scenario === "mismatched-scope") {
          body = body.replace("<dt>ОКВЭД</dt><dd>43.11</dd>", "<dt>ОКВЭД</dt><dd>43.12</dd>");
        }
        if (scenario === "mid-page-403") {
          body = body.replace(
            /href="\/company\/1002\?[^"]+"/u,
            'href="/forbidden"',
          );
        }
      }
    } else if (url.pathname === "/results/page-2") {
      body = scenario === "page-2-soft-block"
        ? files.softBlock
        : (scenario === "pagination-repeated-terminal"
          ? renderResult(files.page1, scenario).replace(
              "{{EXTERNAL_RESOURCE}}",
              '<p role="status">Последняя страница</p>',
            ).replaceAll("from=1", "from=2")
          : renderResult(files.page2, scenario).replace(
            "{{TERMINAL_MARKER}}",
            scenario === "missing-terminal" ? "" : '<p role="status">Последняя страница</p>',
          ));
      if (scenario === "pagination-reordered-boundary" && body !== undefined) {
        const first = '<a href="/company/1002?from=2&amp;scenario=pagination-reordered-boundary">Открыть карточку 1002 Бета Демонтаж</a>';
        const second = '<a href="/company/1003?from=2&amp;scenario=pagination-reordered-boundary">Открыть карточку 1003 Гамма Снос</a>';
        body = body.replace(`${first}\n      ${second}`, `${second}\n      ${first}`);
      }
      if (scenario === "pagination-skips-page" && body !== undefined) {
        body = body.replace("<dt>Страница</dt><dd>2</dd>", "<dt>Страница</dt><dd>3</dd>");
      }
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
        if (scenario === "unsafe-url-components" && companyKey === "1001") {
          body = body.replace(
            "https://alpha.example",
            "https://userinfo-name:userinfo-pass@localhost/profile?public=kept#candidate-fragment",
          ).replace(
            "</dl>",
            `<a href="https://userinfo-name:userinfo-pass@localhost/public?kept=yes#dom-fragment">Public</a>
             <p>action-fragment</p>
             </dl>`,
          );
        }
        if (scenario === "href-only-url-secrets" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<a href="https://href-user:href-pass@localhost/public?token=href-query-secret#href-fragment-secret">Public</a>
             <p style="display:block;width:260px;height:24px">href-user</p>
             <p style="display:block;width:260px;height:24px">href-pass</p>
             <p style="display:block;width:260px;height:24px">href-query-secret</p>
             <p style="display:block;width:260px;height:24px">href-fragment-secret</p>
             </dl>`,
          );
        }
        if (scenario === "non-anchor-href-secrets" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<button href="https://non-anchor-user:non-anchor-pass@localhost/public?token=non-anchor-query#non-anchor-fragment">Public action</button>
             <p style="position:absolute;left:420px;top:80px;width:260px;height:32px;margin:0;background:#fff">non-anchor-fragment</p>
             </dl>`,
          );
        }
        if (scenario === "split-href-secret" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<a href="https://localhost/public#href-fragment-secret">Public fragment</a>
             <p style="position:absolute;left:420px;top:150px;width:260px;height:32px;margin:0;background:#fff">href-<span>fragment-secret</span></p>
             </dl>`,
          );
        }
        if (scenario === "unicode-split-href-secret" && companyKey === "1001") {
          body = body.replace(
            "</head><body>",
            '</head><body style="min-height:620px">',
          ).replace(
            "</dl>",
            `<a href="https://localhost/public#foo-unique-secret">Public Unicode fragment</a>
             <p style="position:absolute;left:420px;top:220px;width:260px;height:32px;margin:0;background:#fff;font:24px monospace">İf<span>oo-unique-secret</span></p>
             </dl>`,
          );
        }
        if (scenario === "body-attribute-href-secret" && companyKey === "1001") {
          body = body.replace(
            "</head><body>",
            '</head><body data-capture="body-attribute-secret" style="min-height:620px">',
          ).replace(
            "</dl>",
            `<a href="https://localhost/public#body-attribute-secret">Public body attribute fragment</a>
             </dl>`,
          );
        }
        if (scenario === "hidden-boundary-href-secret" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<a href="https://localhost/public#hidden-visible-secret">Public hidden-boundary fragment</a>
             <span style="display:none">hidden-</span><p style="position:absolute;left:420px;top:290px;width:260px;height:32px;margin:0;background:#fff">visible-secret</p>
             <p style="position:absolute;left:420px;top:350px;width:260px;height:32px;margin:0;background:#fff">Unrelated retained marker</p>
             </dl>`,
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
        if (scenario === "split-generic-contact" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<p style="position:absolute;left:420px;top:420px;width:300px;height:32px;margin:0;background:#fff;font:20px monospace">operator@<span>example.test</span></p>
             </dl>`,
          );
        }
        if (scenario === "mutation-after-sanitized-snapshot" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `</dl><script>
              const nativeClone = Node.prototype.cloneNode;
              Node.prototype.cloneNode = function (deep) {
                const snapshot = nativeClone.call(this, deep);
                if (this !== document.documentElement) return snapshot;
                queueMicrotask(() => {
                  const late = document.createElement("p");
                  late.textContent = "late-mutation@example.test";
                  late.style.cssText = "position:fixed;left:760px;top:20px;width:40px;height:40px;margin:0;background:#f00;color:#f00;z-index:2147483647";
                  document.body.append(late);
                });
                return snapshot;
              };
            </script>`,
          );
        }
        if (scenario === "painted-declarative-css" && companyKey === "1001") {
          body = body.replace(
            "</head>",
            `<style>
              .masked-contact { position:fixed;left:760px;top:80px;width:40px;height:40px;background:#f00;mask-image:linear-gradient(#000,#000); }
              .border-contact { position:fixed;left:760px;top:140px;width:20px;height:20px;border:10px solid transparent;border-image-source:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='red'/%3E%3C/svg%3E");border-image-slice:1; }
              .listed-contact { position:fixed;left:760px;top:200px;list-style-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='red'/%3E%3C/svg%3E"); }
            </style></head>`,
          ).replace(
            "</dl>",
            `</dl><p class="masked-contact">Masked CSS pixels</p>
             <p class="border-contact">operator@example.test</p>
             <ul class="listed-contact"><li>operator@example.test</li></ul>
             <div><template shadowrootmode="closed"><style>:host{display:block;background:#f00}</style>operator@example.test</template></div>`,
          );
        }
        if (scenario.startsWith("painted-") && companyKey === "1001") {
          body = injectPaintedSurface(body, scenario);
        }
        if (scenario === "unsafe-protocol-hrefs" && companyKey === "1001") {
          body = body.replace(
            "</dl>",
            `<a href="javascript:alert(1)">javascript</a>
             <a href="d&#97;ta:text/html,unsafe">encoded data</a>
             <a href="file:///tmp/unsafe">file</a>
             <a href="//localhost/public">protocol relative</a>
             <a href="/relative-safe">relative safe</a>
             </dl>`,
          );
        }
        if (scenario === "unsafe-candidate-website" && companyKey === "1001") {
          body = body.replace("https://alpha.example", "javascript:alert(1)");
        }
        if (scenario === "projection-card" && companyKey === "1001") {
          body = body.replace(
            "</main>",
            "<aside>Страница компании <strong>Иван Петров</strong> +7 (495) 999-88-77</aside></main>",
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

function browserIsolationFixtureScript(
  scenario: string,
  options: ListOrgFixtureServerOptions,
): string {
  if (scenario === "same-origin-websocket") {
    return `<script>new WebSocket("ws://" + location.host + "/fixture-websocket");</script>`;
  }
  if (scenario === "external-websocket" && options.externalWebSocketUrl !== undefined) {
    return `<script>new WebSocket(${JSON.stringify(options.externalWebSocketUrl)});</script>`;
  }
  if (scenario === "service-worker-caught") {
    return `<script>
      navigator.serviceWorker.register("/fixture-service-worker.js")
        .catch(() => undefined);
    </script>`;
  }
  if (scenario === "service-worker-external" && options.externalHttpUrl !== undefined) {
    return `<script>
      const results = document.querySelector("main");
      results.setAttribute("aria-label", "Service worker pending");
      const complete = () => results.setAttribute("aria-label", "Результаты поиска");
      navigator.serviceWorker.addEventListener("message", complete, { once: true });
      navigator.serviceWorker.register("/fixture-service-worker.js")
        .then(() => navigator.serviceWorker.ready)
        .then((registration) => registration.active.postMessage({ url: ${JSON.stringify(options.externalHttpUrl)} }))
        .catch(() => fetch(${JSON.stringify(options.externalHttpUrl)}))
        .catch(() => undefined)
        .finally(() => {
          if (navigator.serviceWorker.controller === null) complete();
        });
    </script>`;
  }
  if (scenario === "popup-side-channel") {
    return '<script>window.open("/soft-block", "fixture-popup");</script>';
  }
  if (scenario === "download-side-channel") {
    return `<script>
      const link = document.createElement("a");
      link.href = "/fixture-download";
      link.download = "fixture.bin";
      document.body.append(link);
      link.click();
    </script>`;
  }
  return "";
}

function injectPaintedSurface(body: string, scenario: string): string {
  const surface = (() => {
    switch (scenario) {
      case "painted-svg":
        return '<svg width="320" height="40"><text x="0" y="24">operator@example.test</text></svg>';
      case "painted-shadow-open":
        return `<div id="shadow-host"></div><script>
          document.querySelector("#shadow-host").attachShadow({ mode: "open" }).innerHTML =
            "<p>operator@example.test</p>";
        </script>`;
      case "painted-shadow-closed":
        return `<div id="shadow-host"></div><script>
          try {
            document.querySelector("#shadow-host").attachShadow({ mode: "closed" }).innerHTML =
              "<p>operator@example.test</p>";
          } catch {}
        </script>`;
      case "painted-generated":
        return '<style>.generated-contact::before{content:"operator@example.test"}</style><p class="generated-contact">Generated</p>';
      case "painted-canvas":
        return '<canvas id="contact-canvas" width="320" height="40"></canvas><script>contactCanvas(); function contactCanvas(){const c=document.querySelector("#contact-canvas").getContext("2d");c.font="20px sans-serif";c.fillText("operator@example.test",0,24)}</script>';
      case "painted-image":
        return '<img alt="contact pixels" width="32" height="32" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22%3E%3Crect width=%2232%22 height=%2232%22 fill=%22red%22/%3E%3C/svg%3E">';
      case "painted-video":
        return '<video style="display:block;width:320px;height:40px" src="data:video/mp4;base64,AAAA"></video>';
      case "painted-background-data":
        return '<p style="width:320px;height:40px;background-image:url(data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E)">Background</p>';
      default:
        return "";
    }
  })();
  return body.replace("</dl>", `</dl>${surface}`);
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
