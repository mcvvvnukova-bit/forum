import type { BrowserRawBundle } from "../../domain/discovery";

export interface BrowserSession {
  navigate(url: string): Promise<number | null>;
  fillField(label: string, value: string): Promise<void>;
  setCheckbox(label: string, checked: boolean): Promise<void>;
  clickButton(name: string): Promise<void>;
  clickLink(name: string): Promise<void>;
  waitForLandmark(name: string): Promise<void>;
  hasLandmark(name: string): Promise<boolean>;
  hasVisibleText(text: string): Promise<boolean>;
  readLabeledText(label: string): Promise<string>;
  linkNamesInLandmark(name: string, accessibleNamePrefix: string): Promise<readonly string[]>;
  fingerprint(): Promise<string>;
  capture(
    identity: BrowserRawBundle["identity"],
    redactLabeledValues?: readonly string[],
  ): Promise<BrowserRawBundle>;
  close(): Promise<void>;
}

export interface BrowserSessionFactory {
  open(): Promise<BrowserSession>;
}
