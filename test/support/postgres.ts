import { randomUUID } from "node:crypto";
import { Client } from "pg";

export interface TemporaryDatabase {
  connectionString: string;
  drop(): Promise<void>;
}

export function requireTestDatabaseAdminUrl(input: NodeJS.ProcessEnv = process.env): string {
  const value = input.TEST_DATABASE_ADMIN_URL?.trim();

  if (value === undefined || value === "") {
    throw new Error("TEST_DATABASE_ADMIN_URL is required for integration tests");
  }

  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_ADMIN_URL must be a PostgreSQL URL");
  }

  return url.toString();
}

export async function createTemporaryDatabase(
  adminUrl = requireTestDatabaseAdminUrl(),
): Promise<TemporaryDatabase> {
  const name = `okved_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl });

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${name}`;

  return {
    connectionString: databaseUrl.toString(),
    async drop(): Promise<void> {
      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [name],
        );
        await cleanup.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(name)}`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}
