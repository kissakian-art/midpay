import { createApp } from "./http/app";
import type { Env } from "./env";
import { terminateOverrunLives } from "./jobs/terminate-overrun-lives";

export { LiveRoom } from "./realtime/live-room";

/**
 * Worker entry point (§2.4). Delegates to the Hono app, which wires the
 * repository/service layers per request. The scheduled handler runs the §3.3
 * auto-terminate guard on a cron trigger (see wrangler.toml [triggers]).
 */
const app = createApp();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),

  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(
      terminateOverrunLives(env).then(({ terminated }) => {
        if (terminated > 0) console.log(`[cron] auto-terminated ${terminated} overrun live(s)`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
