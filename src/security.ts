/**
 * SSRF / URL 安全校验：从分享文本提取 URL，并校验目标是公网地址。
 */

const URL_PATTERN = new RegExp(
  'https?://[^\\s<>\"\'\u3000\uff0c\u3002\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d\u300f\u3011]+',
  'i',
);
const TRAILING_PUNCTUATION = '.,;:!?)]}\u3001\u3002\uff1b\uff1a\uff01\uff1f\uff09\u300b\u300d\u300f\u3011';

export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HTTPError";
  }
}

export function extractUrl(value: string): string {
  const match = URL_PATTERN.exec(value.trim());
  if (!match) {
    throw new HTTPError(400, '没有找到有效的视频链接');
  }
  let url = match[0];
  while (TRAILING_PUNCTUATION.includes(url[url.length - 1])) {
    url = url.slice(0, -1);
  }
  return url;
}

function isPublicIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    if (a === 10) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 127) return false;
    if (a === 0 || a === 255) return false;
    if (a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    return true;
  }
  if (ip.includes(':')) {
    const n = ip.toLowerCase();
    if (n === "::1") return false;
    if (n.startsWith('fc') || n.startsWith('fd')) return false;
    if (n.startsWith('fe80')) return false;
    if (n.startsWith("::ffff:")) return isPublicIp(n.slice(7));
    return true;
  }
  return false;
}

async function resolveHostname(hostname: string): Promise<string[]> {
  const url = 'https://1.1.1.1/dns-query?name=' + encodeURIComponent(hostname) + '&type=A';
  const resp = await fetch(url, { headers: { Accept: 'application/dns-json' } });
  if (!resp.ok) throw new HTTPError(400, '无法解析该域名');
  const data = (await resp.json()) as { Answer?: { data: string }[] };
  return (data.Answer ?? []).map((a) => a.data).filter(Boolean) as string[];
}

export async function validatePublicUrl(input: string): Promise<string> {
  const url = extractUrl(input);
  let hostname: string;
  let protocol: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
    protocol = parsed.protocol.toLowerCase();
  } catch {
    throw new HTTPError(400, '只支持 HTTP/HTTPS 链接');
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new HTTPError(400, '只支持 HTTP/HTTPS 链接');
  }
  // 已知短链接域名：跳过 DNS 预校验，跟随重定向后由业务逻辑再次校验最终落地地址。
  const shortLinkDomains = new Set([
    'v.douyin.com',
    'www.douyin.com',
    'm.douyin.com',
    'b23.tv',
    'www.bilibili.com',
    'm.bilibili.com',
    'bili2.cn',
  ]);
  if (/^[\d.]+$/.test(hostname) || hostname.includes(':')) {
    if (!isPublicIp(hostname)) throw new HTTPError(400, '不允许访问内网地址');
    return url;
  }
  if (!shortLinkDomains.has(hostname)) {
    const addresses = await resolveHostname(hostname);
    if (addresses.length === 0) throw new HTTPError(400, '无法解析该域名');
    if (!addresses.every(isPublicIp)) throw new HTTPError(400, '链接目标不是公网地址');
  }
  return url;
}
