import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createDb } from "../src/db/client.ts";

/** Exercise the actual Drizzle D1 SQL against SQLite, including transactional
 * batch rollback. No production services or local development data are used. */
export function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../drizzle/migrations/", import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  const adapter = {
    failAt: null,
    prepare(query) {
      return {
        bind(...params) {
          const statement = sqlite.prepare(query);
          return {
            query,
            async all() {
              return { success: true, results: statement.all(...params), meta: {} };
            },
            async raw() {
              statement.setReturnArrays(true);
              return statement.all(...params);
            },
            async run() {
              const result = statement.run(...params);
              return { success: true, results: [], meta: { changes: Number(result.changes) } };
            },
            execute() {
              return { success: true, results: statement.all(...params), meta: {} };
            },
          };
        },
      };
    },
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement, index) => {
          if (index === adapter.failAt) throw new Error("Injected database failure");
          return statement.execute();
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { sqlite, adapter, db: createDb(adapter) };
}
