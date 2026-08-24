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
  waitForLandmark(name: string): Promise<void>;
  hasLandmark(name: string): Promise<boolean>;
  hasVisibleText(text: string): Promise<boolean>;
  readLabeledText(label: string): Promise<string>;
  readLabeledTexts(label: string): Promise<readonly string[]>;
  readFirstLabeledText(label: string): Promise<string>;
  linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]>;
  fingerprint(): Promise<string>;
  capture(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
    redactLabeledValues?: readonly string[],
  ): Promise<BrowserRawBundle>;
  captureBlocker(
    identity: BrowserRawBundle["identity"],
    parserVersion: string,
  ): Promise<BrowserRawBundle>;
  close(): Promise<void>;
}

export interface BrowserSessionFactory {
  open(execution?: DiscoveryExecutionContext): Promise<BrowserSession>;
}
