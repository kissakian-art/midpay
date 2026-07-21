// Schema barrel — the single entry Drizzle Kit reads (see drizzle.config.ts)
// and the app imports from. Organized by domain; all tables use UUID PKs and
// portable SQL per the §2.4 portability spec.

export * from "./users";
export * from "./auth";
export * from "./creators";
export * from "./content";
export * from "./social";
export * from "./live";
export * from "./ledger";
export * from "./wallet";
export * from "./admin";
