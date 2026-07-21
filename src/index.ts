import { createApp } from "./http/app";
import type { Env } from "./env";

/**
 * Worker entry point (§2.4). Delegates to the Hono app, which wires the
 * repository/service layers per request. This file only exports the handler;
 * all routing and business logic live under src/http and src/services.
 */
const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
} satisfies ExportedHandler<Env>;
