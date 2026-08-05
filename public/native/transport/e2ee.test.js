import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  chacha20Poly1305Decrypt,
  chacha20Poly1305Encrypt,
  e2eeFrame,
  generateX25519KeyPair,
  handshakeFrame,
  NoiseXkInitiator,
  NoiseXkResponder,
  parseE2eeFrame,
  parseHandshakeFrame,
  sha256,
  utf8Bytes,
  x25519,
} from "./e2ee.js";

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("SHA-256", () => {
  it("matches NIST vectors", () => {
    expect(bytesToHex(sha256(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(bytesToHex(sha256(utf8Bytes("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      bytesToHex(sha256(utf8Bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });
});

describe("X25519", () => {
  it("matches RFC 7748 section 6.1", () => {
    const alicePrivate = hexToBytes(
      "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
    );
    const alicePublic = hexToBytes(
      "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
    );
    const bobPrivate = hexToBytes(
      "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb",
    );
    const bobPublic = hexToBytes(
      "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
    );
    const shared = hexToBytes("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");

    expect(bytesToHex(x25519(alicePrivate, bobPublic))).toBe(bytesToHex(shared));
    expect(bytesToHex(x25519(bobPrivate, alicePublic))).toBe(bytesToHex(shared));
    expect(bytesToHex(x25519(alicePrivate, alicePublic))).not.toBe(bytesToHex(shared));
  });
});

describe("ChaCha20-Poly1305", () => {
  it("matches RFC 8439 section 2.8.2", () => {
    const key = hexToBytes("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
    const nonce = hexToBytes("070000004041424344454647");
    const aad = hexToBytes("50515253c0c1c2c3c4c5c6c7");
    const plaintext = utf8Bytes(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const expectedCiphertext =
      "d31a8d34648e60db7b86afbc53ef7ec2a4aded51296e08fea9e2b5a736ee62d63dbea45e8ca9671282fafb69da92728b1a71de0a9e060b2905d6a5b67ecd3b3692ddbd7f2d778b8c9803aee328091b58fab324e4fad675945585808b4831d7bc3ff4def08e4b7a9de576d26586cec64b6116";
    const expectedTag = "1ae10b594f09e26a7e902ecbd0600691";

    const sealed = chacha20Poly1305Encrypt(key, nonce, plaintext, aad);
    expect(bytesToHex(sealed.subarray(0, sealed.length - 16))).toBe(expectedCiphertext);
    expect(bytesToHex(sealed.subarray(sealed.length - 16))).toBe(expectedTag);
    expect(bytesToHex(chacha20Poly1305Decrypt(key, nonce, sealed, aad))).toBe(
      bytesToHex(plaintext),
    );
    const tampered = new Uint8Array(sealed);
    tampered[0] ^= 1;
    expect(() => chacha20Poly1305Decrypt(key, nonce, tampered, aad)).toThrow(
      "authentication failed",
    );
  });
});

describe("Noise_XK initiator", () => {
  it("completes a handshake and exchanges encrypted messages with a responder", () => {
    const responderKey = generateX25519KeyPair();
    const initiator = new NoiseXkInitiator(responderKey.publicKey);
    const responder = new NoiseXkResponder(responderKey);

    const first = initiator.begin();
    expect(first).toHaveLength(48);
    const second = responder.accept(first);
    expect(second).toHaveLength(48);
    const third = initiator.advance(second);
    expect(third).toHaveLength(64);
    responder.finish(third);
    expect(initiator.isReady()).toBe(true);
    expect(responder.isReady()).toBe(true);

    const hello = utf8Bytes('{"type":"hello","deviceToken":"secret-token"}');
    const toDesktop = initiator.encrypt(hello);
    expect(bytesToHex(toDesktop)).not.toContain(bytesToHex(hello));
    expect(bytesToHex(responder.decrypt(toDesktop))).toBe(bytesToHex(hello));

    const ack = utf8Bytes('{"type":"hello_ack"}');
    const toPhone = responder.encrypt(ack);
    expect(bytesToHex(initiator.decrypt(toPhone))).toBe(bytesToHex(ack));
  });

  it("rejects a wrong pinned static key at the first message", () => {
    const wrongKey = generateX25519KeyPair();
    const initiator = new NoiseXkInitiator(wrongKey.publicKey);
    const responder = new NoiseXkResponder(generateX25519KeyPair());
    expect(() => responder.accept(initiator.begin())).toThrow("authentication failed");
  });

  it("matches the official cacophony Noise_XK test vector byte for byte", () => {
    const vector = {
      prologue: "4a6f686e2047616c74",
      initStatic: "e61ef9919cde45dd5f82166404bd08e38bceb5dfdfded0a34c8df7ed542214d1",
      initEphemeral: "893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a",
      remoteStatic: "31e0303fd6418d2f8c0e78b91f22e8caed0fbe48656dcf4767e4834f701b8f62",
      respStatic: "4a3acbfdb163dec651dfa3194dece676d437029c62a408b4c5ea9114246e4893",
      respEphemeral: "bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b",
      handshakeHash: "cefffc5d1074126cc980ebfe902587ff36ba61dc77d4447ebe0f96dc22ae59d7",
      messages: [
        {
          payload: "4c756477696720766f6e204d69736573",
          ciphertext:
            "ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944a3785af283c991bab613473804356ef6931f83acf64f99c274b93570857cfc5e",
        },
        {
          payload: "4d757272617920526f746862617264",
          ciphertext:
            "95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088433a4534805fa9fe4eb8343ace6609160c767ad9b832e8eea1d9b7a2111818dd",
        },
        {
          payload: "462e20412e20486179656b",
          ciphertext:
            "5d8e67b9c1b8e36f5dc674bc5cd2ce243fb5d1710fa57de0370da7cc979015398eaad94603b05498ba9a613d2fd923dcaa6fd4288dfd8d70f419bf737efb4cd37f5da37ebb728849318c82",
        },
        {
          payload: "4361726c204d656e676572",
          ciphertext: "3205e1265f809505e6edc092839d3156745d2abafbfd946b261e41",
        },
        {
          payload: "4a65616e2d426170746973746520536179",
          ciphertext: "470bcb1ae099555ff0d729500df550418d6ee5149d9e40bd2f4c6b3d263cc818d5",
        },
      ],
    };
    const hex = (value) => hexToBytes(value);
    const prologue = hex(vector.prologue);
    const basePoint = new Uint8Array(32);
    basePoint[0] = 9;
    const initStatic = { privateKey: hex(vector.initStatic) };
    initStatic.publicKey = x25519(initStatic.privateKey, basePoint);
    const initEphemeral = { privateKey: hex(vector.initEphemeral) };
    initEphemeral.publicKey = x25519(initEphemeral.privateKey, basePoint);
    const respStatic = { privateKey: hex(vector.respStatic) };
    respStatic.publicKey = x25519(respStatic.privateKey, basePoint);
    const respEphemeral = { privateKey: hex(vector.respEphemeral) };
    respEphemeral.publicKey = x25519(respEphemeral.privateKey, basePoint);

    const initiator = new NoiseXkInitiator(hex(vector.remoteStatic), {
      staticKey: initStatic,
      ephemeral: initEphemeral,
      prologue,
    });
    const responder = new NoiseXkResponder(respStatic, {
      ephemeral: respEphemeral,
      prologue,
    });

    const msg0 = initiator.begin(hex(vector.messages[0].payload));
    expect(bytesToHex(msg0)).toBe(vector.messages[0].ciphertext);
    const msg1 = responder.accept(msg0, hex(vector.messages[1].payload));
    expect(bytesToHex(msg1)).toBe(vector.messages[1].ciphertext);
    const msg2 = initiator.advance(msg1, hex(vector.messages[2].payload));
    expect(bytesToHex(msg2)).toBe(vector.messages[2].ciphertext);
    responder.finish(msg2);
    expect(bytesToHex(initiator.handshakeHash())).toBe(vector.handshakeHash);
    expect(bytesToHex(responder.handshakeHash())).toBe(vector.handshakeHash);

    // 传输阶段消息交替：i=3（Carl Menger）由响应方发出，i=4（Jean-Baptiste
    // Say）由发起方发出。
    expect(bytesToHex(responder.encrypt(hex(vector.messages[3].payload)))).toBe(
      vector.messages[3].ciphertext,
    );
    expect(bytesToHex(initiator.encrypt(hex(vector.messages[4].payload)))).toBe(
      vector.messages[4].ciphertext,
    );
    expect(bytesToHex(initiator.decrypt(hex(vector.messages[3].ciphertext)))).toBe(
      vector.messages[3].payload,
    );
  });
});

describe("E2EE frame helpers", () => {
  it("round-trips handshake and data frames", () => {
    const handshake = new Uint8Array([1, 2, 3, 4]);
    const frame = handshakeFrame(handshake);
    expect(bytesToHex(parseHandshakeFrame(frame))).toBe("01020304");
    expect(parseHandshakeFrame('{"type":"other","msg":"AA=="}')).toBeNull();
    expect(parseHandshakeFrame("not json")).toBeNull();

    const payload = new Uint8Array([9, 8, 7]);
    const dataFrame = e2eeFrame(payload);
    expect(bytesToHex(parseE2eeFrame(dataFrame))).toBe("090807");
    expect(parseE2eeFrame(frame)).toBeNull();
    expect(bytesToBase64(base64ToBytes("AAEC"))).toBe("AAEC");
  });
});
