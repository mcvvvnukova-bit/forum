declare const legalEntityInnBrand: unique symbol;

export type LegalEntityInn = string & { readonly [legalEntityInnBrand]: true };

const checksumCoefficients = [2, 4, 10, 3, 5, 9, 4, 6, 8] as const;

export function parseLegalEntityInn(value: string): LegalEntityInn {
  if (!/^[0-9]{10}$/.test(value)) {
    throw new Error("INN must be a ten-digit legal entity INN");
  }

  const checksum = checksumCoefficients.reduce(
    (sum, coefficient, index) => sum + Number(value[index]) * coefficient,
    0,
  ) % 11 % 10;

  if (checksum !== Number(value[9])) {
    throw new Error("INN checksum is invalid");
  }

  return value as LegalEntityInn;
}
