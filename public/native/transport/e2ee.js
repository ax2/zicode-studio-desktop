// M3 端到端加密：Noise_XK_25519_ChaChaPoly_SHA256（手机侧发起方）。
//
// 与桌面侧 `src-tauri/src/e2ee.rs`（snow 0.9）逐字节兼容：手机在配对时带外
// 获得桌面静态公钥并固定，经中继 WebSocket 完成三段握手
// （`-> e, es` / `<- e, ee` / `-> s, se`），之后数据面全部封装为
// `e2ee_frame` 密文帧。所有原语均为同步纯 JS 实现（X25519 / ChaCha20-Poly1305
// / SHA-256 / HKDF），浏览器与 Node 通用，避免 WebCrypto 异步对同步
// `send()` 链路的侵入。

const E2EE_VERSION = 1;
export const E2EE_HANDSHAKE_TYPE = "e2ee_handshake";
export const E2EE_FRAME_TYPE = "e2ee_frame";

export const PROTOCOL_NAME = "Noise_XK_25519_ChaChaPoly_SHA256";
const EMPTY = new Uint8Array(0);

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

export function concatBytes(...chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeLittleEndian(value, length) {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    out[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

function decodeLittleEndian(bytes) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(message) {
  const bitLength = message.length * 8;
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;
  // SHA-256 的 64 位长度字段是大端序。
  const lengthBytes = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1) {
    lengthBytes[7 - index] = Number((BigInt(bitLength) >> BigInt(index * 8)) & 0xffn);
  }
  padded.set(lengthBytes, paddedLength - 8);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const base = offset + index * 4;
      w[index] =
        (padded[base] << 24) |
        (padded[base + 1] << 16) |
        (padded[base + 2] << 8) |
        padded[base + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        ((w[index - 15] >>> 7) | (w[index - 15] << 25)) ^
        ((w[index - 15] >>> 18) | (w[index - 15] << 14)) ^
        (w[index - 15] >>> 3);
      const s1 =
        ((w[index - 2] >>> 17) | (w[index - 2] << 15)) ^
        ((w[index - 2] >>> 19) | (w[index - 2] << 13)) ^
        (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + w[index]) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const words = [h0, h1, h2, h3, h4, h5, h6, h7];
  for (let index = 0; index < 8; index += 1) {
    digest[index * 4] = (words[index] >>> 24) & 0xff;
    digest[index * 4 + 1] = (words[index] >>> 16) & 0xff;
    digest[index * 4 + 2] = (words[index] >>> 8) & 0xff;
    digest[index * 4 + 3] = words[index] & 0xff;
  }
  return digest;
}

function hmacSha256(key, message) {
  let normalized = key;
  if (normalized.length > 64) normalized = sha256(normalized);
  const inner = new Uint8Array(64);
  const outer = new Uint8Array(64);
  inner.set(normalized);
  outer.set(normalized);
  for (let index = 0; index < 64; index += 1) {
    inner[index] ^= 0x36;
    outer[index] ^= 0x5c;
  }
  return sha256(concatBytes(outer, sha256(concatBytes(inner, message))));
}

export function hkdfSha256(salt, ikm, info, length) {
  const prk = hmacSha256(salt, ikm);
  let block = EMPTY;
  const out = new Uint8Array(length);
  let offset = 0;
  let counter = 1;
  while (offset < length) {
    block = hmacSha256(prk, concatBytes(block, info, new Uint8Array([counter])));
    out.set(block.subarray(0, Math.min(32, length - offset)), offset);
    offset += 32;
    counter += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// X25519（RFC 7748）
// ---------------------------------------------------------------------------

const P25519 = (1n << 255n) - 19n;
const A24 = 121665n;
const BASE_POINT = new Uint8Array(32);
BASE_POINT[0] = 9;

export function clampX25519Scalar(bytes) {
  const out = new Uint8Array(bytes);
  out[0] &= 248;
  out[31] &= 127;
  out[31] |= 64;
  return out;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  let factor = base % modulus;
  let remaining = exponent;
  while (remaining > 0n) {
    if (remaining & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    remaining >>= 1n;
  }
  return result;
}

function modInverse(value) {
  if (value === 0n) return 0n;
  return modPow(value, P25519 - 2n, P25519);
}

export function x25519(privateKey, publicKey) {
  const scalar = decodeLittleEndian(clampX25519Scalar(privateKey));
  const u = decodeLittleEndian(publicKey) % P25519;
  const x1 = u;
  let x2 = 1n;
  let z2 = 0n;
  let x3 = u;
  let z3 = 1n;
  let swap = 0n;
  for (let bit = 254; bit >= 0; bit -= 1) {
    const keyBit = (scalar >> BigInt(bit)) & 1n;
    swap ^= keyBit;
    if (swap) {
      [x2, x3] = [x3, x2];
      [z2, z3] = [z3, z2];
    }
    swap = keyBit;
    const a = (x2 + z2) % P25519;
    const aa = (a * a) % P25519;
    const b = (x2 - z2 + P25519) % P25519;
    const bb = (b * b) % P25519;
    const e = (aa - bb + P25519) % P25519;
    const c = (x3 + z3) % P25519;
    const d = (x3 - z3 + P25519) % P25519;
    const da = (d * a) % P25519;
    const cb = (c * b) % P25519;
    const daMinusCb = (da - cb + P25519) % P25519;
    x3 = (((da + cb) % P25519) * ((da + cb) % P25519)) % P25519;
    z3 = (x1 * ((daMinusCb * daMinusCb) % P25519)) % P25519;
    x2 = (aa * bb) % P25519;
    z2 = (e * ((aa + A24 * e) % P25519)) % P25519;
  }
  if (swap) {
    [x2, x3] = [x3, x2];
    [z2, z3] = [z3, z2];
  }
  const result = (x2 * modInverse(z2)) % P25519;
  return encodeLittleEndian(result, 32);
}

export function generateX25519KeyPair() {
  const privateKey = clampX25519Scalar(crypto.getRandomValues(new Uint8Array(32)));
  return { privateKey, publicKey: x25519(privateKey, BASE_POINT) };
}

// ---------------------------------------------------------------------------
// ChaCha20-Poly1305（RFC 8439）
// ---------------------------------------------------------------------------

function rotl32(value, shift) {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function chacha20QuarterRound(state, a, b, c, d) {
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl32(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl32(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b]) >>> 0;
  state[d] = rotl32(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotl32(state[b] ^ state[c], 7);
}

function chacha20Block(key, counter, nonce) {
  const state = new Uint32Array(16);
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;
  for (let index = 0; index < 8; index += 1) {
    state[4 + index] =
      key[index * 4] |
      (key[index * 4 + 1] << 8) |
      (key[index * 4 + 2] << 16) |
      (key[index * 4 + 3] << 24);
  }
  state[12] = counter >>> 0;
  for (let index = 0; index < 3; index += 1) {
    state[13 + index] =
      nonce[index * 4] |
      (nonce[index * 4 + 1] << 8) |
      (nonce[index * 4 + 2] << 16) |
      (nonce[index * 4 + 3] << 24);
  }
  const working = new Uint32Array(state);
  for (let round = 0; round < 10; round += 1) {
    chacha20QuarterRound(working, 0, 4, 8, 12);
    chacha20QuarterRound(working, 1, 5, 9, 13);
    chacha20QuarterRound(working, 2, 6, 10, 14);
    chacha20QuarterRound(working, 3, 7, 11, 15);
    chacha20QuarterRound(working, 0, 5, 10, 15);
    chacha20QuarterRound(working, 1, 6, 11, 12);
    chacha20QuarterRound(working, 2, 7, 8, 13);
    chacha20QuarterRound(working, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let index = 0; index < 16; index += 1) {
    const value = (working[index] + state[index]) >>> 0;
    out[index * 4] = value & 0xff;
    out[index * 4 + 1] = (value >>> 8) & 0xff;
    out[index * 4 + 2] = (value >>> 16) & 0xff;
    out[index * 4 + 3] = (value >>> 24) & 0xff;
  }
  return out;
}

function chacha20Xor(key, nonce, data, initialCounter) {
  const out = new Uint8Array(data.length);
  let counter = initialCounter;
  for (let offset = 0; offset < data.length; offset += 64) {
    const block = chacha20Block(key, counter, nonce);
    counter += 1;
    for (let index = 0; index < 64 && offset + index < data.length; index += 1) {
      out[offset + index] = data[offset + index] ^ block[index];
    }
  }
  return out;
}

const P1305 = (1n << 130n) - 5n;

function poly1305(key, message) {
  const r = decodeLittleEndian(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = decodeLittleEndian(key.subarray(16, 32));
  let accumulator = 0n;
  let offset = 0;
  while (offset < message.length) {
    const block = message.subarray(offset, offset + 16);
    const padded = new Uint8Array(17);
    padded.set(block);
    padded[block.length] = 1;
    accumulator = (((accumulator + decodeLittleEndian(padded)) % P1305) * r) % P1305;
    offset += 16;
  }
  return encodeLittleEndian((accumulator + s) % (1n << 128n), 16);
}

function le64(value) {
  return encodeLittleEndian(BigInt(value), 8);
}

function pad16(bytes) {
  const remainder = bytes.length % 16;
  return remainder === 0 ? EMPTY : new Uint8Array(16 - remainder);
}

function poly1305MacInput(aad, ciphertext) {
  return concatBytes(
    aad,
    pad16(aad),
    ciphertext,
    pad16(ciphertext),
    le64(aad.length),
    le64(ciphertext.length),
  );
}

export function chacha20Poly1305Encrypt(key, nonce, plaintext, aad = EMPTY) {
  const ciphertext = chacha20Xor(key, nonce, plaintext, 1);
  const macKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  const tag = poly1305(macKey, poly1305MacInput(aad, ciphertext));
  return concatBytes(ciphertext, tag);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

export function chacha20Poly1305Decrypt(key, nonce, ciphertextWithTag, aad = EMPTY) {
  if (ciphertextWithTag.length < 16) throw new Error("E2EE ciphertext is too short");
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const macKey = chacha20Block(key, 0, nonce).subarray(0, 32);
  const expected = poly1305(macKey, poly1305MacInput(aad, ciphertext));
  if (!constantTimeEqual(tag, expected)) throw new Error("E2EE authentication failed");
  return chacha20Xor(key, nonce, ciphertext, 1);
}

// ---------------------------------------------------------------------------
// Noise_XK 发起方
// ---------------------------------------------------------------------------

function noiseNonce(counter) {
  // snow 的 ChaChaPoly 实现用 `nonce.to_le_bytes()` 填充 nonce_bytes[4..]。
  const nonce = new Uint8Array(12);
  for (let index = 0; index < 8; index += 1) {
    nonce[4 + index] = Number((BigInt(counter) >> BigInt(index * 8)) & 0xffn);
  }
  return nonce;
}

export class NoiseXkInitiator {
  #ck;
  #key = null;
  #nonce = 0;
  #h;
  #remoteStatic;
  #ephemeral;
  #staticKey;
  #sendKey;
  #receiveKey;
  #sendNonce = 0;
  #receiveNonce = 0;
  #done = false;

  constructor(remoteStaticPublic, { staticKey, ephemeral, prologue = EMPTY } = {}) {
    // Noise：协议名长度 <= 哈希长度(32) 时直接使用原始字节，否则取哈希。
    // "Noise_XK_25519_ChaChaPoly_SHA256" 恰好 32 字节。
    const protocolName = utf8Bytes(PROTOCOL_NAME);
    const protocolHash = protocolName.length <= 32 ? protocolName : sha256(protocolName);
    this.#ck = protocolHash;
    this.#h = protocolHash;
    this.#h = sha256(concatBytes(this.#h, prologue));
    this.#remoteStatic = remoteStaticPublic;
    // 预消息：响应方静态公钥
    this.#h = sha256(concatBytes(this.#h, remoteStaticPublic));
    this.#ephemeral = ephemeral ?? null;
    this.#staticKey = staticKey ?? null;
  }

  #mixHash(data) {
    this.#h = sha256(concatBytes(this.#h, data));
  }

  #mixKey(input) {
    const derived = hkdfSha256(this.#ck, input, EMPTY, 64);
    this.#ck = derived.subarray(0, 32);
    this.#key = derived.subarray(32, 64);
    this.#nonce = 0;
  }

  #encryptAndMixHash(plaintext) {
    const ciphertext = chacha20Poly1305Encrypt(
      this.#key,
      noiseNonce(this.#nonce),
      plaintext,
      this.#h,
    );
    this.#nonce += 1;
    this.#mixHash(ciphertext);
    return ciphertext;
  }

  #decryptAndMixHash(ciphertext) {
    const plaintext = chacha20Poly1305Decrypt(
      this.#key,
      noiseNonce(this.#nonce),
      ciphertext,
      this.#h,
    );
    this.#nonce += 1;
    this.#mixHash(ciphertext);
    return plaintext;
  }

  /**
   * 第一帧：`-> e, es`。返回 48 字节（e 公钥 + 空负载密文）。
   */
  begin(payload = EMPTY) {
    if (this.#done) throw new Error("E2EE handshake is already finished");
    if (!this.#ephemeral) this.#ephemeral = generateX25519KeyPair();
    this.#mixHash(this.#ephemeral.publicKey);
    this.#mixKey(x25519(this.#ephemeral.privateKey, this.#remoteStatic));
    return concatBytes(this.#ephemeral.publicKey, this.#encryptAndMixHash(payload));
  }

  /**
   * 处理第二帧 `<- e, ee`，返回第三帧 `-> s, se`（64 字节）。
   */
  advance(message, payload = EMPTY) {
    if (this.#done) throw new Error("E2EE handshake is already finished");
    if (message.length < 48) throw new Error("E2EE handshake message is too short");
    const remoteEphemeral = message.subarray(0, 32);
    const ciphertext = message.subarray(32);
    this.#mixHash(remoteEphemeral);
    this.#mixKey(x25519(this.#ephemeral.privateKey, remoteEphemeral));
    this.#decryptAndMixHash(ciphertext);

    if (!this.#staticKey) this.#staticKey = generateX25519KeyPair();
    const encryptedStatic = this.#encryptAndMixHash(this.#staticKey.publicKey);
    this.#mixKey(x25519(this.#staticKey.privateKey, remoteEphemeral));
    const encryptedPayload = this.#encryptAndMixHash(payload);

    const split = hkdfSha256(this.#ck, EMPTY, EMPTY, 64);
    this.#sendKey = split.subarray(0, 32);
    this.#receiveKey = split.subarray(32, 64);
    this.#sendNonce = 0;
    this.#receiveNonce = 0;
    this.#done = true;
    return concatBytes(encryptedStatic, encryptedPayload);
  }

  handshakeHash() {
    return this.#h;
  }

  encrypt(plaintext) {
    if (!this.#done) throw new Error("E2EE transport is not ready");
    const nonce = noiseNonce(this.#sendNonce);
    this.#sendNonce += 1;
    return chacha20Poly1305Encrypt(this.#sendKey, nonce, plaintext);
  }

  decrypt(ciphertext) {
    if (!this.#done) throw new Error("E2EE transport is not ready");
    const nonce = noiseNonce(this.#receiveNonce);
    this.#receiveNonce += 1;
    return chacha20Poly1305Decrypt(this.#receiveKey, nonce, ciphertext);
  }

  isReady() {
    return this.#done;
  }
}

/// Noise_XK 响应方（桌面侧逻辑的 JS 镜像，用于测试闭环与协议对照）。
export class NoiseXkResponder {
  #ck;
  #key = null;
  #nonce = 0;
  #h;
  #staticKey;
  #ephemeral;
  #sendKey;
  #receiveKey;
  #sendNonce = 0;
  #receiveNonce = 0;
  #done = false;

  constructor(staticKeyPair, { ephemeral, prologue = EMPTY } = {}) {
    const protocolName = utf8Bytes(PROTOCOL_NAME);
    const protocolHash = protocolName.length <= 32 ? protocolName : sha256(protocolName);
    this.#ck = protocolHash;
    this.#h = protocolHash;
    this.#h = sha256(concatBytes(this.#h, prologue));
    this.#staticKey = staticKeyPair;
    this.#h = sha256(concatBytes(this.#h, staticKeyPair.publicKey));
    this.#ephemeral = ephemeral ?? null;
  }

  #mixHash(data) {
    this.#h = sha256(concatBytes(this.#h, data));
  }

  #mixKey(input) {
    const derived = hkdfSha256(this.#ck, input, EMPTY, 64);
    this.#ck = derived.subarray(0, 32);
    this.#key = derived.subarray(32, 64);
    this.#nonce = 0;
  }

  #encryptAndMixHash(plaintext) {
    const ciphertext = chacha20Poly1305Encrypt(
      this.#key,
      noiseNonce(this.#nonce),
      plaintext,
      this.#h,
    );
    this.#nonce += 1;
    this.#mixHash(ciphertext);
    return ciphertext;
  }

  #decryptAndMixHash(ciphertext) {
    const plaintext = chacha20Poly1305Decrypt(
      this.#key,
      noiseNonce(this.#nonce),
      ciphertext,
      this.#h,
    );
    this.#nonce += 1;
    this.#mixHash(ciphertext);
    return plaintext;
  }

  accept(message, payload = EMPTY) {
    if (this.#done) throw new Error("E2EE handshake is already finished");
    if (message.length < 48) throw new Error("E2EE handshake message is too short");
    const remoteEphemeral = message.subarray(0, 32);
    const ciphertext = message.subarray(32);
    this.#mixHash(remoteEphemeral);
    this.#mixKey(x25519(this.#staticKey.privateKey, remoteEphemeral));
    this.#decryptAndMixHash(ciphertext);

    if (!this.#ephemeral) this.#ephemeral = generateX25519KeyPair();
    this.#mixHash(this.#ephemeral.publicKey);
    this.#mixKey(x25519(this.#ephemeral.privateKey, remoteEphemeral));
    return concatBytes(this.#ephemeral.publicKey, this.#encryptAndMixHash(payload));
  }

  finish(message) {
    if (this.#done) throw new Error("E2EE handshake is already finished");
    if (message.length < 64) throw new Error("E2EE handshake message is too short");
    const encryptedStatic = message.subarray(0, 48);
    const payload = message.subarray(48);
    const staticPublic = this.#decryptAndMixHash(encryptedStatic);
    this.#mixKey(x25519(this.#ephemeral.privateKey, staticPublic));
    this.#decryptAndMixHash(payload);

    const split = hkdfSha256(this.#ck, EMPTY, EMPTY, 64);
    this.#receiveKey = split.subarray(0, 32);
    this.#sendKey = split.subarray(32, 64);
    this.#done = true;
  }

  handshakeHash() {
    return this.#h;
  }

  decrypt(ciphertext) {
    if (!this.#done) throw new Error("E2EE transport is not ready");
    const nonce = noiseNonce(this.#receiveNonce);
    this.#receiveNonce += 1;
    return chacha20Poly1305Decrypt(this.#receiveKey, nonce, ciphertext);
  }

  encrypt(plaintext) {
    if (!this.#done) throw new Error("E2EE transport is not ready");
    const nonce = noiseNonce(this.#sendNonce);
    this.#sendNonce += 1;
    return chacha20Poly1305Encrypt(this.#sendKey, nonce, plaintext);
  }

  isReady() {
    return this.#done;
  }
}

// ---------------------------------------------------------------------------
// 帧封装（与 `src-tauri/src/e2ee.rs` 一致）
// ---------------------------------------------------------------------------

export function handshakeFrame(message) {
  return JSON.stringify({
    type: E2EE_HANDSHAKE_TYPE,
    v: E2EE_VERSION,
    msg: bytesToBase64(message),
  });
}

export function parseHandshakeFrame(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value?.type !== E2EE_HANDSHAKE_TYPE || typeof value.msg !== "string") return null;
  try {
    return base64ToBytes(value.msg);
  } catch {
    return null;
  }
}

export function e2eeFrame(payload) {
  return JSON.stringify({
    type: E2EE_FRAME_TYPE,
    v: E2EE_VERSION,
    data: bytesToBase64(payload),
  });
}

export function parseE2eeFrame(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value?.type !== E2EE_FRAME_TYPE || typeof value.data !== "string") return null;
  try {
    return base64ToBytes(value.data);
  } catch {
    return null;
  }
}
