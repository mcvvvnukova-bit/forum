import { createHash } from "node:crypto";

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

export const BROWSER_VISUAL_SAFETY_ACTION_KIND = "verify-visual-safety";
export const BROWSER_VISUAL_SAFETY_POLICY = "sanitized-inert-render-policy/1";

export function browserVisualSafetyTarget(pageFingerprintSha256: string): string {
  return `${BROWSER_VISUAL_SAFETY_POLICY};page-fingerprint-sha256=${pageFingerprintSha256}`;
}

export type BrowserCaptureSafetyEvidence = Pick<
  BrowserRawBundle,
  | "sourceKind"
  | "finalUrl"
  | "sanitizedDomUtf8"
  | "redactedScreenshotPng"
  | "pageFingerprintSha256"
  | "candidateEvidence"
  | "actions"
  | "sensitiveFormFieldNames"
>;

export type BrowserEvidenceSourceProfile = "full-page" | "projection";

export function browserEvidenceSourceProfile(
  sourceKind: string,
): BrowserEvidenceSourceProfile | undefined {
  if (sourceKind === "list-org-browser") return "full-page";
  if (sourceKind === "list-org-live") return "projection";
  return undefined;
}

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
  assertHttpProtocol(url);
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

export async function collectPageSensitiveUrlValues(
  page: Page,
  sensitiveQueryParameters: readonly string[],
): Promise<readonly string[]> {
  const urls = await page.evaluate(() => {
    const resolved = [window.location.href];
    for (const element of document.querySelectorAll("[href]")) {
      const href = element.getAttribute("href");
      if (href === null || /^(?:mailto|tel):/iu.test(href)) continue;
      try {
        resolved.push(new URL(href, document.baseURI).toString());
      } catch {
        // sanitizePageDom removes the corresponding unverifiable attribute.
      }
    }
    return resolved;
  });

  return [...new Set(urls.flatMap(
    (url) => sensitiveBrowserUrlValues(url, sensitiveQueryParameters),
  ))];
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
  const visualTargetPrefix = `${BROWSER_VISUAL_SAFETY_POLICY};page-fingerprint-sha256=`;
  if (value.startsWith(visualTargetPrefix)
    && /^[0-9a-f]{64}$/u.test(value.slice(visualTargetPrefix.length))) {
    return value;
  }
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
  if (browserEvidenceSourceProfile(sourceKind) === undefined) return;
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
  const sourceProfile = browserEvidenceSourceProfile(bundle.sourceKind);
  assertCompleteBrowserSensitivePolicy(bundle.sourceKind, bundle.sensitiveFormFieldNames);
  if (sourceProfile === "full-page") {
    assertExactVisualSafetyProof(bundle.actions, bundle.pageFingerprintSha256);
  } else if (sourceProfile === "projection") {
    assertLiveProjectionEvidence(bundle);
  }
  const dom = new TextDecoder("utf-8", { fatal: true }).decode(bundle.sanitizedDomUtf8);
  const actionMetadata = bundle.actions.map((action) => ({
    id: action.id,
    kind: action.kind,
    target: action.kind === BROWSER_VISUAL_SAFETY_ACTION_KIND
      ? BROWSER_VISUAL_SAFETY_POLICY
      : action.target,
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
  assertRetainedBrowserUrlSafe(bundle.finalUrl, sensitiveNames, false);
  if (bundle.candidateEvidence?.website !== null && bundle.candidateEvidence?.website !== undefined) {
    assertRetainedBrowserUrlSafe(bundle.candidateEvidence.website, sensitiveNames, false);
  }
  for (const action of bundle.actions) {
    assertRetainedBrowserUrlSafe(action.target, sensitiveNames, true);
  }
  assertSerializedBrowserDomSafe(
    dom,
    bundle.sourceKind,
    sensitiveNames,
  );
}

function assertLiveProjectionEvidence(bundle: BrowserCaptureSafetyEvidence): void {
  if (bundle.redactedScreenshotPng.byteLength !== 0
    || bundle.actions.length !== 0) {
    throw new Error("live browser projection contains inconsistent artifact evidence");
  }
  if (bundle.pageFingerprintSha256
    !== createHash("sha256").update(bundle.sanitizedDomUtf8).digest("hex")) {
    throw new Error("live browser projection fingerprint does not match its DOM");
  }
  if (bundle.candidateEvidence !== null
    && (bundle.candidateEvidence.website !== null
      || bundle.candidateEvidence.phone.kind !== "null"
      || bundle.candidateEvidence.email.kind !== "null")) {
    throw new Error("live browser projection contains non-allowlisted contact evidence");
  }
}

function assertExactVisualSafetyProof(
  actions: BrowserRawBundle["actions"],
  pageFingerprintSha256: string,
): void {
  const visualActions = actions.filter((action) =>
    action.kind === BROWSER_VISUAL_SAFETY_ACTION_KIND
  );
  if (visualActions.length === 0) {
    throw new Error("browser visual safety proof is missing");
  }
  const [intent, completed] = visualActions;
  const expectedTarget = browserVisualSafetyTarget(pageFingerprintSha256);
  if (visualActions.length !== 2
    || intent?.outcome !== "intent"
    || completed?.outcome !== "completed"
    || intent.id !== completed.id
    || !isCanonicalBrowserActionId(intent.id)
    || intent.target !== expectedTarget
    || completed.target !== expectedTarget) {
    throw new Error("browser visual safety proof is invalid");
  }
}

export function assertPersistableRawBundle(bundle: BrowserRawBundle): void {
  assertBrowserCaptureSafe(bundle);
}

type FoldedText = {
  text: string;
  originalStarts: number[];
  originalEnds: number[];
};

function foldWithOriginalOffsets(value: string): FoldedText {
  let text = "";
  const originalStarts: number[] = [];
  const originalEnds: number[] = [];
  for (let originalStart = 0; originalStart < value.length;) {
    const codePoint = value.codePointAt(originalStart);
    if (codePoint === undefined) break;
    const original = String.fromCodePoint(codePoint);
    const originalEnd = originalStart + original.length;
    const folded = original.toLocaleLowerCase("en-US");
    text += folded;
    for (let offset = 0; offset < folded.length; offset += 1) {
      originalStarts.push(originalStart);
      originalEnds.push(originalEnd);
    }
    originalStart = originalEnd;
  }
  return { text, originalStarts, originalEnds };
}

function originalMatchRanges(value: string, term: string): Array<{ start: number; end: number }> {
  const haystack = foldWithOriginalOffsets(value);
  const needle = foldWithOriginalOffsets(term).text;
  if (needle === "") return [];
  const ranges: Array<{ start: number; end: number }> = [];
  let searchFrom = 0;
  let index = haystack.text.indexOf(needle, searchFrom);
  while (index >= 0) {
    const lastFoldedOffset = index + needle.length - 1;
    const start = haystack.originalStarts[index];
    const end = haystack.originalEnds[lastFoldedOffset];
    if (start !== undefined && end !== undefined) ranges.push({ start, end });
    searchFrom = index + needle.length;
    index = haystack.text.indexOf(needle, searchFrom);
  }
  return ranges;
}

export async function sanitizePageDom(
  page: Page,
  sensitiveQueryParameters: readonly string[],
  redactLabeledValues: readonly string[],
  redactionValues: readonly string[],
): Promise<Uint8Array> {
  return (await preparePageArtifacts(page, {
    sensitiveNames: sensitiveQueryParameters, redactLabels: redactLabeledValues,
    redactValues: redactionValues, addOverlays: false,
  })).sanitizedDomUtf8;
}

export type PreparedPageCapture = {
  sanitizedDomUtf8: Uint8Array;
  overlayCounts: Record<string, number>;
};

export function preparePageCapture(
  page: Page,
  sensitiveQueryParameters: readonly string[],
  redactLabeledValues: readonly string[],
  redactionValues: readonly string[],
): Promise<PreparedPageCapture> {
  return preparePageArtifacts(page, {
    sensitiveNames: sensitiveQueryParameters, redactLabels: redactLabeledValues,
    redactValues: redactionValues, addOverlays: false,
  });
}

export function assertSanitizedPageDomSafe(
  sanitizedDomUtf8: Uint8Array,
  sensitiveFormFieldNames: readonly string[],
  sensitiveValues: readonly string[],
): void {
  const dom = new TextDecoder("utf-8", { fatal: true }).decode(sanitizedDomUtf8);
  assertNoContactOrSecret(dom, sensitiveValues);
  assertSerializedBrowserDomSafe(dom, "list-org-browser", sensitiveFormFieldNames);
}

function preparePageArtifacts(
  page: Page,
  options: {
    sensitiveNames: readonly string[];
    redactLabels: readonly string[];
    redactValues: readonly string[];
    addOverlays: boolean;
  },
): Promise<PreparedPageCapture> {
  return page.evaluate(({
    sensitiveNames,
    redactLabels,
    redactValues,
    safeTags,
    safeAttributes,
    genericSensitiveNamePatternSource,
    emailPatternSource,
    phonePatternSource,
    addOverlays,
  }) => {
    type FoldedText = { text: string; originalStarts: number[]; originalEnds: number[] };
    type RenderedTextEntry = { node: Text; start: number; end: number; rects: DOMRect[] };
    type RenderedTextSegment = { root: HTMLElement; text: string; entries: RenderedTextEntry[] };
    type RenderedOccurrence = { first: RenderedTextEntry; last: RenderedTextEntry; container: HTMLElement; crossNode: boolean };
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const allowedTags = new Set<string>(safeTags);
    const allowedAttributes = new Set<string>(safeAttributes);
    const sensitive = new Set(sensitiveNames.map((name) => name.toLowerCase()));
    const genericSensitiveNamePattern = new RegExp(genericSensitiveNamePatternSource, "iu");
    const genericContactPatterns = [
      new RegExp(emailPatternSource, "giu"),
      new RegExp(phonePatternSource, "gu"),
    ];
    const terms = [...new Set(redactValues.filter((value) => value !== ""))]
      .sort((left, right) => right.length - left.length);
    // Object methods survive tsx/esbuild keepNames serialization without an
    // injected Node-only __name helper inside Playwright's page context.
    const browserHelpers = {
      foldWithOriginalOffsets(value: string): FoldedText {
      let text = "";
      const originalStarts: number[] = [];
      const originalEnds: number[] = [];
      for (let originalStart = 0; originalStart < value.length;) {
        const codePoint = value.codePointAt(originalStart);
        if (codePoint === undefined) break;
        const original = String.fromCodePoint(codePoint);
        const originalEnd = originalStart + original.length;
        const folded = original.toLocaleLowerCase("en-US");
        text += folded;
        for (let offset = 0; offset < folded.length; offset += 1) {
          originalStarts.push(originalStart);
          originalEnds.push(originalEnd);
        }
        originalStart = originalEnd;
      }
      return { text, originalStarts, originalEnds };
      },
      originalMatchRanges(value: string, term: string): Array<{ start: number; end: number }> {
      const haystack = browserHelpers.foldWithOriginalOffsets(value);
      const needle = browserHelpers.foldWithOriginalOffsets(term).text;
      if (needle === "") return [];
      const ranges: Array<{ start: number; end: number }> = [];
      let searchFrom = 0;
      let index = haystack.text.indexOf(needle, searchFrom);
      while (index >= 0) {
        const lastFoldedOffset = index + needle.length - 1;
        const start = haystack.originalStarts[index];
        const end = haystack.originalEnds[lastFoldedOffset];
        if (start !== undefined && end !== undefined) ranges.push({ start, end });
        searchFrom = index + needle.length;
        index = haystack.text.indexOf(needle, searchFrom);
      }
      return ranges;
      },
      renderedRects(node: Text): DOMRect[] {
      for (let element = node.parentElement; element !== null; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden"
          || style.visibility === "collapse" || style.contentVisibility === "hidden"
          || Number(style.opacity) === 0) return [];
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      },
      flowRoot(node: Text): HTMLElement {
      for (let element = node.parentElement; element !== null; element = element.parentElement) {
        const style = getComputedStyle(element);
        if ((style.display !== "inline" && style.display !== "contents")
          || style.position === "absolute" || style.position === "fixed") return element;
      }
      return document.body;
      },
      hasLayoutBoundary(previous: RenderedTextEntry, next: Text, nextRects: DOMRect[]): boolean {
      const range = document.createRange();
      range.setStartAfter(previous.node);
      range.setEndBefore(next);
      if (range.cloneContents().querySelector("br, hr") !== null) return true;
      const left = previous.rects[previous.rects.length - 1]!;
      const right = nextRects[0]!;
      if (Math.abs(left.top - right.top) <= 4 && right.left - left.right > 2) return true;
      return right.top - left.bottom > 4;
      },
      smallestCommonContainer(first: Text, last: Text): HTMLElement {
      const ancestors = new Set<HTMLElement>();
      for (let element = first.parentElement; element !== null; element = element.parentElement) ancestors.add(element);
      for (let element = last.parentElement; element !== null; element = element.parentElement) {
        if (!ancestors.has(element)) continue;
        if (element === document.body && (first.parentElement !== document.body || last.parentElement !== document.body)) {
          throw new Error("rendered sensitive range mapping failed");
        }
        return element;
      }
      throw new Error("rendered sensitive range mapping failed");
      },
      collectRenderedOccurrences(): RenderedOccurrence[] {
      const segments: RenderedTextSegment[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let segment: RenderedTextSegment | undefined;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const rects = browserHelpers.renderedRects(node);
        if (rects.length === 0) continue;
        const root = browserHelpers.flowRoot(node);
        const previous = segment?.entries[segment.entries.length - 1];
        if (segment === undefined || segment.root !== root
          || (previous !== undefined && browserHelpers.hasLayoutBoundary(previous, node, rects))) {
          segment = { root, text: "", entries: [] };
          segments.push(segment);
        }
        const start = segment.text.length;
        segment.text += node.data;
        segment.entries.push({ node, start, end: segment.text.length, rects });
      }
      const occurrences: RenderedOccurrence[] = [];
      for (const current of segments) {
        const ranges = terms.flatMap((term) => browserHelpers.originalMatchRanges(current.text, term));
        for (const pattern of genericContactPatterns) {
          pattern.lastIndex = 0;
          for (const match of current.text.matchAll(pattern)) {
            if (match.index !== undefined) ranges.push({ start: match.index, end: match.index + match[0].length });
          }
        }
        for (const range of ranges) {
          const first = current.entries.find((entry) => entry.start <= range.start && entry.end > range.start);
          const last = current.entries.find((entry) => entry.start < range.end && entry.end >= range.end);
          if (first === undefined || last === undefined) throw new Error("rendered sensitive range mapping failed");
          occurrences.push({ first, last, container: browserHelpers.smallestCommonContainer(first.node, last.node), crossNode: first.node !== last.node });
        }
      }
      return occurrences;
      },
      containsSensitive(value: string): boolean {
        return terms.some((term) => browserHelpers.originalMatchRanges(value, term).length > 0)
          || /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/iu.test(value)
          || /(?:\+?7|8)[\s().-]*(?:\d[\s().-]*){10}/u.test(value);
      },
    };
    const occurrences = browserHelpers.collectRenderedOccurrences();
    const liveElements = [...document.querySelectorAll("*")];
    const cloneElements = [clone, ...clone.querySelectorAll("*")];
    const elementIndexes = new Map<Element, number>(liveElements.map((element, index) => [element, index]));
    const crossNodeContainers = new Set(occurrences.filter((item) => item.crossNode).map((item) => item.container));
    for (const container of [...crossNodeContainers]) {
      if ([...crossNodeContainers].some((other) => other !== container && other.contains(container))) crossNodeContainers.delete(container);
    }
    for (const container of crossNodeContainers) {
      const cloneContainer = cloneElements[elementIndexes.get(container) ?? -1];
      if (cloneContainer === undefined) throw new Error("rendered sensitive range mapping failed");
      cloneContainer.replaceChildren(document.createTextNode("[REDACTED]"));
    }
    const helpers = {
      isSensitiveFormFieldName(name: string): boolean {
        return sensitive.has(name.toLocaleLowerCase("en-US"))
          || genericSensitiveNamePattern.test(name);
      },
      redact(value: string): string {
        let output = value;
        for (const term of terms) {
          for (const { start, end } of browserHelpers.originalMatchRanges(output, term).reverse()) {
            output = `${output.slice(0, start)}[REDACTED]${output.slice(end)}`;
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
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              element.removeAttribute(attribute.name);
              continue;
            }
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
    const counts: Record<string, number> = {};
    const overlayElements = new Set<HTMLElement>();
    for (const label of redactLabels) {
      counts[label] = 0;
      for (const term of [...document.querySelectorAll("dt")].filter((candidate) => candidate.textContent?.trim() === label)) {
        const value = term.nextElementSibling;
        if (value instanceof HTMLElement) { overlayElements.add(value); counts[label] += 1; }
      }
    }
    for (const occurrence of occurrences) overlayElements.add(occurrence.container);
    for (const candidate of document.querySelectorAll("*")) {
      if (!(candidate instanceof HTMLElement)) continue;
      if (candidate === document.documentElement) continue;
      if (candidate === document.body) {
        const hasDirectRenderedSensitiveText = [...candidate.childNodes]
          .filter((node): node is Text => node.nodeType === Node.TEXT_NODE)
          .some((node) => browserHelpers.renderedRects(node).length > 0
            && browserHelpers.containsSensitive(node.data));
        if (hasDirectRenderedSensitiveText) overlayElements.add(candidate);
        continue;
      }
      const directText = [...candidate.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? "").join(" ");
      const attributes = [...candidate.attributes].map((attribute) => attribute.value).join(" ");
      if (browserHelpers.containsSensitive(`${directText} ${attributes}`)) overlayElements.add(candidate);
    }
    for (const control of document.querySelectorAll("input, textarea, select, button")) {
      if ((control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement)
        && (control.value !== "" || (control instanceof HTMLInputElement && control.type.toLowerCase() === "password") || helpers.isSensitiveFormFieldName(control.name))) overlayElements.add(control);
    }
    if (addOverlays) for (const value of overlayElements) {
      const rect = value.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const overlay = document.createElement("div");
      overlay.dataset.browserCaptureRedaction = "true";
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, { position: "absolute", left: `${rect.left + window.scrollX}px`, top: `${rect.top + window.scrollY}px`, width: `${Math.max(rect.width, 1)}px`, height: `${Math.max(rect.height, 1)}px`, background: "#000", zIndex: "2147483647" });
      document.body.append(overlay);
    }
    return { sanitizedDomUtf8: new TextEncoder().encode(`<!doctype html>\n${clone.outerHTML}`), overlayCounts: counts };
  }, {
    sensitiveNames: options.sensitiveNames,
    redactLabels: options.redactLabels,
    redactValues: options.redactValues,
    safeTags: SAFE_CAPTURE_TAGS,
    safeAttributes: SAFE_CAPTURE_ATTRIBUTES,
    genericSensitiveNamePatternSource: GENERIC_SENSITIVE_NAME_PATTERN_SOURCE,
    emailPatternSource: EMAIL_PATTERN.source,
    phonePatternSource: PHONE_PATTERN.source,
    addOverlays: options.addOverlays,
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
  allowRelative: boolean,
): void {
  let url: URL;
  try {
    url = allowRelative
      ? new URL(value, "https://browser-evidence.invalid")
      : new URL(value);
  } catch {
    throw new Error("raw redaction scan failed");
  }
  if (!isHttpProtocol(url) || url.hash !== "" || url.username !== "" || url.password !== ""
    || [...url.searchParams.keys()].some((name) =>
    isSensitiveFormFieldName(name, sensitiveNames)
  )) {
    throw new Error("raw redaction scan failed");
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function assertHttpProtocol(url: URL): void {
  if (!isHttpProtocol(url)) throw new Error("retained browser URL protocol is not allowed");
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
  if (browserEvidenceSourceProfile(sourceKind) === undefined) return;
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
    if (value === null) return true;
    try {
      assertRetainedBrowserUrlSafe(value, sensitiveFormFieldNames, true);
    } catch {
      return true;
    }
  }
  return assignments !== values;
}

function decodeHtmlUrlAttribute(value: string): string | null {
  const canonicalEntity = /&(?:amp|quot|apos|#(?:[xX][0-9a-fA-F]+|[0-9]+));/gu;
  if (value.replace(canonicalEntity, "").includes("&")) return null;

  let invalidNumericReference = false;
  const decoded = value.replace(canonicalEntity, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return "\"";
    if (entity === "&apos;") return "'";
    const hexadecimal = entity.startsWith("&#x") || entity.startsWith("&#X");
    const numeric = Number.parseInt(
      entity.slice(hexadecimal ? 3 : 2, -1),
      hexadecimal ? 16 : 10,
    );
    if (!Number.isInteger(numeric)
      || numeric < 0
      || numeric > 0x10ffff
      || (numeric >= 0xd800 && numeric <= 0xdfff)) {
      invalidNumericReference = true;
      return "";
    }
    return String.fromCodePoint(numeric);
  });
  return invalidNumericReference ? null : decoded;
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
  for (const { start, end } of originalMatchRanges(output, term).reverse()) {
    output = `${output.slice(0, start)}${replacement}${output.slice(end)}`;
  }
  return output;
}
