import type { BrowserRawBundle } from "../../../domain/discovery";
import type { Page } from "playwright";

export const MANDATORY_SENSITIVE_QUERY_PARAMETERS = [
  "access_token",
  "auth",
  "authorization",
  "cookie",
  "session",
  "session_id",
  "token",
] as const;

export const SAFE_CAPTURE_TAGS = [
  "html", "head", "body", "main", "header", "footer", "nav", "section", "article",
  "h1", "h2", "h3", "h4", "p", "div", "span", "strong", "em", "small", "br",
  "ul", "ol", "li", "dl", "dt", "dd", "form", "label", "input", "button", "a",
  "table", "thead", "tbody", "tr", "th", "td",
] as const;

export const SAFE_CAPTURE_ATTRIBUTES = [
  "lang", "role", "href", "type", "name", "value", "checked", "disabled",
] as const;

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/iu;
const PHONE_PATTERN = /(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}/u;
const SECRET_QUERY_PATTERN = /(?:[?&]|\\u0026)(?:access_token|auth|authorization|cookie|session|session_id|token|[^?&=]*(?:secret|credential|password)[^?&=]*)=/iu;
const GENERIC_SECRET_PARAMETER_PATTERN = /(?:secret|credential|password)/iu;

export function sanitizeBrowserUrl(
  value: string,
  sensitiveQueryParameters: readonly string[],
): string {
  const url = new URL(value);
  const sensitive = new Set(sensitiveQueryParameters.map((name) => name.toLowerCase()));
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitiveParameter(name, sensitive)) url.searchParams.delete(name);
  }
  return url.toString();
}

export function sensitiveQueryValues(
  value: string,
  sensitiveQueryParameters: readonly string[],
): readonly string[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const sensitive = new Set(sensitiveQueryParameters.map((name) => name.toLowerCase()));
  const values: string[] = [];
  for (const [name, queryValue] of url.searchParams) {
    if (isSensitiveParameter(name, sensitive) && queryValue !== "") values.push(queryValue);
  }
  return values;
}

export function sanitizeBrowserActionTarget(
  value: string,
  sensitiveQueryParameters: readonly string[],
  sensitiveValues: readonly string[],
): string {
  let output = value;
  try {
    output = sanitizeBrowserUrl(output, sensitiveQueryParameters);
  } catch {
    // Accessible names and labels are not URLs; redact their text below.
  }
  for (const term of [...new Set(sensitiveValues.filter((item) => item !== ""))]
    .sort((left, right) => right.length - left.length)) {
    output = replaceEveryCaseInsensitive(output, term, "[REDACTED]");
  }
  return output.replace(new RegExp(EMAIL_PATTERN.source, "giu"), "[REDACTED]")
    .replace(new RegExp(PHONE_PATTERN.source, "gu"), "[REDACTED]");
}

export function assertBrowserCaptureSafe(
  bundle: BrowserRawBundle,
  sensitiveValues: readonly string[] = [],
): void {
  const dom = new TextDecoder("utf-8", { fatal: true }).decode(bundle.sanitizedDomUtf8);
  const actionMetadata = bundle.actions.map((action) => ({
    kind: action.kind,
    target: action.target,
    outcome: action.outcome,
    navigationStatus: action.navigationStatus,
  }));
  const candidateMetadata = bundle.candidateEvidence === null ? null : {
    sourceRecordKey: bundle.candidateEvidence.sourceRecordKey,
    inn: bundle.candidateEvidence.inn,
    name: bundle.candidateEvidence.name,
    website: bundle.candidateEvidence.website,
    okvedCode: bundle.candidateEvidence.okvedCode,
    isPrimary: bundle.candidateEvidence.isPrimary,
  };
  const textualEvidence = [
    dom,
    bundle.finalUrl,
    JSON.stringify(candidateMetadata),
    JSON.stringify(actionMetadata),
  ].join("\n");
  assertNoContactOrSecret(textualEvidence, sensitiveValues);
  if (bundle.sourceKind === "list-org-browser") {
    const forbiddenMarkup = /<!--|<\s*(?:script|style|meta|link|iframe|object|embed|template|noscript)\b|\s(?:aria-[\w-]+|data-[\w-]+|title|style|src|action|on[\w-]+)=/iu;
    if (forbiddenMarkup.test(dom)) throw new Error("raw redaction scan failed");
  }
}

export function assertPersistableRawBundle(bundle: BrowserRawBundle): void {
  assertBrowserCaptureSafe(bundle);
}

export async function sanitizePageDom(
  page: Page,
  sensitiveQueryParameters: readonly string[],
  redactLabeledValues: readonly string[],
  redactionValues: readonly string[],
): Promise<Uint8Array> {
  const html = await page.evaluate(({
    sensitiveNames,
    redactLabels,
    redactValues,
    safeTags,
    safeAttributes,
  }) => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const allowedTags = new Set<string>(safeTags);
    const allowedAttributes = new Set<string>(safeAttributes);
    const sensitive = new Set(sensitiveNames.map((name) => name.toLowerCase()));
    const terms = [...new Set(redactValues.filter((value) => value !== ""))]
      .sort((left, right) => right.length - left.length);
    // Object methods survive tsx/esbuild keepNames serialization without an
    // injected Node-only __name helper inside Playwright's page context.
    const helpers = {
      redact(value: string): string {
        let output = value;
        for (const term of terms) {
          const normalizedTerm = term.toLocaleLowerCase("en-US");
          let searchFrom = 0;
          let index = output.toLocaleLowerCase("en-US").indexOf(normalizedTerm, searchFrom);
          while (index >= 0) {
            output = `${output.slice(0, index)}[REDACTED]${output.slice(index + term.length)}`;
            searchFrom = index + "[REDACTED]".length;
            index = output.toLocaleLowerCase("en-US").indexOf(normalizedTerm, searchFrom);
          }
        }
        return output
          .replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/giu, "[REDACTED]")
          .replace(/(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}/gu, "[REDACTED]");
      },
    };

    const comments = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const commentsToRemove: Comment[] = [];
    while (comments.nextNode()) commentsToRemove.push(comments.currentNode as Comment);
    for (const comment of commentsToRemove) comment.remove();

    for (const element of [...clone.querySelectorAll("*")]) {
      if (!allowedTags.has(element.tagName.toLowerCase())) {
        element.remove();
        continue;
      }
      if (element.hasAttribute("hidden") || element.matches("input[type='hidden' i]")) {
        element.remove();
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const attributeName = attribute.name.toLowerCase();
        if (!allowedAttributes.has(attributeName)) {
          element.removeAttribute(attribute.name);
          continue;
        }
        let attributeValue = attribute.value;
        if (attributeName === "href") {
          if (/^(?:mailto|tel):/iu.test(attributeValue)) {
            element.removeAttribute(attribute.name);
            continue;
          }
          try {
            const url = new URL(attributeValue, document.baseURI);
            for (const name of [...url.searchParams.keys()]) {
              if (sensitive.has(name.toLowerCase())
                || /(?:secret|credential|password)/iu.test(name)) {
                url.searchParams.delete(name);
              }
            }
            attributeValue = url.toString();
          } catch {
            element.removeAttribute(attribute.name);
            continue;
          }
        }
        const redactedAttribute = helpers.redact(attributeValue);
        if (redactedAttribute.includes("[REDACTED]")) {
          element.removeAttribute(attribute.name);
        } else {
          element.setAttribute(attribute.name, redactedAttribute);
        }
      }
    }

    const redacted = new Set(redactLabels);
    for (const term of clone.querySelectorAll("dt")) {
      if (redacted.has(term.textContent?.trim() ?? "")) {
        const value = term.nextElementSibling;
        if (value !== null) {
          for (const attribute of [...value.attributes]) value.removeAttribute(attribute.name);
          value.replaceChildren(document.createTextNode("[REDACTED]"));
        }
      }
    }
    const text = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (text.nextNode()) {
      const node = text.currentNode as Text;
      node.data = helpers.redact(node.data);
    }
    return `<!doctype html>\n${clone.outerHTML}`;
  }, {
    sensitiveNames: sensitiveQueryParameters,
    redactLabels: redactLabeledValues,
    redactValues: redactionValues,
    safeTags: SAFE_CAPTURE_TAGS,
    safeAttributes: SAFE_CAPTURE_ATTRIBUTES,
  });
  return new TextEncoder().encode(html);
}

export function addPageRedactionOverlays(
  page: Page,
  labels: readonly string[],
  redactionValues: readonly string[],
): Promise<Record<string, number>> {
  return page.evaluate(({ wantedLabels, redactValues }) => {
    const counts: Record<string, number> = {};
    const terms = [...document.querySelectorAll("dt")];
    const elements = new Set<HTMLElement>();
    for (const label of wantedLabels) {
      counts[label] = 0;
      for (const term of terms.filter((candidate) => candidate.textContent?.trim() === label)) {
        const value = term.nextElementSibling;
        if (!(value instanceof HTMLElement)) continue;
        elements.add(value);
        counts[label] += 1;
      }
    }
    const sensitiveTerms = redactValues.filter((value) => value !== "");
    const helpers = {
      containsSensitive(value: string): boolean {
        const normalized = value.toLocaleLowerCase("en-US");
        return sensitiveTerms.some((term) => normalized.includes(term.toLocaleLowerCase("en-US")))
          || /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/iu.test(value)
          || /(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}/u.test(value);
      },
    };
    for (const candidate of document.querySelectorAll("*")) {
      if (!(candidate instanceof HTMLElement)) continue;
      const directText = [...candidate.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join(" ");
      const attributeText = [...candidate.attributes].map((attribute) => attribute.value).join(" ");
      if (helpers.containsSensitive(`${directText} ${attributeText}`)) elements.add(candidate);
    }
    for (const value of elements) {
      const rect = value.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const overlay = document.createElement("div");
      overlay.dataset.browserCaptureRedaction = "true";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "absolute",
        left: `${rect.left + window.scrollX}px`,
        top: `${rect.top + window.scrollY}px`,
        width: `${Math.max(rect.width, 1)}px`,
        height: `${Math.max(rect.height, 1)}px`,
        background: "#000",
        zIndex: "2147483647",
      });
      document.body.append(overlay);
    }
    return counts;
  }, { wantedLabels: labels, redactValues: redactionValues });
}

function assertNoContactOrSecret(value: string, sensitiveValues: readonly string[]): void {
  const normalized = value.toLocaleLowerCase("en-US");
  if (EMAIL_PATTERN.test(value)
    || PHONE_PATTERN.test(value)
    || SECRET_QUERY_PATTERN.test(value)
    || sensitiveValues.some((term) => term !== "" && normalized.includes(term.toLocaleLowerCase("en-US")))) {
    throw new Error("raw redaction scan failed");
  }
}

function isSensitiveParameter(name: string, sensitive: ReadonlySet<string>): boolean {
  return sensitive.has(name.toLowerCase()) || GENERIC_SECRET_PARAMETER_PATTERN.test(name);
}

function replaceEveryCaseInsensitive(value: string, term: string, replacement: string): string {
  let output = value;
  const normalizedTerm = term.toLocaleLowerCase("en-US");
  let searchFrom = 0;
  let index = output.toLocaleLowerCase("en-US").indexOf(normalizedTerm, searchFrom);
  while (index >= 0) {
    output = `${output.slice(0, index)}${replacement}${output.slice(index + term.length)}`;
    searchFrom = index + replacement.length;
    index = output.toLocaleLowerCase("en-US").indexOf(normalizedTerm, searchFrom);
  }
  return output;
}
