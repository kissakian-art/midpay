import type { Env } from "../env";
import { LiveRepository } from "../repositories/live.repository";
import { CreatorRepository } from "../repositories/creator.repository";
import { closeLiveKitRoom } from "./livekit";

export class LiveShutdownService {
  constructor(private readonly live: LiveRepository, private readonly creators: CreatorRepository, private readonly env: Env) {}

  async close(id: string): Promise<boolean> {
    const event = await this.live.findById(id);
    if (!event || !["ended", "terminated", "cancelled"].includes(event.status)) return false;
    const creator = await this.creators.findById(event.creatorId);
    // Run independently: a provider outage must not prevent chat shutdown.
    const results = await Promise.allSettled([
      (async () => {
        const stub = this.env.LIVE_ROOM.get(this.env.LIVE_ROOM.idFromName(id));
        const result = await stub.fetch("https://live-room/close", { method: "POST" });
        if (!result.ok) throw new Error("chat shutdown unavailable");
      })(),
      closeLiveKitRoom(this.env, id, creator?.userId ?? ""),
    ]);
    if (results.some(result => result.status === "rejected")) {
      console.warn("live shutdown awaiting retry", id);
      await this.live.deferShutdown(id);
      return false;
    }
    await this.live.acknowledgeShutdown(id);
    return true;
  }

  async retryPending(): Promise<void> {
    for (const event of await this.live.pendingShutdowns()) await this.close(event.id);
  }
}
