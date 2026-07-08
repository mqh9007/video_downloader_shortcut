/**
 * a_bogus 签名器 - TypeScript 移植
 * 适配自 backend/app/douyin_abogus.py（基于 JoeanAmier/TikTokDownloader）。
 *
 * 用法：
 *   import { signUrl } from "./a_bogus";
 *   const aBogus = signUrl(queryString, userAgent); // 返回 a_bogus=xxx
 */

import { sm3Hash } from "./sm3";

const S0 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const S1 = "Dkdpgh4ZKsQB80/Mfvw36XI1R25+WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=";
const S2 = "Dkdpgh4ZKsQB80/Mfvw36XI1R25-WUAlEi7NLboqYTOPuzmFjJnryx9HVGcaStCe=";
const S3 = "ckdp1h4ZKsUB80/Mfvw36XIgR25+WQAlEi7NLboqYTOPuzmFjJnryx9HVGDaStCe";
const S4 = "Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnryx9HbGcaStCe";

const ALPHABETS = { s0: S0, s1: S1, s2: S2, s3: S3, s4: S4 } as const;

const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const UA_KEY = "\x00\x01\x0e";
const END_STRING = "cus";
const BROWSER_INFO = "1536|742|1536|864|0|0|0|0|1536|864|1536|864|1536|742|24|24|Win32";

const REG_INIT = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

// 保留备用：ARGUMENTS 是算法原始参数
// const ARGUMENTS = [0, 1, 14];

function de(e: number, r: number): number {
  r %= 32;
  return ((e << r) | (e >>> (32 - r))) & 0xffffffff;
}

function pe(e: number): number {
  return 0 <= e && e < 16 ? 0x79cc4519 : 0x7a879d8a;
}

function he(e: number, r: number, t: number, n: number): number {
  if (0 <= e && e < 16) return (r ^ t ^ n) & 0xffffffff;
  if (16 <= e && e < 64) return ((r & t) | (r & n) | (t & n)) & 0xffffffff;
  throw new Error("Invalid e");
}

function ve(e: number, r: number, t: number, n: number): number {
  if (0 <= e && e < 16) return (r ^ t ^ n) & 0xffffffff;
  if (16 <= e && e < 64) return ((r & t) | (~r & n)) & 0xffffffff;
  throw new Error("Invalid e");
}

function generateF(e: number[]): number[] {
  const r = new Array(132).fill(0);
  for (let t = 0; t < 16; t++) {
    r[t] = ((e[4 * t] << 24) | (e[4 * t + 1] << 16) | (e[4 * t + 2] << 8) | e[4 * t + 3]) & 0xffffffff;
  }
  for (let n = 16; n < 68; n++) {
    let a = (r[n - 16] ^ r[n - 9] ^ de(r[n - 3], 15)) & 0xffffffff;
    a = (a ^ de(a, 15) ^ de(a, 23)) & 0xffffffff;
    r[n] = (a ^ de(r[n - 13], 7) ^ r[n - 6]) & 0xffffffff;
  }
  for (let n = 68; n < 132; n++) {
    r[n] = (r[n - 68] ^ r[n - 64]) & 0xffffffff;
  }
  return r;
}

function regToArray(a: number[]): number[] {
  const o = new Array(32).fill(0);
  for (let i = 0; i < 8; i++) {
    let c = a[i];
    o[4 * i + 3] = c & 255;
    c >>>= 8;
    o[4 * i + 2] = c & 255;
    c >>>= 8;
    o[4 * i + 1] = c & 255;
    c >>>= 8;
    o[4 * i] = c & 255;
  }
  return o;
}

function rc4Encrypt(plaintext: string, key: string): string {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  j = 0;
  const cipher: string[] = [];
  for (let k = 0; k < plaintext.length; k++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    [s[i], s[j]] = [s[j], s[i]];
    const t = (s[i] + s[j]) % 256;
    cipher.push(String.fromCharCode(s[t] ^ plaintext.charCodeAt(k)));
  }
  return cipher.join("");
}

function sm3ToBytes(data: string | number[]): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return new Uint8Array(data);
}

function sm3Hex(data: string | number[]): string {
  const hash = sm3Hash(sm3ToBytes(data));
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sm3ToArray(data: string | number[]): number[] {
  const hex = sm3Hex(data);
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

function charCodeAt(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

function fromCharCode(...codes: number[]): string {
  return String.fromCharCode(...codes);
}

function randomList(randomNum: number | null, b = 170, c = 85, d = 0, e = 0, f = 0, g = 0): number[] {
  const r = randomNum ?? Math.random() * 10000;
  const v = [r, Math.floor(r) & 255, Math.floor(r) >> 8];
  v.push((v[1] & b) | d);
  v.push((v[1] & c) | e);
  v.push((v[2] & b) | f);
  v.push((v[2] & c) | g);
  return v.slice(-4);
}

function list1(randomNum: number | null, a = 170, b = 85, c = 45): number[] {
  return randomList(randomNum, a, b, 1, 2, 5, c & a);
}

function list2(randomNum: number | null, a = 170, b = 85): number[] {
  return randomList(randomNum, a, b, 1, 0, 0, 0);
}

function list3(randomNum: number | null, a = 170, b = 85): number[] {
  return randomList(randomNum, a, b, 1, 0, 5, 0);
}

function generateString1(r1: number | null, r2: number | null, r3: number | null): string {
  return fromCharCode(...list1(r1)) + fromCharCode(...list2(r2)) + fromCharCode(...list3(r3));
}

function list4(
  a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number,
  i: number, j: number, k: number, m: number, n: number, o: number, p: number, q: number, r: number,
): number[] {
  return [
    44, a, 0, 0, 0, 0, 24, b, n, 0, c, d, 0, 0, 0, 1, 0, 239, e, o, f, g, 0, 0, 0, 0, h, 0, 0, 14,
    i, j, 0, k, m, 3, p, 1, q, 1, r, 0, 0, 0,
  ];
}

function endCheckNum(a: number[]): number {
  return a.reduce((r, i) => r ^ i, 0);
}

// 保留备用：generateResultUnit 是算法原始单字符编码函数
// function generateResultUnit(n: number, s: keyof typeof ALPHABETS): string { ... }

function generateResult(s: string, e: keyof typeof ALPHABETS = "s4"): string {
  const r: string[] = [];
  for (let i = 0; i < s.length; i += 3) {
    let n: number;
    if (i + 2 < s.length) {
      n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8) | s.charCodeAt(i + 2);
    } else if (i + 1 < s.length) {
      n = (s.charCodeAt(i) << 16) | (s.charCodeAt(i + 1) << 8);
    } else {
      n = s.charCodeAt(i) << 16;
    }
    const masks = [0x0fc0000, 0x003f000, 0x0000fc0, 0x000003f];
    const shifts = [18, 12, 6, 0];
    for (let j = 0; j < 4; j++) {
      if (j === 2 && i + 1 >= s.length) break;
      if (j === 3 && i + 2 >= s.length) break;
      r.push(ALPHABETS[e][(n & masks[j]) >> shifts[j]]);
    }
  }
  r.push("=".repeat((4 - (r.length % 4)) % 4));
  return r.join("");
}

// 保留备用：generateArgsCode 是算法原始参数编码函数
// function generateArgsCode(): number[] { ... }

class ABogus {
  private chunk: number[] = [];
  private size = 0;
  private reg = [...REG_INIT];
  private uaCode: number[];
  private browser: string;
  private browserLen: number;
  private browserCode: number[];

  constructor(userAgent: string = DEFAULT_UA) {
    this.uaCode = this.generateUaCode(userAgent);
    this.browser = BROWSER_INFO;
    this.browserLen = this.browser.length;
    this.browserCode = charCodeAt(this.browser);
  }

  private generateUaCode(userAgent: string): number[] {
    const u = rc4Encrypt(userAgent, UA_KEY);
    const result = generateResult(u, "s3");
    return this.sum(charCodeAt(result));
  }

  private compress(a: number[]): void {
    const f = generateF(a);
    const i = [...this.reg];
    for (let o = 0; o < 64; o++) {
      const c = (de(i[0], 12) + i[4] + de(pe(o), o)) & 0xffffffff;
      const cRot = de(c, 7);
      const s = (cRot ^ de(i[0], 12)) & 0xffffffff;

      const u = (he(o, i[0], i[1], i[2]) + i[3] + s + f[o + 68]) & 0xffffffff;
      const b = (ve(o, i[4], i[5], i[6]) + i[7] + c + f[o]) & 0xffffffff;

      i[3] = i[2];
      i[2] = de(i[1], 9);
      i[1] = i[0];
      i[0] = u;
      i[7] = i[6];
      i[6] = de(i[5], 19);
      i[5] = i[4];
      i[4] = (b ^ de(b, 9) ^ de(b, 17)) & 0xffffffff;
    }
    for (let l = 0; l < 8; l++) {
      this.reg[l] = (this.reg[l] ^ i[l]) & 0xffffffff;
    }
  }

  private padArray(arr: number[], length = 60): number[] {
    while (arr.length < length) arr.push(0);
    return arr;
  }

  private fill(length = 60): void {
    const size = 8 * this.size;
    this.chunk.push(128);
    this.chunk = this.padArray(this.chunk, length);
    for (let i = 0; i < 4; i++) {
      this.chunk.push((size >>> (8 * (3 - i))) & 255);
    }
  }

  private write(e: string | number[]): void {
    this.size = typeof e === "string" ? e.length : e.length;
    let arr: number[];
    if (typeof e === "string") {
      arr = charCodeAt(e);
    } else {
      arr = e;
    }
    if (arr.length <= 64) {
      this.chunk = arr;
    } else {
      const chunks: number[][] = [];
      for (let i = 0; i < arr.length; i += 64) chunks.push(arr.slice(i, i + 64));
      for (const c of chunks.slice(0, -1)) this.compress(c);
      this.chunk = chunks[chunks.length - 1];
    }
  }

  private reset(): void {
    this.chunk = [];
    this.size = 0;
    this.reg = [...REG_INIT];
  }

  private sum(e: number[], length = 60): number[] {
    this.reset();
    this.write(e);
    this.fill(length);
    this.compress(this.chunk);
    return regToArray(this.reg);
  }

  private generateMethodCode(method: string): number[] {
    return sm3ToArray(sm3ToArray(method + END_STRING));
  }

  private generateParamsCode(params: string): number[] {
    return sm3ToArray(sm3ToArray(params + END_STRING));
  }

  private generateString2List(
    urlParams: string,
    method: string,
    startTime: number,
    endTime: number,
  ): number[] {
    const paramsArray = this.generateParamsCode(urlParams);
    const methodArray = this.generateMethodCode(method);
    return list4(
      (endTime >> 24) & 255, paramsArray[21], this.uaCode[23],
      (endTime >> 16) & 255, paramsArray[22], this.uaCode[24],
      (endTime >> 8) & 255, endTime & 255,
      (startTime >> 24) & 255, (startTime >> 16) & 255, (startTime >> 8) & 255, startTime & 255,
      methodArray[21], methodArray[22],
      Math.floor(endTime / 256 / 256 / 256 / 256),
      Math.floor(startTime / 256 / 256 / 256 / 256),
      this.browserLen,
    );
  }

  private generateString2(urlParams: string, method: string, startTime: number, endTime: number): string {
    const a = this.generateString2List(urlParams, method, startTime, endTime);
    const e = endCheckNum(a);
    a.push(...this.browserCode);
    a.push(e);
    return rc4Encrypt(fromCharCode(...a), "y");
  }

  get(urlParams: string, method = "GET"): string {
    const startTime = Date.now();
    const endTime = startTime + Math.floor(Math.random() * 5) + 4;
    const r1 = Math.random() * 10000;
    const r2 = Math.random() * 10000;
    const r3 = Math.random() * 10000;
    const string1 = generateString1(r1, r2, r3);
    const string2 = this.generateString2(urlParams, method, startTime, endTime);
    return generateResult(string1 + string2, "s4");
  }
}

/** 便捷函数：给定 query string + UA，返回 a_bogus 签名值。 */
export function signUrl(queryString: string, userAgent: string = DEFAULT_UA): string {
  const signer = new ABogus(userAgent);
  return signer.get(queryString);
}
