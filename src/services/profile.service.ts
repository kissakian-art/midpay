import type { User } from "../db/schema";
import { UserRepository } from "../repositories/user.repository";
import { badRequest, conflict, notFound } from "./errors";
import { StorageService } from "./storage/storage.service";

const MAX_DISPLAY_NAME = 40;
const MAX_BIO = 200;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"];

const HANDLE_MIN = 3;
const HANDLE_MAX = 24;
/** Lowercase letters/digits, with . or _ separators inside (not at the edges). */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._]{1,22}[a-z0-9])$/;

/** Names we keep for the platform so nobody can impersonate it. */
const RESERVED_HANDLES = new Set([
  "admin", "administrator", "midpay", "support", "help", "official", "staff",
  "moderator", "mod", "system", "root", "api", "about", "settings", "security",
  "payments", "billing", "team", "info", "contact", "null", "undefined",
]);

export interface UpdateProfileInput {
  displayName?: string | null;
  bio?: string | null;
  handle?: string;
}

export interface HandleCheck {
  handle: string;
  available: boolean;
  reason?: string;
}

/** SQLite/D1 surfaces a unique-index breach as a UNIQUE constraint error. */
function isUniqueViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /UNIQUE constraint failed/i.test(msg);
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

  /**
   * Normalize + validate a desired @username. Handles are lowercased so
   * "CoachEmma" and "coachemma" are the same name — you can't impersonate
   * someone with different capitalization.
   */
  normalizeHandle(raw: string): string {
    return raw.trim().replace(/^@/, "").toLowerCase();
  }

  private validateHandle(raw: string): string {
    const handle = this.normalizeHandle(raw);
    if (handle.length < HANDLE_MIN || handle.length > HANDLE_MAX) {
      throw badRequest("handle_invalid", `Username must be ${HANDLE_MIN}–${HANDLE_MAX} characters`);
    }
    if (!HANDLE_RE.test(handle)) {
      throw badRequest(
        "handle_invalid",
        "Use letters, numbers, . and _ only — and start/end with a letter or number",
      );
    }
    if (handle.includes("..") || handle.includes("__")) {
      throw badRequest("handle_invalid", "No repeated . or _ characters");
    }
    if (RESERVED_HANDLES.has(handle)) {
      throw badRequest("handle_reserved", "That username is reserved");
    }
    return handle;
  }

  /** Is a username free? (Its owner asking about their own handle = available.) */
  async checkHandle(raw: string, forUserId?: string): Promise<HandleCheck> {
    let handle: string;
    try {
      handle = this.validateHandle(raw);
    } catch (e) {
      return {
        handle: this.normalizeHandle(raw),
        available: false,
        reason: e instanceof Error ? e.message : "Invalid username",
      };
    }
    const existing = await this.users.findByHandle(handle);
    if (existing && existing.id !== forUserId) {
      return { handle, available: false, reason: "That username is taken" };
    }
    return { handle, available: true };
  }

  async update(userId: string, input: UpdateProfileInput): Promise<User> {
    const patch: Partial<User> = {};

    if (input.handle !== undefined) {
      const handle = this.validateHandle(input.handle);
      const existing = await this.users.findByHandle(handle);
      if (existing && existing.id !== userId) {
        throw conflict("handle_taken", "That username is taken");
      }
      patch.handle = handle;
    }

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

    let updated: User | undefined;
    try {
      updated = await this.users.update(userId, patch);
    } catch (e) {
      // The unique index is the real arbiter: two people can claim the same
      // name between the check above and this write. Map that to a clean 409
      // instead of a 500.
      if (patch.handle && isUniqueViolation(e)) {
        throw conflict("handle_taken", "That username was just taken");
      }
      throw e;
    }
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
