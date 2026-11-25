import type { ChatMessage, EncryptedBlob } from '../types/chat';

const DB_NAME = 'lokachat_offline_db';
const DB_VERSION = 2;
const STORE_MESSAGES = 'messages';
const STORE_FILES = 'files';
const STORE_OUTBOX = 'outbox';

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
    };
  });
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
  } catch {
    // Ignore quota errors cleanly
  }
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
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      tx.objectStore(STORE_MESSAGES).delete(messageId);
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
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      const index = store.index('roomId');
      const req = index.openCursor(IDBKeyRange.only(roomId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
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
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      tx.objectStore(STORE_MESSAGES).clear();
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

