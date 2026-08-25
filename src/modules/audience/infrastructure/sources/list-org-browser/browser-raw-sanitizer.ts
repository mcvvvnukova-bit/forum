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

export type BrowserCaptureSafetyEvidence = Pick<
  BrowserRawBundle,
  | "sourceKind"
  | "finalUrl"
  | "sanitizedDomUtf8"
  | "candidateEvidence"
  | "actions"
  | "sensitiveFormFieldNames"
>;

export const SAFE_CAPTURE_TAGS = [
  "html", "head", "body", "main", "header", "footer", "nav", "section", "article",
  "h1", "h2", "h3", "h4", "p", "div", "span", "strong", "em", "small", "br",
  "ul", "ol", "li", "dl", "dt", "dd", "form", "label", "input", "button", "a",
  "table", "thead", "tbody", "tr", "th", "td",
] as const;

export const SAFE_CAPTURE_ATTRIBUTES = [
  "lang", "role", "href", "type", "name", "checked", "disabled",
] as const;

const EMAIL_PATTERN = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/iu;
const PHONE_PATTERN = /(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}/u;
const CANONICAL_UUID_V4_PATTERN_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CANONICAL_UUID_V4_PATTERN = new RegExp(`^${CANONICAL_UUID_V4_PATTERN_SOURCE}$`);
const CANONICAL_UUID_V4_TOKEN_PATTERN = new RegExp(
  `(?<![0-9a-f-])(${CANONICAL_UUID_V4_PATTERN_SOURCE})(?![0-9a-f-])`,
  "g",
);
const GENERIC_SENSITIVE_NAME_PATTERN_SOURCE = "(?:token|csrf|secret|credential|password|api_key|apikey|authorization|cookie|session)";
const GENERIC_SENSITIVE_NAME_PATTERN = new RegExp(GENERIC_SENSITIVE_NAME_PATTERN_SOURCE, "iu");
const SECRET_QUERY_PATTERN = new RegExp(
  `(?:[?&]|\\\\u0026)[^?&=]*${GENERIC_SENSITIVE_NAME_PATTERN_SOURCE}[^?&=]*=`,
  "iu",
);

export function sanitizeBrowserUrl(
  value: string,
  sensitiveQueryParameters: readonly string[],
): string {
  const url = new URL(value);
  sanitizeRetainedUrl(url, sensitiveQueryParameters);
  return url.toString();
}

export function sensitiveBrowserUrlValues(
  value: string,
  sensitiveQueryParameters: readonly string[],
): readonly string[] {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const values: string[] = [];
  for (const [name, queryValue] of url.searchParams) {
    if (isSensitiveFormFieldName(name, sensitiveQueryParameters) && queryValue !== "") {
      values.push(queryValue);
    }
  }
  if (url.username !== "") values.push(decodeUrlComponent(url.username));
  if (url.password !== "") values.push(decodeUrlComponent(url.password));
  const fragment = decodeUrlComponent(url.hash.slice(1));
  if (fragment !== "") {
    values.push(fragment);
    for (const [name, fragmentValue] of new URLSearchParams(fragment)) {
      if (fragmentValue !== "") values.push(fragmentValue);
      else if (name !== "") values.push(name);
    }
  }
  return [...new Set(values.filter((item) => item !== ""))];
}

function decodeUrlComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
    if (/^(?:\/|\.\.?\/|\?|#)/u.test(output)) {
      const url = new URL(output, "https://browser-evidence.invalid");
      sanitizeRetainedUrl(url, sensitiveQueryParameters);
      output = output.startsWith("//")
        ? `//${url.host}${url.pathname}${url.search}`
        : output.startsWith("?")
          ? url.search
          : output.startsWith("#")
            ? ""
            : `${url.pathname}${url.search}`;
    }
    // Other accessible names and labels are not URLs; redact their text below.
  }
  for (const term of [...new Set(sensitiveValues.filter((item) => item !== ""))]
    .sort((left, right) => right.length - left.length)) {
    output = replaceEveryCaseInsensitive(output, term, "[REDACTED]");
  }
  return redactPhoneNumbersOutsideCanonicalUuids(
    output.replace(new RegExp(EMAIL_PATTERN.source, "giu"), "[REDACTED]"),
  );
}

export function assertCompleteBrowserSensitivePolicy(
  sourceKind: string,
  sensitiveFormFieldNames: readonly string[] | undefined,
): void {
  if (sourceKind !== "list-org-browser") return;
  const normalized = new Set(
    (sensitiveFormFieldNames ?? []).map((name) => name.toLocaleLowerCase("en-US")),
  );
  if (MANDATORY_SENSITIVE_QUERY_PARAMETERS.some((name) => !normalized.has(name))) {
    throw new Error("browser raw bundle sensitive form policy is incomplete");
  }
}

export function isCanonicalBrowserActionId(value: unknown): value is string {
  return typeof value === "string"
    && CANONICAL_UUID_V4_PATTERN.test(value);
}

export function assertBrowserCaptureSafe(
  bundle: BrowserCaptureSafetyEvidence,
  sensitiveValues: readonly string[] = [],
): void {
  assertCompleteBrowserSensitivePolicy(bundle.sourceKind, bundle.sensitiveFormFieldNames);
  const dom = new TextDecoder("utf-8", { fatal: true }).decode(bundle.sanitizedDomUtf8);
  const actionMetadata = bundle.actions.map((action) => ({
    id: action.id,
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
  if (bundle.actions.some((action) => !isCanonicalBrowserActionId(action.id))) {
    throw new Error("browser action id is not a canonical UUID v4");
  }
  const sensitiveNames = bundle.sensitiveFormFieldNames ?? [];
  assertRetainedBrowserUrlSafe(bundle.finalUrl, sensitiveNames);
  if (bundle.candidateEvidence?.website !== null && bundle.candidateEvidence?.website !== undefined) {
    assertRetainedBrowserUrlSafe(bundle.candidateEvidence.website, sensitiveNames);
  }
  for (const action of bundle.actions) {
    assertRetainedBrowserUrlSafe(action.target, sensitiveNames);
  }
  assertSerializedBrowserDomSafe(
    dom,
    bundle.sourceKind,
    sensitiveNames,
  );
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
    genericSensitiveNamePatternSource,
  }) => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const allowedTags = new Set<string>(safeTags);
    const allowedAttributes = new Set<string>(safeAttributes);
    const sensitive = new Set(sensitiveNames.map((name) => name.toLowerCase()));
    const genericSensitiveNamePattern = new RegExp(genericSensitiveNamePatternSource, "iu");
    const terms = [...new Set(redactValues.filter((value) => value !== ""))]
      .sort((left, right) => right.length - left.length);
    // Object methods survive tsx/esbuild keepNames serialization without an
    // injected Node-only __name helper inside Playwright's page context.
    const helpers = {
      isSensitiveFormFieldName(name: string): boolean {
        return sensitive.has(name.toLocaleLowerCase("en-US"))
          || genericSensitiveNamePattern.test(name);
      },
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
      if (element.matches("input[type='password' i]")
        || (element.matches("input, textarea, select, button")
          && helpers.isSensitiveFormFieldName(element.getAttribute("name") ?? ""))) {
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
              if (helpers.isSensitiveFormFieldName(name)) {
                url.searchParams.delete(name);
              }
            }
            url.username = "";
            url.password = "";
            url.hash = "";
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
    genericSensitiveNamePatternSource: GENERIC_SENSITIVE_NAME_PATTERN_SOURCE,
  });
  return new TextEncoder().encode(html);
}

export function addPageRedactionOverlays(
  page: Page,
  labels: readonly string[],
  sensitiveFormFieldNames: readonly string[],
  redactionValues: readonly string[],
): Promise<Record<string, number>> {
  return page.evaluate(({
    wantedLabels,
    sensitiveNames,
    redactValues,
    genericSensitiveNamePatternSource,
  }) => {
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
    const configuredSensitiveNames = new Set(
      sensitiveNames.map((name) => name.toLocaleLowerCase("en-US")),
    );
    const genericSensitiveNamePattern = new RegExp(genericSensitiveNamePatternSource, "iu");
    const helpers = {
      isSensitiveFormFieldName(name: string): boolean {
        return configuredSensitiveNames.has(name.toLocaleLowerCase("en-US"))
          || genericSensitiveNamePattern.test(name);
      },
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
    for (const control of document.querySelectorAll("input, textarea, select, button")) {
      if ((control instanceof HTMLInputElement
        || control instanceof HTMLTextAreaElement
        || control instanceof HTMLSelectElement
        || control instanceof HTMLButtonElement)
        && (control.value !== ""
          || (control instanceof HTMLInputElement && control.type.toLowerCase() === "password")
          || helpers.isSensitiveFormFieldName(control.name))) {
        elements.add(control);
      }
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
  }, {
    wantedLabels: labels,
    sensitiveNames: sensitiveFormFieldNames,
    redactValues: redactionValues,
    genericSensitiveNamePatternSource: GENERIC_SENSITIVE_NAME_PATTERN_SOURCE,
  });
}

function assertNoContactOrSecret(value: string, sensitiveValues: readonly string[]): void {
  const normalized = value.toLocaleLowerCase("en-US");
  if (EMAIL_PATTERN.test(value)
    || hasPhoneNumberOutsideCanonicalUuids(value)
    || SECRET_QUERY_PATTERN.test(value)
    || sensitiveValues.some((term) => term !== "" && normalized.includes(term.toLocaleLowerCase("en-US")))) {
    throw new Error("raw redaction scan failed");
  }
}

function hasPhoneNumberOutsideCanonicalUuids(value: string): boolean {
  return value.split(CANONICAL_UUID_V4_TOKEN_PATTERN)
    .some((part, index) => index % 2 === 0 && PHONE_PATTERN.test(part));
}

function redactPhoneNumbersOutsideCanonicalUuids(value: string): string {
  return value.split(CANONICAL_UUID_V4_TOKEN_PATTERN)
    .map((part, index) => index % 2 === 0
      ? part.replace(new RegExp(PHONE_PATTERN.source, "gu"), "[REDACTED]")
      : part)
    .join("");
}

function sanitizeRetainedUrl(
  url: URL,
  sensitiveNames: readonly string[],
): void {
  for (const name of [...url.searchParams.keys()]) {
    if (isSensitiveFormFieldName(name, sensitiveNames)) url.searchParams.delete(name);
  }
  url.username = "";
  url.password = "";
  url.hash = "";
}

function assertRetainedBrowserUrlSafe(
  value: string,
  sensitiveNames: readonly string[],
): void {
  let url: URL;
  try {
    url = new URL(value, "https://browser-evidence.invalid");
  } catch {
    return;
  }
  if (url.hash !== "" || url.username !== "" || url.password !== ""
    || [...url.searchParams.keys()].some((name) =>
    isSensitiveFormFieldName(name, sensitiveNames)
  )) {
    throw new Error("raw redaction scan failed");
  }
}

export function isSensitiveFormFieldName(
  name: string,
  configuredNames: readonly string[],
): boolean {
  const normalizedName = name.toLocaleLowerCase("en-US");
  return configuredNames.some(
    (configuredName) => configuredName.toLocaleLowerCase("en-US") === normalizedName,
  ) || GENERIC_SENSITIVE_NAME_PATTERN.test(name);
}

export function assertSerializedBrowserDomSafe(
  dom: string,
  sourceKind: string,
  sensitiveFormFieldNames: readonly string[],
): void {
  if (sourceKind !== "list-org-browser") return;
  const forbiddenMarkup = /<!--|<\s*(?:script|style|meta|link|iframe|object|embed|template|noscript|textarea|select|option)\b|\s(?:aria-[\w-]+|data-[\w-]+|title|style|src|action|value|on[\w-]+)=/iu;
  if (forbiddenMarkup.test(dom)
    || containsUnsafeSerializedFormMarkup(dom, sensitiveFormFieldNames)
    || containsUnsafeSerializedHref(dom, sensitiveFormFieldNames)) {
    throw new Error("raw redaction scan failed");
  }
}

function containsUnsafeSerializedHref(
  dom: string,
  sensitiveFormFieldNames: readonly string[],
): boolean {
  const hrefAssignmentPattern = /\shref\s*=/giu;
  const hrefValuePattern = /\shref\s*=\s*(["'])(.*?)\1/gisu;
  const assignments = [...dom.matchAll(hrefAssignmentPattern)].length;
  let values = 0;
  for (const match of dom.matchAll(hrefValuePattern)) {
    values += 1;
    const value = decodeHtmlUrlAttribute(match[2] ?? "");
    try {
      assertRetainedBrowserUrlSafe(value, sensitiveFormFieldNames);
    } catch {
      return true;
    }
  }
  return assignments !== values;
}

function decodeHtmlUrlAttribute(value: string): string {
  return value.replace(
    /&(?:amp|quot|apos|#(?:x[0-9a-f]+|[0-9]+));/giu,
    (entity) => {
      const normalized = entity.toLocaleLowerCase("en-US");
      if (normalized === "&amp;") return "&";
      if (normalized === "&quot;") return "\"";
      if (normalized === "&apos;") return "'";
      const numeric = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      return Number.isSafeInteger(numeric) ? String.fromCodePoint(numeric) : entity;
    },
  );
}

function containsUnsafeSerializedFormMarkup(
  dom: string,
  sensitiveFormFieldNames: readonly string[],
): boolean {
  const controlStartPattern = /<\s*(input|button)\b/giu;
  let match: RegExpExecArray | null;
  while ((match = controlStartPattern.exec(dom)) !== null) {
    const controlName = match[1]!.toLocaleLowerCase("en-US");
    let quote: "\"" | "'" | null = null;
    let controlEnd = -1;
    for (let index = controlStartPattern.lastIndex; index < dom.length; index += 1) {
      const character = dom[index];
      if (quote !== null) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === "\"" || character === "'") {
        quote = character;
      } else if (character === ">") {
        controlEnd = index + 1;
        break;
      } else if (character === "<") {
        return true;
      }
    }
    if (controlEnd < 0) return true;
    const control = dom.slice(match.index, controlEnd);
    const attributes = parseSerializedInputAttributes(
      control,
      controlStartPattern.lastIndex - match.index,
    );
    if (attributes === null) return true;
    if (attributes.some((attribute) => attribute.name === "value" && attribute.value !== null)) {
      return true;
    }
    if (attributes.some((attribute) => attribute.name === "type"
      && controlName === "input"
      && attribute.value?.toLocaleLowerCase("en-US") === "password")) {
      return true;
    }
    if (attributes.some((attribute) => attribute.name === "name"
      && attribute.value !== null
      && isSensitiveFormFieldName(attribute.value, sensitiveFormFieldNames))) {
      return true;
    }
    controlStartPattern.lastIndex = controlEnd;
  }
  return false;
}

interface SerializedInputAttribute {
  name: string;
  value: string | null;
}

function parseSerializedInputAttributes(
  markup: string,
  startIndex: number,
): readonly SerializedInputAttribute[] | null {
  const attributes: SerializedInputAttribute[] = [];
  let index = startIndex;
  while (index < markup.length) {
    while (index < markup.length && isHtmlWhitespace(markup[index]!)) index += 1;
    if (markup[index] === ">") {
      return index === markup.length - 1 ? attributes : null;
    }
    if (markup[index] === "/") {
      index += 1;
      while (index < markup.length && isHtmlWhitespace(markup[index]!)) index += 1;
      return markup[index] === ">" && index === markup.length - 1 ? attributes : null;
    }

    const nameStart = index;
    while (index < markup.length && !isAttributeNameDelimiter(markup[index]!)) index += 1;
    if (index === nameStart) return null;
    const name = markup.slice(nameStart, index).toLocaleLowerCase("en-US");
    while (index < markup.length && isHtmlWhitespace(markup[index]!)) index += 1;

    let value: string | null = null;
    if (markup[index] === "=") {
      index += 1;
      while (index < markup.length && isHtmlWhitespace(markup[index]!)) index += 1;
      const quote = markup[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < markup.length && markup[index] !== quote) index += 1;
        if (index >= markup.length) return null;
        value = markup.slice(valueStart, index);
        index += 1;
      } else {
        const valueStart = index;
        while (index < markup.length
          && !isHtmlWhitespace(markup[index]!)
          && markup[index] !== ">") {
          if (/['"<=`]/u.test(markup[index]!)) return null;
          index += 1;
        }
        value = markup.slice(valueStart, index);
      }
    }
    attributes.push({ name, value });
    if (index < markup.length
      && !isHtmlWhitespace(markup[index]!)
      && markup[index] !== ">"
      && markup[index] !== "/") {
      return null;
    }
  }
  return null;
}

function isAttributeNameDelimiter(character: string): boolean {
  return isHtmlWhitespace(character) || character === "=" || character === "/"
    || character === ">" || /['"<`]/u.test(character);
}

function isHtmlWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\n"
    || character === "\f" || character === "\r";
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
