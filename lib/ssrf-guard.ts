// SSRF 防护：校验出站 URL 不指向内网 / 回环 / 云元数据地址。
//
// 关键点：
// 1. 按 DNS 解析后的真实 IP 判断，而非 hostname 字符串（防 DNS rebinding / 域名伪装）。
// 2. 手动逐跳跟随重定向，每一跳都重新校验（防"公网 URL → 302 跳转到内网"）。

import dns from "dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

function ipv4ToParts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return null;
  const parts = m.slice(1).map((x) => Number(x));
  if (parts.some((n) => n < 0 || n > 255)) return null;
  return parts;
}

/** 判断一个 IP 字符串是否属于私网 / 回环 / 链路本地 / 云元数据等危险范围 */
export function isDangerousIp(ip: string): boolean {
  const raw = String(ip || "").trim().toLowerCase().replace(/^\[([^\]]+)\]$/, "$1");
  if (!raw) return true;

  // IPv6
  if (raw.includes(":")) {
    if (isIP(raw) !== 6 || raw.includes("%")) return true;
    // URL also normalizes dotted IPv4 tails and expanded IPv6 notation.
    const canonical = new URL(`http://[${raw}]`).hostname.slice(1, -1);
    const [left, right] = canonical.split("::");
    const head = left ? left.split(":") : [];
    const tail = right ? right.split(":") : [];
    const words = (right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail]).map(v => parseInt(v, 16));
    if (words.slice(0, 5).every(v => v === 0) && (words[5] === 0 || words[5] === 0xffff)) {
      return isDangerousIp(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
    }
    if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80 || (words[0] & 0xff00) === 0xff00) return true;
    return false;
  }

  const p = ipv4ToParts(raw);
  if (!p) return true; // 解析不出 → 视为危险
  const [a, b] = p;
  if (a === 0 || a === 127) return true; // 本网络 / 回环
  if (a === 10) return true; // 私网 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 私网 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 私网 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 链路本地 + 云元数据 169.254.169.254
  if (a === 100 && b >= 64 && b <= 127) return true; // 运营商级 NAT 100.64.0.0/10
  if (a >= 224) return true; // 组播 / 保留
  return false;
}

// Validate the socket's DNS answer as well, closing the DNS rebinding window.
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }).then(records => {
    if (!records.length || records.some(record => isDangerousIp(record.address))) {
      callback(new Error("forbidden host"), "", 4);
    } else if (options.all) {
      callback(null, records);
    } else {
      callback(null, records[0].address, records[0].family);
    }
  }, error => callback(error, "", 4));
};
const safeDispatcher = new Agent({ connect: { lookup: guardedLookup } });

/** 解析主机名到 IP 列表，若任一 IP 危险则抛错 */
async function assertHostnameSafe(hostname: string): Promise<void> {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) throw new Error("forbidden host");
  if (host === "localhost") throw new Error("forbidden host");

  // hostname 本身就是 IP 字面量
  if (ipv4ToParts(host) || host.includes(":")) {
    if (isDangerousIp(host)) throw new Error("forbidden host");
    return;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(host, { all: true });
  } catch {
    throw new Error("dns resolution failed");
  }
  if (!records.length) throw new Error("dns resolution failed");
  for (const r of records) {
    if (isDangerousIp(r.address)) throw new Error("forbidden host");
  }
}

/**
 * 安全地抓取一个外部 URL：仅允许 http(s)，逐跳校验重定向目标。
 * @returns 最终响应（调用方负责消费 body）
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 4
): Promise<Response> {
  let current = String(rawUrl || "").trim();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      throw new Error("invalid url");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new Error("only http/https is allowed");
    }

    await assertHostnameSafe(target.hostname);

    const res = await fetch(target.toString(), {
      ...init,
      redirect: "manual",
      dispatcher: safeDispatcher,
    } as RequestInit);

    // 处理重定向
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      await res.body?.cancel();
      if (hop >= maxRedirects) throw new Error("too many redirects");
      current = new URL(location, target).toString();
      continue;
    }

    return res;
  }

  throw new Error("too many redirects");
}
