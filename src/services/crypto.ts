import type { EncryptedBlob } from '../types/chat';

function requireWebCrypto(): Crypto {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.getRandomValues) {
    throw new Error('Peramban tidak mendukung Web Crypto yang aman.');
  }
  return crypto;
}

function getRandomBytes(length: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(length);
  const out = new Uint8Array(buf);
  requireWebCrypto().getRandomValues(out);
  return out;
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

export async function generateIdentityKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
}> {
  const webCrypto = requireWebCrypto();
  const keyPair = await webCrypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits'],
  );

  const publicKeyJwk = await webCrypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKeyJwk = await webCrypto.subtle.exportKey('jwk', keyPair.privateKey);
  const protectedPrivateKey = await webCrypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits'],
  );
  const fingerprint = await computeKeyFingerprint(publicKeyJwk);

  return {
    publicKey: keyPair.publicKey,
    privateKey: protectedPrivateKey,
    publicKeyJwk,
    fingerprint,
  };
}

export async function importPrivateKey(privateKeyJwk: JsonWebKey): Promise<CryptoKey> {
  return requireWebCrypto().subtle.importKey(
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
  return requireWebCrypto().subtle.importKey(
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
  const bytes = new Uint8Array(await requireWebCrypto().subtle.digest('SHA-256', data));
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

  const webCrypto = requireWebCrypto();
  for (let i = 0; i < 8; i++) {
    buffer = await webCrypto.subtle.digest('SHA-256', buffer);
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
  const webCrypto = requireWebCrypto();
  const peerPublicKey = await importPublicKey(peerPublicKeyJwk);
  return webCrypto.subtle.deriveKey(
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
  return requireWebCrypto().subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportAesKeyBase64(key: CryptoKey): Promise<string> {
  const raw = await requireWebCrypto().subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

export async function importAesKeyBase64(base64: string): Promise<CryptoKey> {
  const raw = base64ToUint8Array(base64);
  return requireWebCrypto().subtle.importKey(
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
  const webCrypto = requireWebCrypto();
  const iv = getRandomBytes(12);
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await webCrypto.subtle.encrypt(
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
  if (blob.algorithm !== 'AES-GCM-256') {
    throw new Error('Pesan tidak dienkripsi dengan algoritme yang didukung.');
  }
  const webCrypto = requireWebCrypto();
  const iv = base64ToUint8Array(blob.iv);
  const ciphertext = base64ToUint8Array(blob.ciphertext);
  const decrypted = await webCrypto.subtle.decrypt(
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
  const webCrypto = requireWebCrypto();
  const iv = getRandomBytes(12);
  const data = await webCrypto.subtle.encrypt(
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
  const webCrypto = requireWebCrypto();
  const iv = base64ToUint8Array(ivBase64);
  return webCrypto.subtle.decrypt(
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
  const webCrypto = requireWebCrypto();
  const iv = getRandomBytes(12);
  const data = await webCrypto.subtle.encrypt(
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
  return requireWebCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    encrypted,
  );
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(await requireWebCrypto().subtle.digest('SHA-256', buffer));
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
