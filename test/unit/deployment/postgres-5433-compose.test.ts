import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type ComposePort = {
  host_ip?: string;
  published?: string;
  target?: number;
};

type ComposeVolume = {
  source?: string;
  target?: string;
};

type ComposeConfig = {
  services: {
    minio: { ports?: ComposePort[]; volumes?: ComposeVolume[] };
    postgres: { ports?: ComposePort[]; volumes?: ComposeVolume[] };
  };
  volumes?: Record<string, unknown>;
};

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("owned PostgreSQL 5433 Compose overlay", () => {
  it("moves only PostgreSQL to loopback 5433 and preserves the owned data volumes", () => {
    const rendered = execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "compose.yaml",
        "-f",
        "deployment/okved-parser/postgres-5433.compose.yaml",
        "config",
        "--format",
        "json",
      ],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          POSTGRES_USER: "okved",
          POSTGRES_PASSWORD: "test-password",
          POSTGRES_DB: "okved",
          MINIO_ROOT_USER: "okved-local",
          MINIO_ROOT_PASSWORD: "test-secret",
        },
      },
    );
    const config = JSON.parse(rendered) as ComposeConfig;

    expect(config.services.postgres.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "5433", target: 5432 }),
    ]);
    expect(config.services.minio.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", published: "9000", target: 9000 }),
      expect.objectContaining({ host_ip: "127.0.0.1", published: "9001", target: 9001 }),
    ]);
    expect(config.services.postgres.volumes).toEqual([
      expect.objectContaining({ source: "postgres_data", target: "/var/lib/postgresql/data" }),
    ]);
    expect(config.services.minio.volumes).toEqual([
      expect.objectContaining({ source: "minio_data", target: "/data" }),
    ]);
    expect(config.volumes).toEqual(expect.objectContaining({
      postgres_data: expect.any(Object),
      minio_data: expect.any(Object),
    }));
  });
});
