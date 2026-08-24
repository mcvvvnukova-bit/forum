declare const okvedCodeBrand: unique symbol;

export type OkvedCode = string & { readonly [okvedCodeBrand]: true };

const canonicalOkvedCode = /^[0-9]{2}(?:\.[0-9]{1,2}){0,2}$/;

export function parseOkvedCode(value: string): OkvedCode {
  const trimmed = value.trim();

  if (!canonicalOkvedCode.test(trimmed)) {
    throw new Error("OKVED code must use canonical OKVED punctuation");
  }

  return trimmed as OkvedCode;
}
