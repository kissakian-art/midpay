/**
 * StorageService — the isolated object-storage layer for media (§2.2), the R2
 * analogue of the DB repository layer. All R2 access goes through here so the
 * rest of the app never touches the binding directly; swapping storage
 * providers later is contained to this file.
 *
 * Keys are SERVER-generated (clients never choose R2 keys) and namespaced by
 * content id so a content item's objects are easy to enumerate and delete.
 */
export interface PutResult {
  key: string;
  size: number;
}

export class StorageService {
  constructor(private readonly bucket: R2Bucket) {}

  mediaKey(contentId: string): string {
    return `content/${contentId}/media/${crypto.randomUUID()}`;
  }

  thumbnailKey(contentId: string): string {
    return `content/${contentId}/thumb/${crypto.randomUUID()}`;
  }

  async put(
    key: string,
    body: ReadableStream | ArrayBuffer,
    contentType?: string,
  ): Promise<PutResult> {
    const obj = await this.bucket.put(key, body, {
      httpMetadata: contentType ? { contentType } : undefined,
    });
    if (!obj) throw new Error("R2 put returned null");
    return { key, size: obj.size };
  }

  /** Fetch an object, optionally a byte range (for video seeking). */
  get(key: string, range?: R2Range): Promise<R2ObjectBody | null> {
    return this.bucket.get(key, range ? { range } : undefined);
  }

  head(key: string): Promise<R2Object | null> {
    return this.bucket.head(key);
  }

  /** Best-effort delete; missing keys are a no-op. */
  async delete(keys: string | string[]): Promise<void> {
    await this.bucket.delete(keys);
  }
}
