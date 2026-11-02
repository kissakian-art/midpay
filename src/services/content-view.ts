import type { Content } from "../db/schema";

/** One projection for every discovery response. Storage keys are never public
 * capabilities; paid text (including its auto-generated title) is private. */
export function contentView<T extends Content>(item: T, owned = false): T & { owned: boolean } {
  const locked = item.pricing === "paid" && !owned;
  return {
    ...item,
    r2Key: null,
    thumbnailR2Key: item.kind === "photo" && item.pricing === "paid" ? null : item.thumbnailR2Key ? String(item.updatedAt.getTime()) : null,
    ...(locked ? { description: null, overlays: null } : {}),
    ...(locked && item.kind === "text" ? { title: "Premium text", textStyle: null } : {}),
    owned,
  };
}
