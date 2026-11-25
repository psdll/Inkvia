import bcrypt from "bcryptjs";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const PARAMETERS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const PREFIX = "$scrypt$v1$131072$8$1$";
let active = 0;
const waiting: Array<() => void> = [];

async function limitedHash<T>(work: () => Promise<T>): Promise<T> {
  if (active >= 2) {
    if (waiting.length >= 32) throw new Error("PASSWORD_HASH_BUSY");
    await new Promise<void>(resolve => waiting.push(resolve));
  } else active++;
  try { return await work(); }
  finally { const next = waiting.shift(); if (next) next(); else active--; }
}
function derive(plain: string, salt: Buffer): Promise<Buffer> {
  return limitedHash(() => new Promise((resolve, reject) => {
    scrypt(plain, salt, 64, PARAMETERS, (error, result) => error ? reject(error) : resolve(result));
  }));
}
export function isLegacyBcrypt(stored: string): boolean { return /^\$2[aby]\$(?:0[4-9]|1[0-4])\$[./A-Za-z0-9]{53}$/.test(stored); }
export function isHashed(stored: string | null | undefined): boolean { return isLegacyBcrypt(String(stored || "")) || String(stored || "").startsWith("$scrypt$"); }
export function isCurrentPasswordHash(stored: string): boolean { return stored.startsWith(PREFIX); }

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length < 1 || plain.length > 256) throw new Error("PASSWORD_INPUT_INVALID");
  const salt = randomBytes(16);
  const hash = await derive(plain, salt);
  return `${PREFIX}${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (typeof plain !== "string" || plain.length < 1 || plain.length > 256 || !stored) return false;
  if (stored.startsWith("$scrypt$")) {
    const match = /^\$scrypt\$v1\$131072\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(stored);
    if (!match) return false;
    const salt = Buffer.from(match[1], "base64url");
    const expected = Buffer.from(match[2], "base64url");
    if (salt.length !== 16 || expected.length !== 64 || salt.toString("base64url") !== match[1] || expected.toString("base64url") !== match[2]) return false;
    return timingSafeEqual(await derive(plain, salt), expected);
  }
  if (isLegacyBcrypt(stored)) {
    try { return await limitedHash(() => bcrypt.compare(plain, stored)); } catch { return false; }
  }
  if (/^\$2[aby]\$/.test(stored)) return false;
  const input = Buffer.from(plain, "utf8");
  const expected = Buffer.from(stored, "utf8");
  return input.length === expected.length && timingSafeEqual(input, expected);
}
