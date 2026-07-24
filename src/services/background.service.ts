import type { Background } from "../db/schema";
import { BackgroundRepository } from "../repositories/background.repository";
import { UserRepository } from "../repositories/user.repository";
import { forbidden, notFound } from "./errors";
import { StorageService } from "./storage/storage.service";

/**
 * BackgroundService — owner/admin-uploaded image backgrounds for text posts,
 * available to every creator. Writes are gated to app admins (users.isAdmin);
 * reads are public.
 */
export class BackgroundService {
  constructor(
    private readonly repo: BackgroundRepository,
    private readonly users: UserRepository,
    private readonly storage: StorageService,
  ) {}

  private async requireAdmin(userId: string): Promise<void> {
    const u = await this.users.findById(userId);
    if (!u || !u.isAdmin) throw forbidden("admin only");
  }

  async create(userId: string): Promise<Background> {
    await this.requireAdmin(userId);
    return this.repo.create({ ownerUserId: userId, isPublic: true });
  }

  async attachImage(
    id: string,
    userId: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<Background> {
    await this.requireAdmin(userId);
    const bg = await this.repo.findById(id);
    if (!bg || bg.deletedAt) throw notFound("background");
    const key = this.storage.backgroundKey(id);
    await this.storage.put(key, body, contentType);
    const updated = await this.repo.update(id, { r2Key: key });
    if (bg.r2Key && bg.r2Key !== key) await this.storage.delete(bg.r2Key);
    return updated;
  }

  listPublic(): Promise<Background[]> {
    return this.repo.listPublic();
  }

  async openImage(id: string, range?: R2Range): Promise<R2ObjectBody> {
    const bg = await this.repo.findById(id);
    if (!bg || bg.deletedAt || !bg.r2Key) throw notFound("background_image");
    const object = await this.storage.get(bg.r2Key, range);
    if (!object) throw notFound("background_image");
    return object;
  }

  async remove(id: string, userId: string): Promise<{ deleted: true }> {
    await this.requireAdmin(userId);
    const bg = await this.repo.findById(id);
    if (!bg || bg.deletedAt) throw notFound("background");
    await this.repo.softDelete(id, new Date());
    if (bg.r2Key) await this.storage.delete(bg.r2Key);
    return { deleted: true };
  }
}
