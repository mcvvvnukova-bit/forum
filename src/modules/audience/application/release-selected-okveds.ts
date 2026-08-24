import { createHash } from "node:crypto";

export interface ImmutableObjectStorage {
  putImmutable(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface OkvedReleaseRecord {
  releaseId: string;
  reused: boolean;
}

export interface OkvedReleaseRepository {
  ensureRelease(input: {
    sourceVersion: string;
    objectKey: string;
    checksumSha256: string;
    capturedAt: string;
  }): Promise<OkvedReleaseRecord>;
}

export interface ReleaseSelectedOkvedOptions {
  sourceVersion: string;
  now?: () => Date;
}

export interface ReleaseSelectedOkvedDependencies {
  storage: ImmutableObjectStorage;
  repository: OkvedReleaseRepository;
}

export interface ReleasedSelectedOkvedDataset extends OkvedReleaseRecord {
  objectKey: string;
  checksumSha256: string;
}

export async function releaseSelectedOkvedDataset(
  bytes: Uint8Array,
  options: ReleaseSelectedOkvedOptions,
  dependencies: ReleaseSelectedOkvedDependencies,
): Promise<ReleasedSelectedOkvedDataset> {
  if (bytes.byteLength === 0) throw new Error("selected OKVED dataset is empty");
  if (options.sourceVersion.trim() === "") throw new Error("OKVED source version is required");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const objectKey = `raw/okved-csv/${checksumSha256}/selected-okveds.csv`;
  await dependencies.storage.putImmutable(objectKey, bytes, "text/csv; charset=utf-8");
  const release = await dependencies.repository.ensureRelease({
    sourceVersion: options.sourceVersion,
    objectKey,
    checksumSha256,
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
  });
  return { ...release, objectKey, checksumSha256 };
}
