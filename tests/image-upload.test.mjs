import test from "node:test";
import assert from "node:assert/strict";
import { validateImageUpload } from "../src/services/image-upload.ts";

test("image upload rejects active types, missing types and mismatched signatures", async () => {
  for (const type of [undefined, "text/html", "image/svg+xml", "application/octet-stream"]) {
    await assert.rejects(validateImageUpload(new ArrayBuffer(0), type, 1024), { status: 415 });
  }
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    await assert.rejects(validateImageUpload(new TextEncoder().encode("<html>not an image</html>").buffer, type, 1024), { code: "invalid_image" });
  }
});

test("bounded reader counts actual streamed bytes and cancels oversized bodies", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(16)); }, cancel() { cancelled = true; } });
  await assert.rejects(validateImageUpload(stream, "image/jpeg", 24), { status: 413 });
  assert.equal(cancelled, true);
  await assert.rejects(validateImageUpload(new ArrayBuffer(25), "image/jpeg", 24), { status: 413 });
});

test("signature inspection handles chunk boundaries and normalizes MIME metadata", async () => {
  const bytes = Uint8Array.from([255, 216, 255, 224, 0, 0]);
  const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 1)); c.enqueue(bytes.slice(1)); c.close(); } });
  const result = await validateImageUpload(stream, "IMAGE/JPEG; charset=binary", bytes.length);
  assert.equal(result.contentType, "image/jpeg");
  assert.deepEqual(new Uint8Array(result.body), bytes);
});
