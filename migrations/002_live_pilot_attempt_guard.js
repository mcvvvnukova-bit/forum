import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectory = dirname(fileURLToPath(import.meta.url));
const sqlDirectory = join(migrationDirectory, "sql");
const upSql = readFileSync(join(sqlDirectory, "002_live_pilot_attempt_guard.up.sql"), "utf8");
const downSql = readFileSync(join(sqlDirectory, "002_live_pilot_attempt_guard.down.sql"), "utf8");

export function up(pgm) {
  pgm.sql(upSql);
}

export function down(pgm) {
  pgm.sql(downSql);
}
