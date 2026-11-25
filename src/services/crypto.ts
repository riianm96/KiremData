import type { EncryptedBlob } from '../types/chat';

function hasWebCrypto(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

function getRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(length);
  const out = new Uint8Array(buf);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function pureJsHashBytes(input: Uint8Array, outLen = 32): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(outLen);
  const out = new Uint8Array(buf);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input[i];
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ input[i], 0x85ebca6b);
  }
  for (let i = 0; i < outLen; i++) {
    h1 = Math.imul(h1 ^ (i + 17), 0x27d4eb2d);
    h2 = Math.imul(h2 ^ h1, 0x165667b1);
    out[i] = ((h1 ^ h2) >>> ((i % 4) * 8)) & 0xff;
  }
  return out;
}

function isPlainFallbackKey(key: unknown): key is { __lanPlainKey: true; secret: string } {
  return Boolean(key && typeof key === 'object' && (key as { __lanPlainKey?: boolean }).__lanPlainKey);
}

function makePlainFallbackKey(secret = 'lan-shared'): CryptoKey {
  return { __lanPlainKey: true, secret } as unknown as CryptoKey;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return bufferToBase64(bytes);
}

function base64ToUtf8(b64: string): string {
  const bytes = base64ToUint8Array(b64);
  return new TextDecoder().decode(bytes);
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface StoredIdentityKeys {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
}

export async function generateIdentityKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  fingerprint: string;
}> {
  if (!hasWebCrypto()) {
    const x = bufferToBase64(getRandomBytes(32));
    const y = bufferToBase64(getRandomBytes(32));
    const d = bufferToBase64(getRandomBytes(32));
    const publicKeyJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y };
    const privateKeyJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y, d };
    const fingerprint = await computeKeyFingerprint(publicKeyJwk);
    return {
      publicKey: makePlainFallbackKey(x),
      privateKey: makePlainFallbackKey(d),
      publicKeyJwk,
      privateKeyJwk,
      fingerprint,
    };
  }

  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits'],
  );

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const fingerprint = await computeKeyFingerprint(publicKeyJwk);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
    privateKeyJwk,
    fingerprint,
  };
}

export async function importPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  if (!hasWebCrypto()) {
    return makePlainFallbackKey(privateKeyJwk.d || 'lan-priv');
  }
  return crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    false,
    ['deriveKey', 'deriveBits'],
  );
}

export async function importPublicKey(publicKeyJwk: JsonWebKey): Promise<CryptoKey> {
  if (!hasWebCrypto()) {
    return makePlainFallbackKey(publicKeyJwk.x || 'lan-pub');
  }
  return crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    [],
  );
}

export async function computeKeyFingerprint(publicKeyJwk: JsonWebKey): Promise<string> {
  const canonical = `${publicKeyJwk.kty}:${publicKeyJwk.crv}:${publicKeyJwk.x}:${publicKeyJwk.y}`;
  const data = new TextEncoder().encode(canonical);
  const bytes = hasWebCrypto()
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', data))
    : pureJsHashBytes(data, 16);
  const hex = Array.from(bytes)
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
}

export async function computeSafetyNumber(
  pubA: JsonWebKey,
  pubB: JsonWebKey,
): Promise<string[]> {
  const keyA = `${pubA.x ?? ''}:${pubA.y ?? ''}`;
  const keyB = `${pubB.x ?? ''}:${pubB.y ?? ''}`;
  const sorted = [keyA, keyB].sort().join('|');
  let buffer: ArrayBuffer = new TextEncoder().encode(sorted).buffer as ArrayBuffer;

  if (hasWebCrypto()) {
    for (let i = 0; i < 8; i++) {
      buffer = await crypto.subtle.digest('SHA-256', buffer);
    }
  } else {
    buffer = pureJsHashBytes(new Uint8Array(buffer), 32).buffer;
  }

  const bytes = new Uint8Array(buffer);
  const blocks: string[] = [];
  for (let i = 0; i < 12; i++) {
    const idx = (i * 2) % (bytes.length - 1);
    const val = ((bytes[idx] << 8) | bytes[idx + 1]) % 100000;
    blocks.push(val.toString().padStart(5, '0'));
  }
  return blocks;
}

export async function deriveSharedAesKey(
  myPrivateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey,
): Promise<CryptoKey> {
  if (!hasWebCrypto() || isPlainFallbackKey(myPrivateKey)) {
    return makePlainFallbackKey(peerPublicKeyJwk.x || 'lan-shared');
  }
  const peerPublicKey = await importPublicKey(peerPublicKeyJwk);
  return crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    myPrivateKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function generateGroupAesKey(): Promise<CryptoKey> {
  if (!hasWebCrypto()) {
    return makePlainFallbackKey(bufferToBase64(getRandomBytes(32)));
  }
  return crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportAesKeyBase64(key: CryptoKey): Promise<string> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    return isPlainFallbackKey(key) ? key.secret : bufferToBase64(getRandomBytes(32));
  }
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

export async function importAesKeyBase64(base64: string): Promise<CryptoKey> {
  if (!hasWebCrypto()) {
    return makePlainFallbackKey(base64);
  }
  const raw = base64ToUint8Array(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptPayload<T>(key: CryptoKey, payload: T): Promise<EncryptedBlob> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    return {
      iv: bufferToBase64(getRandomBytes(12)),
      ciphertext: utf8ToBase64(JSON.stringify(payload)),
      algorithm: 'LAN-PLAIN',
    };
  }
  const iv = getRandomBytes(12);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encoded,
  );
  return {
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(encrypted),
    algorithm: 'AES-GCM-256',
  };
}

export async function decryptPayload<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  if (blob.algorithm === 'LAN-PLAIN' || !hasWebCrypto() || isPlainFallbackKey(key)) {
    return JSON.parse(base64ToUtf8(blob.ciphertext)) as T;
  }
  const iv = base64ToUint8Array(blob.iv);
  const ciphertext = base64ToUint8Array(blob.ciphertext);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    ciphertext,
  );
  const text = new TextDecoder().decode(decrypted);
  return JSON.parse(text) as T;
}

export async function encryptBinaryBuffer(
  key: CryptoKey,
  buffer: ArrayBuffer,
): Promise<{ iv: string; data: ArrayBuffer }> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    return {
      iv: bufferToBase64(getRandomBytes(12)),
      data: buffer,
    };
  }
  const iv = getRandomBytes(12);
  const data = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    buffer,
  );
  return {
    iv: bufferToBase64(iv),
    data,
  };
}

export async function decryptBinaryBuffer(
  key: CryptoKey,
  ivBase64: string,
  encrypted: ArrayBuffer,
): Promise<ArrayBuffer> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    return encrypted;
  }
  const iv = base64ToUint8Array(ivBase64);
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encrypted,
  );
}

export async function encryptBinaryBufferRaw(
  key: CryptoKey,
  buffer: ArrayBuffer,
): Promise<{ iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    return { iv: getRandomBytes(12), data: buffer };
  }
  const iv = getRandomBytes(12);
  const data = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    buffer,
  );
  return { iv, data };
}

export async function decryptBinaryBufferRaw(
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  encrypted: BufferSource,
): Promise<ArrayBuffer> {
  if (!hasWebCrypto() || isPlainFallbackKey(key)) {
    if (encrypted instanceof ArrayBuffer) return encrypted;
    return encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.byteLength) as ArrayBuffer;
  }
  return crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encrypted,
  );
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const bytes = hasWebCrypto()
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))
    : pureJsHashBytes(new Uint8Array(buffer), 32);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const arr = base64ToUint8Array(base64);
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}
