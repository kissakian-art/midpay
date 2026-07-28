import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { authHeaders, mediaUrl } from "./api";

/**
 * On-device LRU cache for FREE video media. Once a viewer has watched a clip it
 * plays from local storage on the next view instead of re-hitting the network —
 * saving the viewer's mobile data and our egress / DB calls. Best-effort: any
 * failure silently falls back to streaming, so playback never depends on it.
 *
 * Paid content is NEVER cached to disk (that would defeat §4.4 content
 * protection). Cap: MAX_ITEMS videos, evicted least-recently-used first.
 */
const CACHE_DIR = new Directory(Paths.cache, "midpay-video");
const MANIFEST_KEY = "midpay.videoCache.v1";
const MAX_ITEMS = 100;

/** LRU manifest: most-recently-used LAST, so eviction shifts from the front. */
type Entry = { id: string; ts: number };

let dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        if (!CACHE_DIR.exists) CACHE_DIR.create({ intermediates: true, idempotent: true });
      } catch {
        // best-effort
      }
    })();
  }
  return dirReady;
}

function fileFor(id: string): File {
  return new File(CACHE_DIR, `${id}.mp4`);
}

// Serialize read-modify-write of the manifest so concurrent cell downloads
// don't clobber each other's updates.
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

async function readManifest(): Promise<Entry[]> {
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as Entry[]) : [];
  } catch {
    return [];
  }
}

async function writeManifest(m: Entry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
  } catch {
    // best-effort
  }
}

/** Move `id` to the most-recent end of the LRU manifest. */
function touch(id: string): Promise<void> {
  return queue(async () => {
    const m = (await readManifest()).filter((e) => e.id !== id);
    m.push({ id, ts: Date.now() });
    await writeManifest(m);
  });
}

/**
 * Synchronous check for a ready-to-play local copy. Returns a `file://` URI when
 * the clip is fully cached, else null (caller streams from the network). Also
 * bumps the LRU timestamp (fire-and-forget) so a re-watched clip stays cached.
 */
export function getCachedUri(id: string): string | null {
  try {
    const f = fileFor(id);
    if (f.exists && f.size > 0) {
      touch(id).catch(() => {});
      return f.uri;
    }
  } catch {
    // fall through
  }
  return null;
}

const inFlight = new Set<string>();

/**
 * Download a free video to the cache for next time. No-op if already cached or a
 * download is already running for it. Evicts the least-recently-used clips down
 * to MAX_ITEMS. Safe to call on every "cell became active" — de-duped internally.
 */
export async function cacheVideo(id: string): Promise<void> {
  if (inFlight.has(id)) return;
  try {
    const existing = fileFor(id);
    if (existing.exists && existing.size > 0) {
      await touch(id);
      return;
    }
  } catch {
    // fall through to (re)download
  }

  inFlight.add(id);
  try {
    await ensureDir();
    const dest = fileFor(id);
    await File.downloadFileAsync(mediaUrl(id), dest, { headers: authHeaders(), idempotent: true });

    await queue(async () => {
      const m = (await readManifest()).filter((e) => e.id !== id);
      m.push({ id, ts: Date.now() });
      while (m.length > MAX_ITEMS) {
        const victim = m.shift();
        if (!victim) break;
        try {
          const vf = fileFor(victim.id);
          if (vf.exists) vf.delete();
        } catch {
          // ignore a stuck victim
        }
      }
      await writeManifest(m);
    });
  } catch {
    // Clean up a partial/empty download so getCachedUri never serves a bad file.
    try {
      const f = fileFor(id);
      if (f.exists && f.size === 0) f.delete();
    } catch {
      // ignore
    }
  } finally {
    inFlight.delete(id);
  }
}
