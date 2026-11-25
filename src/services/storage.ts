import type { ChatMessage, EncryptedBlob } from '../types/chat';

const DB_NAME = 'lokachat_offline_db';
const DB_VERSION = 4;
const STORE_MESSAGES = 'messages';
const STORE_FILES = 'files';
const STORE_OUTBOX = 'outbox';
const STORE_IDENTITY = 'identity';

export interface DeviceIdentityRecord {
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
  fingerprint: string;
}

export interface PendingChatPacket {
  id: string;
  roomId: string;
  roomType: 'direct' | 'group';
  senderId: string;
  senderName: string;
  recipientId?: string;
  type: 'text' | 'voice' | 'file';
  encryptedPayload: EncryptedBlob;
  timestamp: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id' });
        msgStore.createIndex('roomId', 'roomId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'fileId' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY, { keyPath: 'id' });
      }
    };
  });
}

export async function loadDeviceIdentity(): Promise<DeviceIdentityRecord | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_IDENTITY, 'readonly');
      const req = tx.objectStore(STORE_IDENTITY).get('self');
      req.onsuccess = () => {
        const record = req.result as (DeviceIdentityRecord & { id: string }) | undefined;
        resolve(record ? {
          publicKeyJwk: record.publicKeyJwk,
          privateKey: record.privateKey,
          fingerprint: record.fingerprint,
        } : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveDeviceIdentity(identity: DeviceIdentityRecord): Promise<boolean> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_IDENTITY, 'readwrite');
      tx.objectStore(STORE_IDENTITY).put({ id: 'self', ...identity });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function saveMessageToCache(message: ChatMessage): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      tx.objectStore(STORE_MESSAGES).put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable in restricted mode; continue seamlessly in memory
  }
}

export async function loadCachedMessages(): Promise<ChatMessage[]> {
  try {
    const db = await openDatabase();
    return await new Promise<ChatMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const req = tx.objectStore(STORE_MESSAGES).getAll();
      req.onsuccess = () => resolve((req.result as ChatMessage[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function saveFileBlobToCache(
  fileId: string,
  name: string,
  mimeType: string,
  blob: Blob,
): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readwrite');
      tx.objectStore(STORE_FILES).put({
        fileId,
        name,
        mimeType,
        blob,
        savedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await pruneCachedFiles(db);
  } catch {
    // Ignore quota errors cleanly
  }
}

async function pruneCachedFiles(db: IDBDatabase): Promise<void> {
  const maxBytes = 512 * 1024 * 1024;
  const maxEntries = 100;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_FILES, 'readwrite');
    const store = tx.objectStore(STORE_FILES);
    const request = store.getAll();
    request.onsuccess = () => {
      const entries = (request.result as Array<{
        fileId: string;
        blob?: Blob;
        savedAt?: number;
      }>).sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
      let totalBytes = entries.reduce((sum, entry) => sum + (entry.blob?.size ?? 0), 0);
      let remaining = entries.length;
      for (const entry of entries) {
        const tooOld = !entry.savedAt || Date.now() - entry.savedAt > maxAgeMs;
        if (!tooOld && totalBytes <= maxBytes && remaining <= maxEntries) continue;
        store.delete(entry.fileId);
        totalBytes -= entry.blob?.size ?? 0;
        remaining -= 1;
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadFileBlobFromCache(
  fileId: string,
): Promise<{ name: string; mimeType: string; blob: Blob } | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_FILES, 'readonly');
      const req = tx.objectStore(STORE_FILES).get(fileId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteMessageFromCache(messageId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_FILES], 'readwrite');
      const messages = tx.objectStore(STORE_MESSAGES);
      const req = messages.get(messageId);
      req.onsuccess = () => {
        const message = req.result as ChatMessage | undefined;
        messages.delete(messageId);
        if (message?.fileMeta?.fileId) {
          tx.objectStore(STORE_FILES).delete(message.fileMeta.fileId);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage errors cleanly
  }
}

export async function clearRoomMessagesFromCache(roomId: string): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_FILES], 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      const files = tx.objectStore(STORE_FILES);
      const index = store.index('roomId');
      const req = index.openCursor(IDBKeyRange.only(roomId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const message = cursor.value as ChatMessage;
          if (message.fileMeta?.fileId) files.delete(message.fileMeta.fileId);
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage errors cleanly
  }
}

export async function clearAllMessagesFromCache(): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_FILES], 'readwrite');
      const messages = tx.objectStore(STORE_MESSAGES);
      const files = tx.objectStore(STORE_FILES);
      const req = messages.getAll();
      req.onsuccess = () => {
        for (const message of req.result as ChatMessage[]) {
          if (message.fileMeta?.fileId) files.delete(message.fileMeta.fileId);
        }
        messages.clear();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage errors cleanly
  }
}

export async function enqueueOfflineChatPacket(
  packet: PendingChatPacket,
): Promise<number> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).put(packet);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const all = await loadOfflineChatOutbox();
    return all.length;
  } catch {
    return 0;
  }
}

export async function loadOfflineChatOutbox(): Promise<PendingChatPacket[]> {
  try {
    const db = await openDatabase();
    const list = await new Promise<PendingChatPacket[]>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const req = tx.objectStore(STORE_OUTBOX).getAll();
      req.onsuccess = () => resolve((req.result as PendingChatPacket[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    return list.sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

export async function removeOfflineChatPacket(messageId: string): Promise<number> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      tx.objectStore(STORE_OUTBOX).delete(messageId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const all = await loadOfflineChatOutbox();
    return all.length;
  } catch {
    return 0;
  }
}

