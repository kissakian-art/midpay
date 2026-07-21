/**
 * TOTP (RFC 6238) via Web Crypto — admin 2FA (§7.1). No external dependency;
 * works in Workers and Node alike. 6 digits, 30-second step, SHA-1 (the
 * algorithm authenticator apps expect).
 */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = mac[mac.length - 1]! & 0x0f;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

export async function totpCode(secretB32: string, atMs = Date.now()): Promise<string> {
  return hotp(base32Decode(secretB32), Math.floor(atMs / 1000 / 30));
}

/** Verify with a ±1 step window to absorb clock drift. */
export async function verifyTotp(secretB32: string, code: string, atMs = Date.now()): Promise<boolean> {
  const counter = Math.floor(atMs / 1000 / 30);
  const secret = base32Decode(secretB32);
  for (const c of [counter, counter - 1, counter + 1]) {
    if ((await hotp(secret, c)) === code.trim()) return true;
  }
  return false;
}

/** otpauth:// URI for the authenticator-app QR code. */
export function otpauthUri(secretB32: string, accountEmail: string): string {
  const issuer = encodeURIComponent("MidPay Admin");
  return `otpauth://totp/${issuer}:${encodeURIComponent(accountEmail)}?secret=${secretB32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}
