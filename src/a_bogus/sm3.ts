/**
 * 国密 SM3 哈希算法 - 纯 TypeScript 实现
 * 适配自 gmssl.sm3，用于 a_bogus 签名中 generate_method_code / generate_params_code。
 */

function rotl(x: number, n: number): number {
  x &= 0xffffffff;
  return ((x << n) | (x >>> (32 - n))) & 0xffffffff;
}

function sm3_ff(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) & 0xffffffff;
  return ((x | y) & (x | z) & (y | z)) & 0xffffffff;
}

function sm3_gg(j: number, x: number, y: number, z: number): number {
  if (j < 16) return (x ^ y ^ z) & 0xffffffff;
  return ((x & y) | (~x & z)) & 0xffffffff;
}

function sm3_p0(x: number): number {
  return (x ^ rotl(x, 9) ^ rotl(x, 17)) & 0xffffffff;
}

function sm3_p1(x: number): number {
  return (x ^ rotl(x, 15) ^ rotl(x, 23)) & 0xffffffff;
}

const SM3_IV = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];

const SM3_T: number[] = new Array(64);
for (let i = 0; i < 64; i++) {
  SM3_T[i] = i < 16 ? 0x79cc4519 : 0x7a879d8a;
}

/** 输入 bytes，输出 32 字节 hash。 */
export function sm3Hash(bytes: Uint8Array): Uint8Array {
  const msgLen = bytes.length;
  const bitLen = msgLen * 8;

  // 填充
  const padLen = 64 - ((msgLen + 9) % 64);
  const totalLen = msgLen + 1 + padLen + 8;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes, 0);
  padded[msgLen] = 0x80;

  // 长度（bits）大端 64-bit
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000) >>> 0, false);

  let iv = [...SM3_IV];

  for (let offset = 0; offset < totalLen; offset += 64) {
    const w = new Array(68);
    for (let j = 0; j < 16; j++) {
      w[j] = view.getUint32(offset + j * 4, false);
    }
    for (let j = 16; j < 68; j++) {
      w[j] = (sm3_p1(w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15)) ^ rotl(w[j - 13], 7) ^ w[j - 6]) & 0xffffffff;
    }
    const w1 = new Array(64);
    for (let j = 0; j < 64; j++) {
      w1[j] = (w[j] ^ w[j + 4]) & 0xffffffff;
    }

    let [a, b, c, d, e, f, g, h] = iv;
    for (let j = 0; j < 64; j++) {
      const t = SM3_T[j];
      const ss1 = rotl((rotl(a, 12) + e + rotl(t, j % 32)) & 0xffffffff, 7);
      const ss2 = (ss1 ^ rotl(a, 12)) & 0xffffffff;
      const tt1 = (sm3_ff(j, a, b, c) + d + ss2 + w1[j]) & 0xffffffff;
      const tt2 = (sm3_gg(j, e, f, g) + h + ss1 + w[j]) & 0xffffffff;
      d = c;
      c = rotl(b, 9);
      b = a;
      a = tt1;
      h = g;
      g = rotl(f, 19);
      f = e;
      e = sm3_p0(tt2);
    }
    iv[0] = (iv[0] ^ a) & 0xffffffff;
    iv[1] = (iv[1] ^ b) & 0xffffffff;
    iv[2] = (iv[2] ^ c) & 0xffffffff;
    iv[3] = (iv[3] ^ d) & 0xffffffff;
    iv[4] = (iv[4] ^ e) & 0xffffffff;
    iv[5] = (iv[5] ^ f) & 0xffffffff;
    iv[6] = (iv[6] ^ g) & 0xffffffff;
    iv[7] = (iv[7] ^ h) & 0xffffffff;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 4, iv[i], false);
  }
  return out;
}
