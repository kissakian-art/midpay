import { defineConfig } from "drizzle-kit";

// Portable migration management via Drizzle Kit (§2.4 portability spec).
// Dialect is currently `sqlite` (D1). A future move to self-hosted Postgres
// changes this `dialect` (and the driver) — the schema + repository layer stay.
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  verbose: true,
  strict: true,
});
