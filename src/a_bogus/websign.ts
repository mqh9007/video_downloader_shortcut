/**
 * 抖音受保护 Web API 的 x-secsdk-web-signature。
 *
 * 签名覆盖最终发送的规范化 query（包含 a_bogus），并绑定 UIFID 与时间戳。
 * 保持 literal '+' 不变，避免 URLSearchParams 的空格语义改变签名字节。
 */

const SALT = "A96D855A08C0A9707F8BEF0D9A527E4E";
const SIGNATURE_PARAM = "x-secsdk-web-signature";

const SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const TABLE = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000));

function add32(...values: number[]): number {
  return values.reduce((sum, value) => (sum + value) >>> 0, 0);
}

function rotateLeft(value: number, amount: number): number {
  return ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function md5(input: string): string {
  const bytes = Array.from(new TextEncoder().encode(input));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLength / 2 ** (8 * i)) & 0xff);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(16).fill(0);
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      words[i] = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = add32(a, f, TABLE[i], words[g]);
      const rotated = add32(b, rotateLeft(next, SHIFT[i]));
      a = d;
      d = c;
      c = b;
      b = rotated;
    }

    a0 = add32(a0, a);
    b0 = add32(b0, b);
    c0 = add32(c0, c);
    d0 = add32(d0, d);
  }

  return [a0, b0, c0, d0]
    .flatMap((word) => [0, 8, 16, 24].map((shift) => (word >>> shift) & 0xff))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decode(value: string): string {
  return decodeURIComponent(value);
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function normalizeQuery(query: string): string {
  return query
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf("=");
      const rawKey = separator >= 0 ? part.slice(0, separator) : part;
      const rawValue = separator >= 0 ? part.slice(separator + 1) : "";
      return `${encode(decode(rawKey))}=${encode(decode(rawValue))}`;
    })
    .join("&");
}

function hasParameter(query: string, name: string): boolean {
  return query.split("&").some((part) => decode(part.split("=", 1)[0]) === name);
}

export function signWebQuery(query: string, uifid: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const withIdentity = hasParameter(query, "uifid") ? query : `${query}&uifid=${encode(uifid)}`;
  const stamp = String(timestamp);
  const normalized = normalizeQuery(`${withIdentity}&timestamp=${stamp}`);
  const signature = md5(`${uifid}_${stamp}_${SALT}_${normalized}`);
  return `${normalized}&${SIGNATURE_PARAM}=${signature}`;
}

