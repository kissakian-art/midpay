import { createDb } from "../db/client";
import type { Env } from "../env";
import { AuditRepository } from "../repositories/audit.repository";
import { LiveRepository } from "../repositories/live.repository";
import { ConfigService } from "../services/config.service";
import { CreatorRepository } from "../repositories/creator.repository";
import { UserRepository } from "../repositories/user.repository";
import { LiveShutdownService } from "../services/live-shutdown.service";

/**
 * §3.3 runtime cap (hard requirement): a live stream auto-terminates at its
 * declared duration plus a short grace period. Runs on a cron trigger; scans
 * currently-live events and terminates any that have overrun. This is the
 * server-side guarantee that a creator can never stream longer than the
 * duration their ticket price was validated against.
 */
export async function terminateOverrunLives(env: Env): Promise<{ terminated: number }> {
  const db = createDb(env.DB);
  const live = new LiveRepository(db);
  const audit = new AuditRepository(db);
  const config = new ConfigService(db, env);
  const creators = new CreatorRepository(db);
  const users = new UserRepository(db);
  const shutdown = new LiveShutdownService(live, creators, env);

  const graceMin = await graceMinutes(config, env);
  const now = Date.now();

  const active = await live.listByStatus("live");
  let terminated = 0;
  for (const event of active) {
    if (!event.startedAt) continue;
    const deadline =
      event.startedAt.getTime() + (event.declaredDurationMin + graceMin) * 60_000;
    const creator = await creators.findById(event.creatorId);
    const owner = creator ? await users.findById(creator.userId) : undefined;
    if (now < deadline && creator?.status === "active" && owner?.status === "active") continue;

    // A normal duration limit completes the service; account enforcement remains an exception.
    const status = now >= deadline && creator?.status === 'active' && owner?.status === 'active' ? 'ended' : 'terminated';
    if (!(await live.finish(event.id, status))) continue;
    await audit.record({
      action: "live.auto_terminate",
      targetType: "live_event",
      targetId: event.id,
      detail: {
        declaredDurationMin: event.declaredDurationMin,
        graceMin,
        startedAt: event.startedAt.toISOString(),
      },
    });
    terminated++;
  }
  await shutdown.retryPending();
  return { terminated };
}

async function graceMinutes(config: ConfigService, env: Env): Promise<number> {
  try {
    return await config.liveGraceMinutes();
  } catch {
    return Number(env.LIVE_AUTO_TERMINATE_GRACE_MINUTES) || 5;
  }
}
