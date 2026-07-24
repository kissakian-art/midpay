import type { Track } from "../db/schema";
import { MusicRepository } from "../repositories/music.repository";
import { badRequest, forbidden, notFound } from "./errors";
import { StorageService } from "./storage/storage.service";

export interface CreateTrackInput {
  title: string;
  artist?: string;
  durationSeconds?: number;
  /** Only honored for admins; ignored (forced to "device") otherwise. */
  source?: "device" | "catalog";
}

/**
 * MusicService — reusable audio tracks that posts can play over their media
 * (§ compose-at-playback). Audio bytes live in R2; tracks are addressable so the
 * same sound can back many posts.
 */
export class MusicService {
  constructor(
    private readonly tracks: MusicRepository,
    private readonly storage: StorageService,
  ) {}

  async createTrack(userId: string, input: CreateTrackInput, isAdmin = false): Promise<Track> {
    const title = input.title?.trim();
    if (!title) throw badRequest("title_required", "A track needs a title");
    const source = isAdmin && input.source === "catalog" ? "catalog" : "device";
    return this.tracks.create({
      ownerUserId: userId,
      source,
      title: title.slice(0, 120),
      artist: input.artist?.trim().slice(0, 120) || null,
      durationSeconds: input.durationSeconds ?? null,
      isPublic: true, // v1: every uploaded track joins the shared library
    });
  }

  private async requireOwnedTrack(id: string, userId: string): Promise<Track> {
    const track = await this.tracks.findById(id);
    if (!track || track.deletedAt) throw notFound("track");
    if (track.ownerUserId !== userId) throw forbidden("not your track");
    return track;
  }

  /** Upload/replace a track's audio bytes (owner only). */
  async attachAudio(
    id: string,
    userId: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<Track> {
    const track = await this.requireOwnedTrack(id, userId);
    const key = this.storage.musicKey(id);
    const { size } = await this.storage.put(key, body, contentType);
    const updated = await this.tracks.update(id, { r2Key: key, sizeBytes: size });
    if (track.r2Key && track.r2Key !== key) await this.storage.delete(track.r2Key);
    return updated;
  }

  listAvailable(viewerUserId: string | null, q: string | undefined, limit = 40): Promise<Track[]> {
    return this.tracks.listAvailable(viewerUserId, q, Math.min(Math.max(limit, 1), 100));
  }

  /** Open a track's audio for streaming. Public — music is meant to be heard. */
  async openAudio(id: string, range?: R2Range): Promise<R2ObjectBody> {
    const track = await this.tracks.findById(id);
    if (!track || track.deletedAt || !track.r2Key) throw notFound("track_audio");
    const object = await this.storage.get(track.r2Key, range);
    if (!object) throw notFound("track_audio");
    return object;
  }
}
