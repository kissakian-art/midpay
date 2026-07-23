import type { User } from "../db/schema";
import { UserRepository } from "../repositories/user.repository";
import { badRequest, notFound } from "./errors";
import { StorageService } from "./storage/storage.service";

const MAX_DISPLAY_NAME = 40;
const MAX_BIO = 200;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface UpdateProfileInput {
  displayName?: string | null;
  bio?: string | null;
}

/**
 * ProfileService — the user's own editable identity: display name, bio, and
 * profile picture. The avatar object lives in R2 (§2.2); only its key is stored
 * on the user row. Avatars are public (they show on every feed card), so
 * serving needs no entitlement check — unlike paid content media.
 */
export class ProfileService {
  constructor(
    private readonly users: UserRepository,
    private readonly storage: StorageService,
  ) {}

  async update(userId: string, input: UpdateProfileInput): Promise<User> {
    const patch: Partial<User> = {};

    if (input.displayName !== undefined) {
      const name = input.displayName?.trim() ?? "";
      if (name.length > MAX_DISPLAY_NAME) {
        throw badRequest("name_too_long", `Display name must be ${MAX_DISPLAY_NAME} characters or fewer`);
      }
      patch.displayName = name === "" ? null : name;
    }

    if (input.bio !== undefined) {
      const bio = input.bio?.trim() ?? "";
      if (bio.length > MAX_BIO) {
        throw badRequest("bio_too_long", `Bio must be ${MAX_BIO} characters or fewer`);
      }
      patch.bio = bio === "" ? null : bio;
    }

    const updated = await this.users.update(userId, patch);
    if (!updated) throw notFound("user");
    return updated;
  }

  /** Upload/replace the profile picture; drops the previous object from R2. */
  async setAvatar(
    userId: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<User> {
    if (contentType && !ALLOWED_AVATAR_TYPES.includes(contentType.split(";")[0]!.trim())) {
      throw badRequest("bad_image_type", "Avatar must be a JPEG, PNG or WebP image");
    }
    const existing = await this.users.findById(userId);
    if (!existing) throw notFound("user");

    const key = this.storage.avatarKey(userId);
    await this.storage.put(key, body, contentType);
    const updated = await this.users.update(userId, { avatarR2Key: key });
    if (!updated) throw notFound("user");

    if (existing.avatarR2Key && existing.avatarR2Key !== key) {
      await this.storage.delete(existing.avatarR2Key);
    }
    return updated;
  }

  /** Open a user's avatar object for public serving. */
  async openAvatar(userId: string): Promise<R2ObjectBody> {
    const user = await this.users.findById(userId);
    if (!user?.avatarR2Key) throw notFound("avatar");
    const object = await this.storage.get(user.avatarR2Key);
    if (!object) throw notFound("avatar");
    return object;
  }
}
