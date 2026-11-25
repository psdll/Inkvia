import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "fs-extra";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import * as yauzl from "yauzl";
import { ZipFile } from "yazl";
import { decryptPassword } from "@/lib/password-crypto";
import { hashPassword, isLegacyBcrypt, verifyPassword } from "@/lib/password";
import { assertDiskSpace, formatBytes, getMaxExportBytes, getMaxImportBytes } from "@/lib/admin/user-transfer-limits";

// V3 carries its own random key for password-free portability. It is a sensitive
// account backup, NOT confidential encryption or proof of a trusted source.
const FORMAT = "inkvia-user-migration";
// Packages exported before the rename stay importable.
const LEGACY_FORMAT = "ai-stools-user-migration";
const KDF = { name: "scrypt", N: 16384, r: 8, p: 1 } as const;
const MAX_MANIFEST = 4096;
const MAX_CREDENTIAL = 8192;
const HASH_RE = /^\$scrypt\$v1\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/;
export type MigrationCredential = { version: 1; passwordHash: string; recoverablePassword?: string };

type CryptoHeader = { version: 2 | 3; portableKey?: string; format: string; kdf: typeof KDF & { salt: string }; cipher: { name: "aes-256-gcm"; nonce: string }; payload: { name: "payload.enc"; bytes: number } };
type Manifest = CryptoHeader & { authTag: string };

export function validateMigrationPassphrase(passphrase: unknown): string {
  if (typeof passphrase !== "string" || passphrase.length < 12 || passphrase.length > 256) throw new Error("MIGRATION_PASSPHRASE_INVALID: 迁移口令须为 12 至 256 个字符");
  return passphrase;
}
function b64(value: unknown, bytes: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("MIGRATION_PACKAGE_INVALID: 加密参数无效");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value) throw new Error("MIGRATION_PACKAGE_INVALID: 加密参数无效");
  return decoded;
}
function keyFor(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(passphrase, salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
function validHash(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 150) return false;
  if (isLegacyBcrypt(value)) return true;
  if (!HASH_RE.test(value)) return false;
  const parts = value.split("$");
  return Buffer.from(parts[6], "base64url").toString("base64url") === parts[6]
    && Buffer.from(parts[7], "base64url").toString("base64url") === parts[7];
}
function validCredential(value: unknown): value is MigrationCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return c.version === 1 && validHash(c.passwordHash) && (c.recoverablePassword === undefined || (typeof c.recoverablePassword === "string" && c.recoverablePassword.length >= 1 && c.recoverablePassword.length <= 256));
}
function credentialAad(legacy = false) { return Buffer.from(legacy ? "ai-stools:migration-credential:v1" : "inkvia:migration-credential:v1", "utf8"); }

export async function sealMigrationCredential(user: { id: number; password: string; passwordCipher: unknown; credentialVersion: number }, passphrase: string): Promise<unknown> {
  validateMigrationPassphrase(passphrase);
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  let recoverablePassword: string | undefined;
  if (user.passwordCipher) {
    recoverablePassword = decryptPassword(user.passwordCipher, user.id, user.credentialVersion);
  } else if (typeof user.password === "string" && !/^\$(?:scrypt|2[aby])\$/.test(user.password) && user.password.length <= 256) {
    recoverablePassword = user.password;
  }
  const passwordHash = validHash(user.password) ? user.password : recoverablePassword ? await hashPassword(recoverablePassword) : null;
  if (!passwordHash || (recoverablePassword && !await verifyPassword(recoverablePassword, passwordHash))) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  const credential: MigrationCredential = { version: 1, passwordHash, ...(recoverablePassword ? { recoverablePassword } : {}) };
  const salt = randomBytes(16), nonce = randomBytes(12), key = await keyFor(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(credentialAad());
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential), "utf8"), cipher.final()]);
  return { version: 1, kdf: { ...KDF, salt: salt.toString("base64url") }, cipher: { name: "aes-256-gcm", nonce: nonce.toString("base64url") }, ciphertext: ciphertext.toString("base64url"), authTag: cipher.getAuthTag().toString("base64url") };
}
export async function openMigrationCredential(value: unknown, passphrase: string): Promise<MigrationCredential> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  const c = value as Record<string, any>;
  if (c.version !== 1 || c.kdf?.name !== KDF.name || c.kdf?.N !== KDF.N || c.kdf?.r !== KDF.r || c.kdf?.p !== KDF.p || c.cipher?.name !== "aes-256-gcm") throw new Error("MIGRATION_CREDENTIAL_INVALID");
  const salt = b64(c.kdf.salt, 16), nonce = b64(c.cipher.nonce, 12), tag = b64(c.authTag, 16);
  if (typeof c.ciphertext !== "string" || c.ciphertext.length > MAX_CREDENTIAL * 2) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  const ciphertext = Buffer.from(c.ciphertext, "base64url");
  if (ciphertext.length > MAX_CREDENTIAL || ciphertext.toString("base64url") !== c.ciphertext) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  if (!passphrase) throw new Error("MIGRATION_PASSPHRASE_REQUIRED: 需要迁移口令");
  let credential: unknown;
  try {
    const key = await keyFor(passphrase, salt);
    const decrypt = (legacy: boolean) => {
      const decipher = createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAAD(credentialAad(legacy)); decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    };
    let plaintext: Buffer;
    try { plaintext = decrypt(false); } catch { plaintext = decrypt(true); }
    credential = JSON.parse(plaintext.toString("utf8"));
  } catch { throw new Error("MIGRATION_PASSPHRASE_INVALID: 口令错误或凭据已损坏"); }
  if (!validCredential(credential)) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  if (credential.recoverablePassword && !await verifyPassword(credential.recoverablePassword, credential.passwordHash)) throw new Error("MIGRATION_CREDENTIAL_INVALID");
  return credential;
}

function validateHeader(raw: unknown): { header: CryptoHeader; tag: Buffer } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("MIGRATION_PACKAGE_INVALID: 清单无效");
  const m = raw as Record<string, any>;
  if (m.version !== 2 && m.version !== 3) throw new Error("不支持的迁移包版本，请升级应用");
  if ((m.format !== FORMAT && m.format !== LEGACY_FORMAT) || m.kdf?.name !== KDF.name || m.kdf?.N !== KDF.N || m.kdf?.r !== KDF.r || m.kdf?.p !== KDF.p || m.cipher?.name !== "aes-256-gcm" || m.payload?.name !== "payload.enc" || !Number.isSafeInteger(m.payload?.bytes) || m.payload.bytes < 0 || m.payload.bytes > getMaxImportBytes()) throw new Error("MIGRATION_PACKAGE_INVALID: 清单参数无效");
  if (Object.keys(m.kdf).sort().join() !== ["name", "N", "r", "p", "salt"].sort().join() || Object.keys(m.cipher).sort().join() !== "name,nonce" || Object.keys(m.payload).sort().join() !== "bytes,name") throw new Error("MIGRATION_PACKAGE_INVALID: 清单字段无效");
  b64(m.kdf.salt, 16); b64(m.cipher.nonce, 12);
  const tag = b64(m.authTag, 16);
  if (m.version === 3) b64(m.portableKey, 32);
  const header: CryptoHeader = { version: m.version, ...(m.version === 3 ? { portableKey: m.portableKey } : {}), format: m.format, kdf: { ...KDF, salt: m.kdf.salt }, cipher: { name: "aes-256-gcm", nonce: m.cipher.nonce }, payload: { name: "payload.enc", bytes: m.payload.bytes } };
  if (Object.keys(m).sort().join() !== ["authTag", "cipher", "format", "kdf", "payload", "version", ...(m.version === 3 ? ["portableKey"] : [])].sort().join()) throw new Error("MIGRATION_PACKAGE_INVALID: 清单字段无效");
  return { header, tag };
}
function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (err, zip) => err || !zip ? reject(err || new Error("ZIP 文件无法打开")) : resolve(zip)));
}
function nextEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry | null> {
  return new Promise((resolve, reject) => {
    const onEntry = (entry: yauzl.Entry) => { clear(); resolve(entry); };
    const onEnd = () => { clear(); resolve(null); };
    const onError = (err: Error) => { clear(); reject(err); };
    const clear = () => { zip.off("entry", onEntry); zip.off("end", onEnd); zip.off("error", onError); };
    zip.once("entry", onEntry); zip.once("end", onEnd); zip.once("error", onError); zip.readEntry();
  });
}
function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => err || !stream ? reject(err || new Error("ZIP 条目无法读取")) : resolve(stream)));
}
async function readSmall(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  if (entry.uncompressedSize > MAX_MANIFEST) throw new Error("MIGRATION_PACKAGE_INVALID: 清单过大");
  const stream = await entryStream(zip, entry);
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const chunk of stream) { bytes += chunk.length; if (bytes > MAX_MANIFEST) throw new Error("MIGRATION_PACKAGE_INVALID: 清单过大"); chunks.push(chunk); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function wrapMigrationArchive(src: string, out: string, passphrase: string, portable = false): Promise<void> {
  validateMigrationPassphrase(passphrase);
  if (portable) b64(passphrase, 32);
  const stat = await fs.stat(src);
  if (!stat.isFile() || stat.size > getMaxExportBytes()) throw new Error("MIGRATION_PACKAGE_INVALID: 源文件过大");
  await fs.ensureDir(path.dirname(out));
  await assertDiskSpace(path.dirname(out), stat.size * 2, "迁移加密");
  const privateDir = await fs.mkdtemp(path.join(path.dirname(out), ".migration-"));
  await fs.chmod(privateDir, 0o700);
  const encrypted = path.join(privateDir, "payload.enc");
  try {
    const salt = randomBytes(16), nonce = randomBytes(12), key = await keyFor(passphrase, salt);
    const header: CryptoHeader = { version: portable ? 3 : 2, ...(portable ? { portableKey: passphrase } : {}), format: FORMAT, kdf: { ...KDF, salt: salt.toString("base64url") }, cipher: { name: "aes-256-gcm", nonce: nonce.toString("base64url") }, payload: { name: "payload.enc", bytes: stat.size } };
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(header)));
    await pipeline(createReadStream(src), cipher, createWriteStream(encrypted, { mode: 0o600 }));
    const manifest: Manifest = { ...header, authTag: cipher.getAuthTag().toString("base64url") };
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), "manifest.json", { compress: true });
    zip.addFile(encrypted, "payload.enc", { compress: false });
    const output = createWriteStream(out, { mode: 0o600 });
    const completed = pipeline(zip.outputStream, output);
    zip.end();
    await completed;
    if ((await fs.stat(out)).size > getMaxExportBytes()) throw new Error(`迁移包超过上限 ${formatBytes(getMaxExportBytes())}`);
  } catch (err) { await fs.remove(out).catch(() => {}); throw err; }
  finally { await fs.remove(privateDir); }
}
export async function unwrapMigrationArchive(filePath: string, passphrase?: string): Promise<{ filePath: string; encrypted: boolean; portable?: boolean; credentialKey?: string; cleanup: () => Promise<void> }> {
  const archiveStat = await fs.stat(filePath);
  if (!archiveStat.isFile() || archiveStat.size > getMaxImportBytes()) throw new Error("MIGRATION_PACKAGE_INVALID: 归档过大");
  const zip = await openZip(filePath);
  let privateDir: string | undefined;
  try {
    let manifestEntry: yauzl.Entry | undefined, payloadEntry: yauzl.Entry | undefined;
    let count = 0;
    while (true) {
      const entry = await nextEntry(zip);
      if (!entry) break;
      count++;
      if (entry.fileName === "manifest.json") manifestEntry = entry;
      else if (entry.fileName === "payload.enc") payloadEntry = entry;
      if (count > 250000) throw new Error("MIGRATION_PACKAGE_INVALID: 条目过多");
    }
    if (!manifestEntry) return { filePath, encrypted: false, cleanup: async () => {} };
    const raw = JSON.parse(await readSmall(zip, manifestEntry));
    if (raw?.version === 1) return { filePath, encrypted: false, cleanup: async () => {} };
    const { header, tag } = validateHeader(raw);
    if (count !== 2 || !payloadEntry || payloadEntry.uncompressedSize !== header.payload.bytes) throw new Error("MIGRATION_PACKAGE_INVALID: 加密载荷无效");
    if (header.version === 3) passphrase = header.portableKey;
    if (!passphrase) throw new Error("MIGRATION_PASSPHRASE_REQUIRED: 需要迁移口令");
    const key = await keyFor(passphrase, b64(header.kdf.salt, 16));
    const decipher = createDecipheriv("aes-256-gcm", key, b64(header.cipher.nonce, 12));
    decipher.setAAD(Buffer.from(JSON.stringify(header))); decipher.setAuthTag(tag);
    privateDir = await fs.mkdtemp(path.join(path.dirname(filePath), ".migration-open-"));
    await fs.chmod(privateDir, 0o700);
    const plainPath = path.join(privateDir, "payload.zip");
    let bytes = 0;
    await assertDiskSpace(privateDir, header.payload.bytes, "迁移解密");
    const stream = await entryStream(zip, payloadEntry);
    const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > header.payload.bytes ? new Error("MIGRATION_PACKAGE_INVALID: 载荷过大") : null, chunk);
    } });
    try { await pipeline(stream, counter, decipher, createWriteStream(plainPath, { mode: 0o600 })); }
    catch { throw new Error(header.version === 3 ? "MIGRATION_PACKAGE_INVALID: 归档已损坏，请重新下载后导入" : "MIGRATION_PASSPHRASE_INVALID: 口令错误或归档已损坏"); }
    if (bytes !== header.payload.bytes) throw new Error("MIGRATION_PACKAGE_INVALID: 载荷长度无效");
    const cleanupDir = privateDir;
    return { filePath: plainPath, encrypted: true, portable: header.version === 3, credentialKey: passphrase, cleanup: async () => { await fs.remove(cleanupDir); } };
  } catch (err) { if (privateDir) await fs.remove(privateDir); throw err; }
  finally { zip.close(); }
}

/** Call only when transfer maintenance has confirmed there are no active import/export jobs. */
export async function cleanupMigrationScratch(root: string, now = Date.now()): Promise<number> {
  if (!await fs.pathExists(root)) return 0;
  const entries = await fs.readdir(root);
  let removed = 0;
  for (const name of entries) {
    if (!/^\.migration-(?:build-|open-)?[A-Za-z0-9]{6}$/.test(name)) continue;
    const target = path.join(root, name);
    const stat = await fs.lstat(target).catch(() => null);
    if (!stat?.isDirectory() || now - stat.mtimeMs < 24 * 60 * 60 * 1000) continue;
    await fs.remove(target);
    removed++;
  }
  return removed;
}
