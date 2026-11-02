import { ApiError, badRequest } from "./errors";

/** Bounded image inspection, not a decoder or malware scanner. */
export async function validateImageUpload(body: ReadableStream | ArrayBuffer, contentType: string | undefined, maxBytes: number) {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  if (!type || !["image/jpeg", "image/png", "image/webp"].includes(type)) {
    throw new ApiError(415, "unsupported_image", "Upload a JPEG, PNG or WebP image");
  }
  const tooLarge = () => new ApiError(413, "image_too_large", `Image must be at most ${maxBytes / 1048576} MiB`);
  let bytes: Uint8Array;
  if (body instanceof ArrayBuffer) {
    if (body.byteLength > maxBytes) throw tooLarge();
    bytes = new Uint8Array(body);
  } else {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw tooLarge();
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  }
  const match = (offset: number, signature: number[]) => signature.every((b, i) => bytes[offset + i] === b);
  const valid = type === "image/jpeg" ? bytes.length >= 4 && match(0, [255, 216, 255])
    : type === "image/png" ? bytes.length >= 24 && match(0, [137, 80, 78, 71, 13, 10, 26, 10]) && match(12, [73, 72, 68, 82])
    : bytes.length >= 16 && match(0, [82, 73, 70, 70]) && match(8, [87, 69, 66, 80]) && match(12, [86, 80, 56]);
  if (!valid) throw badRequest("invalid_image", "Image bytes do not match the declared format");
  return { body: bytes.buffer as ArrayBuffer, contentType: type };
}
