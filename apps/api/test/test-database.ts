// Test-only contract shared by browser acceptance and the destructive auth suite.
// pg accepts URL query options that can override the authority: prohibit them.
export function testDatabaseUrl(connectionString: string | undefined): string {
  const failure = () => new Error('Use a dedicated local PostgreSQL database ending in _test, without URL options or fragments');
  if (!connectionString) throw failure();
  let database: URL;
  let name: string;
  try {
    database = new URL(connectionString);
    name = decodeURIComponent(database.pathname.slice(1));
  } catch {throw failure();}
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
      connectionString.includes('?') || connectionString.includes('#') ||
      !/^[a-zA-Z_][a-zA-Z0-9_]*_test$/.test(name) || name.length > 63) throw failure();
  return connectionString;
}
