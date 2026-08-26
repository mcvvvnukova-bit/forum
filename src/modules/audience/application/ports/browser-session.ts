import type {
  BrowserRawBundle,
  DiscoveryExecutionContext,
} from "../../domain/discovery";

export interface BrowserSession {
  navigate(url: string): Promise<number | null>;
  fillField(label: string, value: string): Promise<void>;
  setCheckbox(label: string, checked: boolean): Promise<void>;
  clickButton(name: string): Promise<number | null>;
  clickLink(name: string): Promise<number | null>;
  clickLinkHref(href: string): Promise<number | null>;
  waitForLandmark(name: string): Promise<void>;
  hasLandmark(name: string): Promise<boolean>;
  hasVisibleText(text: string): Promise<boolean>;
  readLabeledText(label: string): Promise<string>;
  readLabeledTexts(label: string): Promise<readonly string[]>;
  readFirstLabeledText(label: string): Promise<string>;
  linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]>;
  linkHrefsInLandmark(name: string): Promise<readonly string[]>;
  currentUrl(): Promise<string>;
  currentNavigationStatus(): Promise<number | null>;
  recordCaptchaWaiting(target: string): Promise<void>;
  fingerprint(): Promise<string>;
  captureProjection(
    selectors: readonly string[],
    table?: BrowserVisibleTableProjection,
  ): Promise<BrowserCaptureProjection>;
  policyViolations(): Promise<readonly BrowserPolicyViolation[]>;
  capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues?: readonly string[],
  ): Promise<BrowserRawBundle>;
  captureBlocker(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    acknowledgePolicyViolationOrigins?: readonly string[],
  ): Promise<BrowserRawBundle>;
  acknowledgePolicyBlock(
    acknowledgePolicyViolationOrigins: readonly string[],
  ): Promise<BrowserPolicyBlockState>;
  close(): Promise<void>;
}

export interface BrowserPolicyBlockState {
  readonly finalUrl: string;
  readonly navigationStatus: number | null;
}

export interface BrowserOriginPolicy {
  readonly allowedOrigins: readonly string[];
  readonly allowedNavigationUrls: readonly BrowserUrlContract[];
  readonly allowedDownloadUrls?: readonly BrowserUrlContract[];
  /** @deprecated An origin alone never authorizes a download; use allowedDownloadUrls. */
  readonly allowedDownloadOrigins?: readonly string[];
  readonly allowInsecureHttpForTesting?: boolean;
}

export type BrowserUrlContract = string | BrowserUrlPattern;

export interface BrowserUrlPattern {
  readonly origin: string;
  /** Exact pathname, or one trailing `*` for an auditable subtree match. */
  readonly pathname: string;
}

export interface BrowserCaptureProjection {
  readonly selectors: readonly string[];
  readonly sanitizedDomUtf8: Uint8Array;
  readonly sensitiveFormFieldNames: readonly string[];
}

export const COMPLETE_VISIBLE_TABLE_PROJECTION_MARKER =
  "visible-table-projection/1:complete";
export const REDACTED_VISIBLE_TABLE_CELL = "projection-redacted";

export interface BrowserVisibleTableProjection {
  readonly scopeIdentity: string;
  readonly selector: string;
  readonly expectedColumnCount: number;
  readonly matchColumnIndex: number;
  readonly matchText: string;
  readonly retainedMatchColumnIndexes: readonly number[];
  readonly retainedOtherColumnIndexes: readonly number[];
}

export interface BrowserPolicyViolation {
  readonly disposition: "terminal" | "passive";
  readonly resourceType:
    | "document"
    | "script"
    | "xhr"
    | "websocket"
    | "service-worker"
    | "popup"
    | "download"
    | "image"
    | "font"
    | "stylesheet"
    | "subframe";
  readonly origin: string;
}

export interface BrowserSessionFactory {
  open(execution?: DiscoveryExecutionContext): Promise<BrowserSession>;
}

export interface PolicyBrowserSessionFactory extends BrowserSessionFactory {
  readonly policy: BrowserOriginPolicy;
}
