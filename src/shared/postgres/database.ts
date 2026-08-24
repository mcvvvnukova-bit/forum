import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface Database {
  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T>;
}

export class PostgresDatabase implements Database {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl });
  }

  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return values === undefined
      ? this.pool.query<T>(text)
      : this.pool.query<T>(text, [...values]);
  }

  async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await work(new TransactionDatabase(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

class TransactionDatabase implements Database {
  constructor(private readonly client: PoolClient) {}

  query<T extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>> {
    return values === undefined
      ? this.client.query<T>(text)
      : this.client.query<T>(text, [...values]);
  }

  transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> {
    return work(this);
  }
}
