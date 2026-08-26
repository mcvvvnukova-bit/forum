import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DATASET_ID = "7707329152-revexp";
const REPORT_YEAR = 2025;
const MAX_REDIRECTS = 5;
const MAX_ATTEMPTS = 3;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
export const REVEXP_MAX_COMPRESSED_BYTES = 256 * 1024 * 1024;

const OFFICIAL_HOSTS = new Set([
  "nalog.gov.ru",
  "www.nalog.gov.ru",
  "file.nalog.ru",
]);

export interface RevexpTransportRequest {
  url: string;
  method: "GET" | "HEAD";
}

export interface RevexpTransportResponse {
  url: string;
  status: number;
  headers: Readonly<Record<string, string>>;
  capturedAt: string;
  body?: AsyncIterable<Uint8Array>;
}

export interface RevexpTransport {
  /** Explicit test-only escape hatch. Only loopback HTTP(S) origins are accepted. */
  readonly testPolicy?: { readonly allowedOrigins: readonly string[] };
  request(input: RevexpTransportRequest): Promise<RevexpTransportResponse>;
}

export interface RevexpCaptureMetadata {
  finalUrl: string;
  status: number;
  capturedAt: string;
  contentType: string;
  contentLength: number;
  redirectChain: readonly string[];
}

export interface RevexpRelease {
  datasetId: typeof DATASET_ID;
  reportYear: typeof REPORT_YEAR;
  structureVersion: string;
  xsdUrl: string;
  publishedAt: string;
  updatedAt: string;
  metadataUrl: string;
  finalArchiveUrl: string;
  contentType: string;
  contentLength: number;
  etag: string | null;
  lastModified: string | null;
  capture: {
    metadata: RevexpCaptureMetadata;
    archive: RevexpCaptureMetadata;
  };
}

export interface DownloadedRevexpArchive {
  filePath: string;
  byteLength: number;
  dataChecksumSha256: string;
  openStream(): AsyncIterable<Uint8Array>;
  cleanup(): Promise<void>;
  finalUrl: string;
  status: number;
  capturedAt: string;
  contentType: string;
  contentLength: number;
  etag: string | null;
  lastModified: string | null;
}

export async function resolveRevexpRelease(
  metadataUrl: string,
  transport: RevexpTransport,
): Promise<RevexpRelease> {
  const policy = transportPolicy(transport);
  const canonicalMetadataUrl = assertDatasetUrl(metadataUrl, policy, "metadata");
  const metadataResult = await followRedirects(canonicalMetadataUrl, "GET", transport, policy);
  assertDatasetUrl(metadataResult.response.url, policy, "metadata");
  const metadataHeaders = normalizeHeaders(metadataResult.response.headers);
  const metadataContentType = requiredHeader(metadataHeaders, "content-type", "metadata content type");
  if (!/^text\/html(?:\s*;|$)/iu.test(metadataContentType)) {
    throw new Error("revexp metadata content type must be text/html");
  }
  const metadataBytes = await readBoundedBody(
    metadataResult.response.body,
    MAX_METADATA_BYTES,
    "revexp metadata",
  );
  const declaredMetadataLength = optionalLength(metadataHeaders["content-length"], "metadata content length");
  if (declaredMetadataLength !== null && declaredMetadataLength !== metadataBytes.byteLength) {
    throw new Error("revexp metadata content length does not match received bytes");
  }
  const metadata = parseReleaseMetadata(metadataBytes, metadataResult.response.url, policy);
  const archiveResult = await followRedirects(metadata.archiveUrl, "HEAD", transport, policy);
  if (policy.kind === "official" && new URL(archiveResult.response.url).hostname !== "file.nalog.ru") {
    throw new Error("revexp final archive host must be file.nalog.ru");
  }
  const archiveHeaders = normalizeHeaders(archiveResult.response.headers);
  const contentType = requiredHeader(archiveHeaders, "content-type", "archive content type");
  assertZipContentType(contentType);
  const contentLength = requiredLength(archiveHeaders["content-length"], "archive content length");
  if (contentLength > REVEXP_MAX_COMPRESSED_BYTES) {
    throw new Error("revexp archive exceeds the 256 MiB compressed-byte ceiling");
  }
  const lastModified = optionalHttpDate(archiveHeaders["last-modified"], "archive last-modified");

  return {
    datasetId: DATASET_ID,
    reportYear: REPORT_YEAR,
    structureVersion: metadata.structureVersion,
    xsdUrl: metadata.xsdUrl,
    publishedAt: metadata.publishedAt,
    updatedAt: metadata.updatedAt,
    metadataUrl: canonicalMetadataUrl,
    finalArchiveUrl: archiveResult.response.url,
    contentType,
    contentLength,
    etag: archiveHeaders.etag ?? null,
    lastModified,
    capture: {
      metadata: captureMetadata(
        metadataResult,
        metadataContentType,
        metadataBytes.byteLength,
      ),
      archive: captureMetadata(archiveResult, contentType, contentLength),
    },
  };
}

export async function downloadRevexpArchive(
  release: RevexpRelease,
  transport: RevexpTransport,
): Promise<DownloadedRevexpArchive> {
  if (release.datasetId !== DATASET_ID || release.reportYear !== REPORT_YEAR) {
    throw new Error("revexp release identity is invalid");
  }
  const policy = transportPolicy(transport);
  const expectedUrl = assertDatasetUrl(release.finalArchiveUrl, policy, "archive");
  if (!Number.isSafeInteger(release.contentLength)
    || release.contentLength <= 0
    || release.contentLength > REVEXP_MAX_COMPRESSED_BYTES) {
    throw new Error("revexp archive content length is invalid");
  }
  assertZipContentType(release.contentType);
  const result = await followRedirects(expectedUrl, "GET", transport, policy);
  if (result.response.url !== expectedUrl || result.redirectChain.length !== 1) {
    throw new Error("revexp archive URL changed after validated resolution");
  }
  const headers = normalizeHeaders(result.response.headers);
  const contentType = requiredHeader(headers, "content-type", "archive content type");
  assertZipContentType(contentType);
  if (baseContentType(contentType) !== baseContentType(release.contentType)) {
    throw new Error("revexp archive content type changed after validated resolution");
  }
  const contentLength = requiredLength(headers["content-length"], "archive content length");
  if (contentLength !== release.contentLength) {
    throw new Error("revexp archive content length changed after validated resolution");
  }
  if (release.etag !== null && headers.etag !== release.etag) {
    throw new Error("revexp archive ETag changed after validated resolution");
  }
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "okved-revexp-"));
  const filePath = join(temporaryDirectory, "archive.zip");
  const handle = await open(filePath, "wx", 0o600);
  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(temporaryDirectory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    cleaned = true;
  };
  try {
    const body = result.response.body;
    if (body === undefined) throw new Error("revexp archive response body is missing");
    const digest = createHash("sha256");
    const signature: number[] = [];
    let byteLength = 0;
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("revexp archive response body is invalid");
      }
      byteLength += chunk.byteLength;
      if (byteLength > REVEXP_MAX_COMPRESSED_BYTES || byteLength > contentLength) {
        throw new Error("revexp archive exceeds its compressed-byte ceiling");
      }
      for (let index = 0; index < chunk.byteLength && signature.length < 2; index += 1) {
        signature.push(chunk[index]!);
      }
      digest.update(chunk);
      let written = 0;
      while (written < chunk.byteLength) {
        const result = await handle.write(chunk, written, chunk.byteLength - written);
        if (result.bytesWritten <= 0) throw new Error("revexp archive temporary write stalled");
        written += result.bytesWritten;
      }
    }
    await handle.sync();
    await handle.close();
    if (byteLength !== contentLength) {
      throw new Error("revexp archive content length does not match received bytes");
    }
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error("revexp archive is not a ZIP file");
    }
    return {
      filePath,
      byteLength,
      dataChecksumSha256: digest.digest("hex"),
      openStream: () => createReadStream(filePath, { highWaterMark: 64 }),
      cleanup,
      finalUrl: result.response.url,
      status: result.response.status,
      capturedAt: canonicalTimestamp(result.response.capturedAt, "archive capture timestamp"),
      contentType,
      contentLength,
      etag: headers.etag ?? null,
      lastModified: optionalHttpDate(headers["last-modified"], "archive last-modified"),
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await cleanup();
    throw error;
  }
}

type TransportPolicy =
  | { kind: "official" }
  | { kind: "test"; allowedOrigins: ReadonlySet<string> };

interface FollowResult {
  response: RevexpTransportResponse;
  redirectChain: string[];
}

function transportPolicy(transport: RevexpTransport): TransportPolicy {
  if (transport.testPolicy === undefined) return { kind: "official" };
  if (transport.testPolicy.allowedOrigins.length === 0) {
    throw new Error("revexp test transport must declare at least one loopback origin");
  }
  const origins = new Set<string>();
  for (const candidate of transport.testPolicy.allowedOrigins) {
    const url = new URL(candidate);
    if ((url.protocol !== "http:" && url.protocol !== "https:")
      || !isLoopbackHostname(url.hostname)
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== "") {
      throw new Error("revexp test transport origins must be explicit loopback origins");
    }
    origins.add(url.origin);
  }
  return { kind: "test", allowedOrigins: origins };
}

function assertDatasetUrl(input: string, policy: TransportPolicy, role: "metadata" | "archive" | "xsd"): string {
  let url: URL;
  try { url = new URL(input); } catch {
    throw new Error(`revexp ${role} URL is invalid`);
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`revexp ${role} URL contains forbidden credentials, query, or fragment`);
  }
  if (!url.pathname.includes(`/opendata/${DATASET_ID}/`) && role !== "archive") {
    throw new Error(`revexp ${role} URL has the wrong dataset identity`);
  }
  if (role === "archive" && !url.pathname.toLowerCase().endsWith(".zip")) {
    throw new Error("revexp archive URL must identify a ZIP file");
  }
  assertAllowedUrl(url, policy);
  return url.href;
}

function assertAllowedUrl(url: URL, policy: TransportPolicy): void {
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error("revexp URL contains forbidden credentials, query, or fragment");
  }
  if (policy.kind === "test") {
    if (!policy.allowedOrigins.has(url.origin)) {
      throw new Error("revexp URL host is outside the injected test origin policy");
    }
    return;
  }
  if (url.protocol !== "https:") throw new Error("revexp official requests must use HTTPS");
  if (url.port !== "" || !OFFICIAL_HOSTS.has(url.hostname)) {
    throw new Error("revexp URL host is outside the official allowlist");
  }
}

async function followRedirects(
  initialUrl: string,
  method: "GET" | "HEAD",
  transport: RevexpTransport,
  policy: TransportPolicy,
): Promise<FollowResult> {
  let current = initialUrl;
  const redirectChain: string[] = [];
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const canonical = new URL(current).href;
    assertAllowedUrl(new URL(canonical), policy);
    redirectChain.push(canonical);
    const response = await requestWithRetries({ url: canonical, method }, transport);
    const responseUrl = new URL(response.url).href;
    if (responseUrl !== canonical) {
      throw new Error("revexp transport followed an unaudited redirect");
    }
    canonicalTimestamp(response.capturedAt, "capture timestamp");
    if (isRedirect(response.status)) {
      const location = normalizeHeaders(response.headers).location;
      if (location === undefined || location.trim() === "") {
        throw new Error("revexp redirect is missing Location");
      }
      if (redirects === MAX_REDIRECTS) throw new Error("revexp redirect limit exceeded");
      current = new URL(location, canonical).href;
      assertAllowedUrl(new URL(current), policy);
      continue;
    }
    if (response.status !== 200) throw new Error(`revexp request failed with HTTP ${response.status}`);
    return { response: { ...response, url: responseUrl }, redirectChain };
  }
  throw new Error("revexp redirect limit exceeded");
}

async function requestWithRetries(
  input: RevexpTransportRequest,
  transport: RevexpTransport,
): Promise<RevexpTransportResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await transport.request(input);
      if (response.status < 500 || response.status > 599 || attempt === MAX_ATTEMPTS) return response;
      await drainRetryBody(response.body);
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
  }
  throw new Error(`revexp transport failed after ${MAX_ATTEMPTS} attempts: ${errorMessage(lastError)}`);
}

async function drainRetryBody(body: AsyncIterable<Uint8Array> | undefined): Promise<void> {
  if (body === undefined) return;
  let bytes = 0;
  for await (const chunk of body) {
    bytes += chunk.byteLength;
    if (bytes > 64 * 1024) throw new Error("revexp retry response body is too large");
  }
}

function parseReleaseMetadata(
  bytes: Uint8Array,
  baseUrl: string,
  policy: TransportPolicy,
): {
  structureVersion: string;
  xsdUrl: string;
  publishedAt: string;
  updatedAt: string;
  archiveUrl: string;
} {
  let html: string;
  try { html = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    throw new Error("revexp metadata is not valid UTF-8");
  }
  const labels = definitionList(html);
  if (labels.get("Идентификатор набора данных") !== DATASET_ID) {
    throw new Error("revexp metadata has the wrong dataset identity");
  }
  if (labels.get("Отчетный год") !== String(REPORT_YEAR)) {
    throw new Error("revexp metadata must explicitly identify report year 2025");
  }
  const structureVersion = labels.get("Версия структуры");
  if (structureVersion === undefined || !/^[1-9][0-9]*(?:\.[0-9]+)+$/u.test(structureVersion)) {
    throw new Error("revexp metadata structure version is missing or invalid");
  }
  const links = htmlLinks(html, baseUrl);
  const archiveLinks = links.filter((url) => new URL(url).pathname.toLowerCase().endsWith(".zip"));
  if (archiveLinks.length !== 1) throw new Error("revexp metadata must contain exactly one archive link");
  const xsdLinks = links.filter((url) => new URL(url).pathname.toLowerCase().endsWith(".xsd"));
  if (xsdLinks.length !== 1) throw new Error("revexp metadata must contain exactly one XSD link");
  const archiveUrl = assertDatasetUrl(archiveLinks[0]!, policy, "archive");
  const xsdUrl = assertDatasetUrl(xsdLinks[0]!, policy, "xsd");
  const versionPattern = new RegExp(`(?:^|[^0-9])${escapeRegExp(structureVersion)}(?:[^0-9]|$)`, "u");
  if (!versionPattern.test(new URL(xsdUrl).pathname)) {
    throw new Error("revexp metadata XSD version does not match the declared structure version");
  }

  return {
    structureVersion,
    xsdUrl,
    publishedAt: metadataDate(labels.get("Дата публикации"), "publication"),
    updatedAt: metadataDate(labels.get("Дата обновления"), "update"),
    archiveUrl,
  };
}

function definitionList(html: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const match of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/giu)) {
    const label = htmlText(match[1] ?? "");
    const value = htmlText(match[2] ?? "");
    if (label !== "") {
      if (values.has(label)) throw new Error(`revexp metadata label is ambiguous: ${label}`);
      values.set(label, value);
    }
  }
  return values;
}

function htmlLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/giu)) {
    const href = decodeHtml(match[1] ?? match[2] ?? "").trim();
    if (href === "") continue;
    try { links.push(new URL(href, baseUrl).href); } catch {
      throw new Error("revexp metadata contains an invalid link");
    }
  }
  return links;
}

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
}

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#[xX][0-9a-fA-F]+);/gu, (entity) => {
    if (entity === "&amp;") return "&";
    if (entity === "&quot;") return '"';
    if (entity === "&apos;") return "'";
    if (entity === "&lt;") return "<";
    if (entity === "&gt;") return ">";
    if (entity === "&nbsp;") return " ";
    const hexadecimal = entity.startsWith("&#x") || entity.startsWith("&#X");
    const parsed = Number.parseInt(entity.slice(hexadecimal ? 3 : 2, -1), hexadecimal ? 16 : 10);
    return Number.isSafeInteger(parsed) ? String.fromCodePoint(parsed) : entity;
  });
}

function captureMetadata(result: FollowResult, contentType: string, contentLength: number): RevexpCaptureMetadata {
  return {
    finalUrl: result.response.url,
    status: result.response.status,
    capturedAt: canonicalTimestamp(result.response.capturedAt, "capture timestamp"),
    contentType,
    contentLength,
    redirectChain: result.redirectChain,
  };
}

async function readBoundedBody(
  body: AsyncIterable<Uint8Array> | undefined,
  maximum: number,
  label: string,
): Promise<Uint8Array> {
  if (body === undefined) throw new Error(`${label} response body is missing`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) continue;
    total += chunk.byteLength;
    if (total > maximum) throw new Error(`${label} exceeds its byte ceiling`);
    chunks.push(chunk);
  }
  if (total === 0) throw new Error(`${label} response body is empty`);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function normalizeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (normalized[key] !== undefined) throw new Error(`revexp response contains duplicate header ${key}`);
    normalized[key] = value.trim();
  }
  return normalized;
}

function requiredHeader(headers: Record<string, string>, name: string, label: string): string {
  const value = headers[name];
  if (value === undefined || value === "") throw new Error(`revexp ${label} is missing`);
  return value;
}

function requiredLength(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) throw new Error(`revexp ${label} is missing or invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`revexp ${label} is missing or invalid`);
  return parsed;
}

function optionalLength(value: string | undefined, label: string): number | null {
  if (value === undefined) return null;
  return requiredLength(value, label);
}

function assertZipContentType(contentType: string): void {
  const base = baseContentType(contentType);
  if (base !== "application/zip" && base !== "application/x-zip-compressed") {
    throw new Error("revexp archive content type must identify a ZIP file");
  }
}

function baseContentType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function metadataDate(value: string | undefined, label: string): string {
  if (value === undefined) {
    throw new Error(`revexp metadata ${label} date is missing or invalid`);
  }
  let isoDate = value;
  const russian = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(value);
  if (russian !== null) isoDate = `${russian[3]}-${russian[2]}-${russian[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) {
    throw new Error(`revexp metadata ${label} date is missing or invalid`);
  }
  return canonicalTimestamp(`${isoDate}T00:00:00.000Z`, `metadata ${label} date`);
}

function optionalHttpDate(value: string | undefined, label: string): string | null {
  if (value === undefined) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`revexp ${label} is invalid`);
  return new Date(timestamp).toISOString();
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`revexp ${label} is invalid`);
  }
  return value;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
