import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';

const PORT = process.env.NODE_ENV === 'production' ? Number(process.env.PORT || 3000) : 3000;
const SYNC_ROOT_DIR = path.resolve(os.tmpdir(), 'lokachat-lan-sync');
fs.mkdirSync(SYNC_ROOT_DIR, { recursive: true });

const FILE_ID_REGEX = /^[a-zA-Z0-9_-]{4,64}$/;
const MAX_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB per chunk max for multi-stream LAN transfers
const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB max single file

interface EncryptedBlob {
  iv: string;
  ciphertext: string;
  algorithm: 'AES-GCM-256';
}

interface ServerPeerRecord {
  id: string;
  name: string;
  customNameSet?: boolean;
  phone?: string;
  shopNote?: string;
  role: string;
  department: string;
  avatar: string;
  deviceName: string;
  localIp: string;
  online: boolean;
  isLiveSession: boolean;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  lastSeen: number;
}

interface ServerGroupRecord {
  id: string;
  type: 'group';
  name: string;
  description: string;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
  wrappedGroupKeys: Record<string, { senderId: string; blob: EncryptedBlob }>;
}

interface StoredWireMessage {
  id: string;
  roomId: string;
  roomType: 'direct' | 'group';
  senderId: string;
  senderName: string;
  recipientId?: string;
  type: 'text' | 'voice' | 'file' | 'system';
  encryptedPayload?: EncryptedBlob;
  timestamp: number;
  status: 'sending' | 'sent' | 'delivered' | 'read';
  readBy: string[];
}

interface FileSessionMeta {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  sha256: string;
  receivedSet: Set<number>;
  activeWrites: number;
  completePath: string;
  fileHandlePromise: Promise<fs.promises.FileHandle> | null;
  closingPromise: Promise<void> | null;
  completed: boolean;
  createdAt: number;
}

function computeJwkFingerprint(jwk: JsonWebKey): string {
  const canonical = `${jwk.kty}:${jwk.crv}:${jwk.x}:${jwk.y}`;
  const digest = crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
  return digest.slice(0, 16).match(/.{1,4}/g)?.join(' ') ?? digest.slice(0, 16);
}

const { publicKey: hubPublicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const hubFingerprint = computeJwkFingerprint(
  hubPublicKey.export({ format: 'jwk' }) as JsonWebKey,
);

const PEER_PROFILES_FILE = path.resolve(SYNC_ROOT_DIR, 'peer-profiles.json');
if (!PEER_PROFILES_FILE.startsWith(SYNC_ROOT_DIR + path.sep)) {
  throw new Error('Path penyimpanan profil peer tidak valid.');
}

function isDefaultGeneratedName(name: string): boolean {
  return /^(Stasiun Kerja|Perangkat Lokal)\s*#?\d*$/i.test(name.trim());
}

const peersMap = new Map<string, ServerPeerRecord>();

function loadPersistedPeerProfiles(): void {
  try {
    if (!fs.existsSync(PEER_PROFILES_FILE)) return;
    const raw = fs.readFileSync(PEER_PROFILES_FILE, 'utf8');
    const list = JSON.parse(raw) as ServerPeerRecord[];
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item?.id || !item?.name || !item?.publicKeyJwk) continue;
      if (peersMap.has(item.id)) continue;
      peersMap.set(item.id, {
        ...item,
        online: false,
        isLiveSession: true,
      });
    }
  } catch {
    // Ignore corrupted profile cache cleanly
  }
}

function savePersistedPeerProfiles(): void {
  try {
    const records = Array.from(peersMap.values());
    const tmpFile = `${PEER_PROFILES_FILE}.tmp`;
    if (!tmpFile.startsWith(SYNC_ROOT_DIR + path.sep)) return;
    fs.writeFileSync(tmpFile, JSON.stringify(records, null, 2), 'utf8');
    fs.renameSync(tmpFile, PEER_PROFILES_FILE);
  } catch {
    // Ignore transient disk write failures
  }
}

loadPersistedPeerProfiles();

const groupsMap = new Map<string, ServerGroupRecord>();
const fileSessions = new Map<string, FileSessionMeta>();
const clearedBeforeByPeer = new Map<string, Map<string, number>>();
const deletedIdsByPeer = new Map<string, Set<string>>();
const messagesStore: StoredWireMessage[] = [];

// Active WebSocket sockets mapped to peerId
const activeSockets = new Map<string, WebSocket>();

function getPublicPeersList(): ServerPeerRecord[] {
  return Array.from(peersMap.values());
}

function getLocalNetworkInterfaces() {
  const nets = os.networkInterfaces();
  const list: Array<{ name: string; address: string; netmask: string; cidr: string | null }> = [];
  for (const [name, addrs] of Object.entries(nets)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4') {
        list.push({
          name,
          address: addr.address,
          netmask: addr.netmask,
          cidr: addr.cidr ?? null,
        });
      }
    }
  }
  return list;
}

function broadcastToAll(payload: unknown, excludePeerId?: string) {
  const raw = JSON.stringify(payload);
  for (const [pid, ws] of activeSockets.entries()) {
    if (pid !== excludePeerId && ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    }
  }
}

function sendToPeer(peerId: string, payload: unknown) {
  const ws = activeSockets.get(peerId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function deliverChatWireMessage(
  senderId: string,
  incoming: {
    id?: string;
    roomId?: string;
    roomType?: 'direct' | 'group';
    senderName?: string;
    recipientId?: string;
    type?: 'text' | 'voice' | 'file' | 'system';
    encryptedPayload?: EncryptedBlob;
    timestamp?: number;
  },
): { ok: boolean; id?: string; status?: 'delivered'; duplicate?: boolean } {
  if (!incoming?.id || !incoming?.roomId || !incoming?.encryptedPayload) {
    return { ok: false };
  }

  if (messagesStore.some((m) => m.id === incoming.id)) {
    sendToPeer(senderId, {
      type: 'chat:ack',
      payload: { messageId: incoming.id, roomId: incoming.roomId, status: 'delivered' },
    });
    return { ok: true, id: incoming.id, status: 'delivered', duplicate: true };
  }

  const wireMsg: StoredWireMessage = {
    id: incoming.id,
    roomId: incoming.roomId,
    roomType: incoming.roomType === 'group' ? 'group' : 'direct',
    senderId,
    senderName: String(incoming.senderName || 'Perangkat Lokal').slice(0, 64),
    recipientId: incoming.recipientId,
    type: incoming.type || 'text',
    encryptedPayload: incoming.encryptedPayload,
    timestamp: incoming.timestamp || Date.now(),
    status: 'delivered',
    readBy: [senderId],
  };

  messagesStore.push(wireMsg);

  if (wireMsg.roomType === 'direct' && wireMsg.recipientId) {
    sendToPeer(wireMsg.recipientId, { type: 'chat:message', payload: wireMsg });
    sendToPeer(senderId, {
      type: 'chat:ack',
      payload: { messageId: wireMsg.id, roomId: wireMsg.roomId, status: 'delivered' },
    });
  } else if (wireMsg.roomType === 'group') {
    const grp = groupsMap.get(wireMsg.roomId);
    const members = grp?.memberIds ?? [];
    for (const memberId of members) {
      if (memberId !== senderId) {
        sendToPeer(memberId, { type: 'chat:message', payload: wireMsg });
      }
    }
    sendToPeer(senderId, {
      type: 'chat:ack',
      payload: { messageId: wireMsg.id, roomId: wireMsg.roomId, status: 'delivered' },
    });
  }

  return { ok: true, id: wireMsg.id, status: 'delivered' };
}

function resolveFileDir(fileId: string): string | null {
  if (!FILE_ID_REGEX.test(fileId)) return null;
  const resolved = path.resolve(SYNC_ROOT_DIR, fileId);
  if (!resolved.startsWith(SYNC_ROOT_DIR + path.sep)) return null;
  return resolved;
}

function resolveLocalSaveDir(): string {
  const custom = process.env.KIREMDATA_SAVE_DIR;
  if (custom) return path.resolve(custom);
  return path.resolve(os.homedir(), 'Downloads', 'KiremData');
}

function isRunningInCloudContainer(): boolean {
  const ifaces = getLocalNetworkInterfaces();
  const hasRealLan = ifaces.some(
    (i) =>
      i.address.startsWith('192.168.') ||
      i.address.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(i.address),
  );
  const hasLinkLocal = ifaces.some((i) => i.address.startsWith('169.254.'));
  return hasLinkLocal && !hasRealLan;
}

async function linkToLocalDownloadsDir(completePath: string, rawFileName: string): Promise<string | undefined> {
  try {
    const saveDir = resolveLocalSaveDir();
    await fs.promises.mkdir(saveDir, { recursive: true });
    const cleanBase = path.basename(rawFileName || 'file.bin').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const parsed = path.parse(cleanBase || 'file.bin');
    let candidate = path.resolve(saveDir, `${parsed.name}${parsed.ext}`);
    let counter = 1;
    while (fs.existsSync(candidate) && counter < 500) {
      candidate = path.resolve(saveDir, `${parsed.name} (${counter})${parsed.ext}`);
      counter++;
    }
    if (!candidate.startsWith(saveDir + path.sep)) return undefined;
    try {
      await fs.promises.link(completePath, candidate);
    } catch {
      await fs.promises.copyFile(completePath, candidate);
    }
    return candidate;
  } catch {
    return undefined;
  }
}

async function startServer() {
  const app = express();
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '4mb' }));

  // BackgroundSync-compatible HTTP chat delivery endpoint (idempotent with WebSocket chat:message)
  app.post('/api/chat/messages', (req, res) => {
    const body = req.body ?? {};
    const senderId = typeof body.senderId === 'string' ? body.senderId.trim() : '';
    if (!senderId || !body.id || !body.roomId || !body.encryptedPayload) {
      res.status(400).json({ error: 'Payload pesan chat tidak valid.' });
      return;
    }

    const result = deliverChatWireMessage(senderId, body);
    if (!result.ok) {
      res.status(400).json({ error: 'Gagal memproses pesan chat.' });
      return;
    }
    res.status(200).json(result);
  });

  // Local LAN Interface discovery endpoint
  app.get('/api/network-info', (_req, res) => {
    const isCloudContainer = isRunningInCloudContainer();
    res.json({
      hostname: os.hostname(),
      port: PORT,
      interfaces: getLocalNetworkInterfaces(),
      connectedPeersCount: activeSockets.size,
      mode: 'local-lan-offline',
      saveDir: resolveLocalSaveDir(),
      isCloudContainer,
    });
  });

  // LocalSend v2 Protocol: Device & Hub info
  app.get('/api/localsend/v2/info', (_req, res) => {
    res.json({
      alias: `KiremData Hub (${os.hostname()})`,
      version: '2.1',
      deviceModel: os.hostname(),
      deviceType: 'headless',
      fingerprint: hubFingerprint,
      port: PORT,
      protocol: 'http',
      download: true,
      saveDir: resolveLocalSaveDir(),
      isCloudContainer: isRunningInCloudContainer(),
    });
  });

  interface LocalSendSessionRecord {
    sessionId: string;
    tokens: Map<
      string,
      { token: string; fileName: string; size: number; mimeType: string }
    >;
    cancelled: boolean;
    createdAt: number;
  }

  const localSendSessions = new Map<string, LocalSendSessionRecord>();

  // LocalSend v2 Protocol: Prepare upload session and issue per-file tokens
  app.post('/api/localsend/v2/prepare-upload', (req, res) => {
    const filesInput = req.body?.files;
    if (!filesInput || typeof filesInput !== 'object') {
      res.status(400).json({ error: 'Daftar file prepare-upload tidak valid.' });
      return;
    }

    const sessionId = crypto.randomBytes(16).toString('hex');
    const tokens = new Map<
      string,
      { token: string; fileName: string; size: number; mimeType: string }
    >();
    const responseFiles: Record<string, string> = {};

    const entries = Object.entries(filesInput) as Array<
      [string, { id?: string; fileName?: string; size?: number; fileType?: string }]
    >;
    if (entries.length === 0 || entries.length > 500) {
      res.status(400).json({ error: 'Jumlah file dalam batch tidak valid.' });
      return;
    }

    for (const [key, item] of entries) {
      const fileId = String(item?.id || key || '');
      if (!FILE_ID_REGEX.test(fileId)) {
        res.status(400).json({ error: `ID file tidak valid: ${fileId}` });
        return;
      }
      const size = Number(item?.size ?? 0);
      if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) {
        res.status(400).json({ error: `Ukuran file melebihi batas: ${fileId}` });
        return;
      }
      const token = crypto.randomBytes(18).toString('hex');
      tokens.set(fileId, {
        token,
        fileName: path.basename(String(item?.fileName || 'file.bin')).slice(0, 180),
        size,
        mimeType: String(item?.fileType || 'application/octet-stream').slice(0, 120),
      });
      responseFiles[fileId] = token;
    }

    localSendSessions.set(sessionId, {
      sessionId,
      tokens,
      cancelled: false,
      createdAt: Date.now(),
    });

    res.json({ sessionId, files: responseFiles });
  });

  // LocalSend v2 Protocol: Single continuous raw binary stream directly piped to disk (zero RAM chunk copies)
  app.post('/api/localsend/v2/upload', async (req, res) => {
    req.setTimeout(0);
    res.setTimeout(0);

    const sessionId = String(req.query.sessionId || '');
    const fileId = String(req.query.fileId || '');
    const token = String(req.query.token || '');
    const targetPeerId = String(req.query.targetPeerId || '');
    const senderId = String(req.query.senderId || '');
    const senderName = String(req.query.senderName || 'Perangkat Lokal').slice(0, 80);

    const session = localSendSessions.get(sessionId);
    const dir = resolveFileDir(fileId);
    if (!session || session.cancelled || !dir) {
      res.status(403).json({ error: 'Sesi upload tidak valid atau telah dibatalkan.' });
      return;
    }

    const tokenMeta = session.tokens.get(fileId);
    if (!tokenMeta || tokenMeta.token !== token) {
      res.status(403).json({ error: 'Token file tidak sah.' });
      return;
    }

    const completePath = path.resolve(dir, 'complete.bin');
    if (!completePath.startsWith(dir + path.sep)) {
      res.status(400).json({ error: 'Path tujuan tidak valid.' });
      return;
    }

    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const writeStream = fs.createWriteStream(completePath, {
        highWaterMark: 8 * 1024 * 1024,
      });

      const startedAt = Date.now();
      let lastRxEmitAt = 0;
      let windowStartAt = startedAt;
      let windowBytes = 0;
      let smoothedSpeed = 0;
      let bytesWritten = 0;
      let aborted = false;

      const meta: FileSessionMeta = {
        fileId,
        name: tokenMeta.fileName,
        size: tokenMeta.size,
        mimeType: tokenMeta.mimeType,
        chunkSize: Math.max(64 * 1024, tokenMeta.size),
        totalChunks: 1,
        sha256: '',
        receivedSet: new Set<number>(),
        activeWrites: 1,
        completePath,
        fileHandlePromise: null,
        closingPromise: null,
        completed: false,
        createdAt: startedAt,
      };
      fileSessions.set(fileId, meta);

      req.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.byteLength;
        windowBytes += chunk.byteLength;
        if (bytesWritten > MAX_FILE_BYTES || session.cancelled) {
          aborted = true;
          req.unpipe(writeStream);
          writeStream.destroy();
          if (!res.headersSent) {
            res.status(413).json({ error: 'Ukuran file melebihi batas atau dibatalkan.' });
          }
          return;
        }
        if (targetPeerId) {
          const now = Date.now();
          if (now - lastRxEmitAt >= 200) {
            lastRxEmitAt = now;
            const winSec = Math.max(0.05, (now - windowStartAt) / 1000);
            const instant = windowBytes / winSec;
            smoothedSpeed = smoothedSpeed > 0 ? smoothedSpeed * 0.4 + instant * 0.6 : instant;
            windowStartAt = now;
            windowBytes = 0;
            sendToPeer(targetPeerId, {
              type: 'transfer:rx_progress',
              payload: {
                sessionId,
                senderId,
                senderName,
                fileId,
                name: tokenMeta.fileName,
                size: tokenMeta.size,
                mimeType: tokenMeta.mimeType,
                receivedBytes: bytesWritten,
                speedBytesPerSec: smoothedSpeed,
              },
            });
          }
        }
      });

      req.on('aborted', () => {
        aborted = true;
        req.unpipe(writeStream);
        writeStream.destroy();
      });

      writeStream.on('error', () => {
        aborted = true;
        if (!res.headersSent) {
          res.status(500).json({ error: 'Gagal menulis stream file ke disk.' });
        }
      });

      writeStream.on('finish', async () => {
        if (aborted) return;
        meta.activeWrites = 0;
        meta.completed = true;
        meta.receivedSet.add(0);
        if (bytesWritten > 0) {
          meta.size = bytesWritten;
        }
        const elapsedSec = Math.max(0.02, (Date.now() - startedAt) / 1000);
        const finalSpeed = bytesWritten / elapsedSec;
        const savedToDiskPath = !isRunningInCloudContainer()
          ? await linkToLocalDownloadsDir(completePath, tokenMeta.fileName)
          : undefined;

        if (!res.headersSent) {
          res.status(200).json({ ok: true, fileId, bytesWritten, speedBytesPerSec: finalSpeed, savedToDiskPath });
        }
      });

      req.pipe(writeStream);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Gagal memulai stream file.' });
      }
    }
  });

  // LocalSend v2 Protocol: Cancel session
  app.post('/api/localsend/v2/cancel', (req, res) => {
    const sessionId = String(req.query.sessionId || req.body?.sessionId || '');
    const session = localSendSessions.get(sessionId);
    if (session) {
      session.cancelled = true;
      localSendSessions.delete(sessionId);
    }
    res.status(204).end();
  });

  // Resumable multi-stream file sync: initialize transfer session with pre-allocated direct-offset target
  app.post('/api/files/init', async (req, res) => {
    const { fileId, name, size, mimeType, totalChunks, chunkSize, sha256 } = req.body ?? {};
    const resolvedChunkSize =
      typeof chunkSize === 'number' ? chunkSize : 2 * 1024 * 1024;

    if (
      typeof fileId !== 'string' ||
      !FILE_ID_REGEX.test(fileId) ||
      typeof name !== 'string' ||
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0 ||
      size > MAX_FILE_BYTES ||
      !Number.isInteger(resolvedChunkSize) ||
      resolvedChunkSize < 64 * 1024 ||
      resolvedChunkSize > MAX_CHUNK_BYTES ||
      typeof totalChunks !== 'number' ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > 50000
    ) {
      res.status(400).json({ error: 'Parameter inisialisasi file tidak valid.' });
      return;
    }

    const expectedChunks = size === 0 ? 1 : Math.ceil(size / resolvedChunkSize);
    if (totalChunks !== expectedChunks) {
      res.status(400).json({ error: 'Jumlah total blok tidak sesuai ukuran file.' });
      return;
    }

    const dir = resolveFileDir(fileId);
    if (!dir) {
      res.status(400).json({ error: 'ID file tidak valid.' });
      return;
    }

    const completePath = path.resolve(dir, 'complete.bin');
    if (!completePath.startsWith(dir + path.sep)) {
      res.status(400).json({ error: 'Path file tujuan tidak valid.' });
      return;
    }

    const existing = fileSessions.get(fileId);
    if (existing) {
      res.json({
        fileId,
        chunkSize: existing.chunkSize,
        receivedChunks: Array.from(existing.receivedSet),
        completed: existing.completed,
      });
      return;
    }

    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const handlePromise = fs.promises.open(completePath, 'w+').then(async (fh) => {
        if (size > 0) {
          await fh.truncate(size);
        }
        return fh;
      });

      const meta: FileSessionMeta = {
        fileId,
        name: path.basename(name).slice(0, 180),
        size,
        mimeType: typeof mimeType === 'string' ? mimeType.slice(0, 120) : 'application/octet-stream',
        chunkSize: resolvedChunkSize,
        totalChunks,
        sha256: typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256) ? sha256 : '',
        receivedSet: new Set<number>(),
        activeWrites: 0,
        completePath,
        fileHandlePromise: handlePromise,
        closingPromise: null,
        completed: false,
        createdAt: Date.now(),
      };
      fileSessions.set(fileId, meta);
      await handlePromise;

      res.json({
        fileId,
        chunkSize: resolvedChunkSize,
        receivedChunks: [],
        completed: false,
      });
    } catch {
      res.status(500).json({ error: 'Gagal menyiapkan buffer penyimpanan LAN.' });
    }
  });

  // Upload a single file chunk concurrently via non-blocking async pwrite at exact offset
  app.post(
    '/api/files/chunk',
    express.raw({ type: 'application/octet-stream', limit: '16mb' }),
    async (req, res) => {
      const fileId = String(req.headers['x-file-id'] || '');
      const chunkIndex = Number(req.headers['x-chunk-index']);

      const meta = fileSessions.get(fileId);
      const dir = resolveFileDir(fileId);
      if (
        !meta ||
        !dir ||
        !Number.isInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= meta.totalChunks
      ) {
        res.status(400).json({ error: 'Sesi atau indeks chunk file tidak valid.' });
        return;
      }

      if (meta.completed) {
        res.json({
          fileId,
          chunkIndex,
          receivedCount: meta.receivedSet.size,
          totalChunks: meta.totalChunks,
          completed: true,
        });
        return;
      }

      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bodyBuf.byteLength > meta.chunkSize || bodyBuf.byteLength > MAX_CHUNK_BYTES) {
        res.status(413).json({ error: 'Ukuran chunk melebihi batas.' });
        return;
      }

      const offset = chunkIndex * meta.chunkSize;
      if (meta.size > 0 && offset + bodyBuf.byteLength > meta.size) {
        res.status(400).json({ error: 'Offset chunk melebihi ukuran file.' });
        return;
      }

      meta.activeWrites += 1;
      try {
        const fh = meta.fileHandlePromise
          ? await meta.fileHandlePromise
          : await fs.promises.open(meta.completePath, 'r+');
        if (!meta.fileHandlePromise) {
          meta.fileHandlePromise = Promise.resolve(fh);
        }

        if (bodyBuf.byteLength > 0) {
          await fh.write(bodyBuf, 0, bodyBuf.byteLength, offset);
        }

        meta.receivedSet.add(chunkIndex);

        if (
          meta.receivedSet.size === meta.totalChunks &&
          meta.activeWrites === 1 &&
          !meta.completed
        ) {
          meta.completed = true;
          const handleToClose = fh;
          meta.fileHandlePromise = null;
          meta.closingPromise = handleToClose.close().catch(() => {});
          await meta.closingPromise;
        }

        res.json({
          fileId,
          chunkIndex,
          receivedCount: meta.receivedSet.size,
          totalChunks: meta.totalChunks,
          completed: meta.completed,
        });
      } catch {
        res.status(500).json({ error: 'Gagal menulis blok file ke penyimpanan LAN.' });
      } finally {
        meta.activeWrites = Math.max(0, meta.activeWrites - 1);
      }
    },
  );

  // Attach asynchronously computed SHA-256 metadata once parallel upload completes
  app.post('/api/files/finalize', (req, res) => {
    const { fileId, sha256 } = req.body ?? {};
    if (typeof fileId !== 'string' || !FILE_ID_REGEX.test(fileId)) {
      res.status(400).json({ error: 'ID file tidak valid.' });
      return;
    }
    const meta = fileSessions.get(fileId);
    if (!meta) {
      res.status(404).json({ error: 'Sesi file tidak ditemukan.' });
      return;
    }
    if (typeof sha256 === 'string' && /^[a-f0-9]{64}$/i.test(sha256)) {
      meta.sha256 = sha256;
    }
    res.json({ fileId, completed: meta.completed, sha256: meta.sha256 });
  });

  // Download synchronized file with HTTP Range & large stream buffer support
  app.get('/api/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const meta = fileSessions.get(fileId);
    const dir = resolveFileDir(fileId);
    if (!meta || !dir) {
      res.status(404).json({ error: 'File tidak ditemukan di sinkronisasi LAN.' });
      return;
    }

    if (meta.closingPromise) {
      await meta.closingPromise;
    }

    const completePath = meta.completePath;
    if (!completePath.startsWith(dir + path.sep) || !fs.existsSync(completePath)) {
      res.status(404).json({ error: 'File belum selesai disinkronkan.' });
      return;
    }

    const stat = await fs.promises.stat(completePath);
    const fileSize = stat.size;
    res.setHeader('Content-Type', meta.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(meta.name)}"`);
    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers.range;
    if (rangeHeader && fileSize > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(fileSize - 1, Number(match[2])) : fileSize - 1;
        if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          res.setHeader('Content-Length', String(end - start + 1));
          fs.createReadStream(completePath, { start, end, highWaterMark: 2 * 1024 * 1024 }).pipe(res);
          return;
        }
      }
    }

    res.setHeader('Content-Length', String(fileSize));
    fs.createReadStream(completePath, { highWaterMark: 2 * 1024 * 1024 }).pipe(res);
  });

  const server = http.createServer(app);
  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.keepAliveTimeout = 65000;
  server.on('connection', (socket) => {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 10000);
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const pathname = new URL(
        request.url || '/',
        `http://${request.headers.host || 'localhost'}`,
      ).pathname;
      if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    let registeredPeerId: string | null = null;
    const remoteIp = req.socket.remoteAddress?.replace('::ffff:', '') || '127.0.0.1';

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());

        if (msg.type === 'peer:register') {
          const {
            id,
            name,
            hasCustomName,
            phone,
            shopNote,
            role,
            department,
            avatar,
            deviceName,
            publicKeyJwk,
          } = msg.payload ?? {};
          if (!id || !name || !publicKeyJwk) return;

          const requestedId = String(id).slice(0, 80);
          const fingerprint = computeJwkFingerprint(publicKeyJwk);
          const incomingName = String(name).trim().slice(0, 64);
          const incomingPhone = typeof phone === 'string' ? phone.trim().slice(0, 32) : '';
          const incomingShopNote = typeof shopNote === 'string' ? shopNote.trim().slice(0, 160) : '';

          // Match persistent hub record by exact ID first, then by cryptographic ECDH key fingerprint
          let existing = peersMap.get(requestedId);
          if (!existing) {
            for (const candidate of peersMap.values()) {
              if (candidate.fingerprint === fingerprint) {
                existing = candidate;
                break;
              }
            }
          }

          registeredPeerId = existing ? existing.id : requestedId;
          activeSockets.set(registeredPeerId, ws);

          const incomingIsExplicitCustom =
            hasCustomName === true ||
            (incomingName.length > 0 && !isDefaultGeneratedName(incomingName));

          // Preserve hub's saved custom name (e.g. 'Rian') when device reconnects with a default/reset name
          let resolvedName = incomingName || 'Perangkat Lokal';
          let resolvedCustomNameSet = incomingIsExplicitCustom;
          if (existing?.customNameSet && existing.name) {
            if (hasCustomName === true && incomingName && !isDefaultGeneratedName(incomingName)) {
              resolvedName = incomingName;
              resolvedCustomNameSet = true;
            } else {
              resolvedName = existing.name;
              resolvedCustomNameSet = true;
            }
          }

          const resolvedPhone = incomingPhone || existing?.phone || '';
          const resolvedShopNote = incomingShopNote || existing?.shopNote || '';

          const peerRecord: ServerPeerRecord = {
            id: registeredPeerId,
            name: resolvedName,
            customNameSet: resolvedCustomNameSet,
            phone: resolvedPhone || undefined,
            shopNote: resolvedShopNote || undefined,
            role: String(
              (existing?.customNameSet && existing.role) || role || 'Anggota Tim',
            ).slice(0, 64),
            department: String(
              (existing?.customNameSet && existing.department) || department || 'Kantor Lokal',
            ).slice(0, 64),
            avatar: String(avatar || existing?.avatar || ''),
            deviceName: String(deviceName || existing?.deviceName || 'Perangkat Lokal').slice(0, 64),
            localIp: remoteIp,
            online: true,
            isLiveSession: true,
            publicKeyJwk,
            fingerprint,
            lastSeen: Date.now(),
          };

          peersMap.set(registeredPeerId, peerRecord);
          savePersistedPeerProfiles();

          const wrappedGroupsForPeer = Array.from(groupsMap.values())
            .filter((grp) => grp.memberIds.includes(registeredPeerId!))
            .map((grp) => ({
              id: grp.id,
              type: 'group' as const,
              name: grp.name,
              description: grp.description,
              memberIds: grp.memberIds,
              createdBy: grp.createdBy,
              createdAt: grp.createdAt,
              wrappedGroupKeys: grp.wrappedGroupKeys,
              unreadCount: 0,
            }));

          const peerClearedMap = clearedBeforeByPeer.get(registeredPeerId);
          const peerDeletedSet = deletedIdsByPeer.get(registeredPeerId);
          const canAccess = (roomId: string): boolean => {
            if (roomId.includes('__')) {
              return roomId.split('__').includes(registeredPeerId!);
            }
            return groupsMap.get(roomId)?.memberIds.includes(registeredPeerId!) ?? false;
          };

          const initialMessages = messagesStore
            .filter((m) => {
              if (!canAccess(m.roomId)) return false;
              if (peerDeletedSet?.has(m.id)) return false;
              const clearedAt = peerClearedMap?.get(m.roomId) ?? 0;
              if (m.timestamp <= clearedAt) return false;
              return true;
            })
            .map((m) => ({
              id: m.id,
              roomId: m.roomId,
              roomType: m.roomType,
              senderId: m.senderId,
              senderName: m.senderName,
              recipientId: m.recipientId,
              type: m.type,
              encryptedPayload: m.encryptedPayload,
              timestamp: m.timestamp,
              status: m.status,
              readBy: m.readBy,
            }));

          ws.send(
            JSON.stringify({
              type: 'sync:init',
              payload: {
                selfPeer: peerRecord,
                peers: getPublicPeersList(),
                groups: wrappedGroupsForPeer,
                messages: initialMessages,
              },
            }),
          );

          broadcastToAll(
            {
              type: 'peer:list',
              payload: getPublicPeersList(),
            },
            registeredPeerId,
          );
          return;
        }

        if (!registeredPeerId) return;

        if (msg.type === 'peer:update_profile') {
          const { name, role, department, phone, shopNote } = msg.payload ?? {};
          const existing = peersMap.get(registeredPeerId);
          if (existing && typeof name === 'string' && name.trim()) {
            existing.name = name.trim().slice(0, 64);
            existing.customNameSet = true;
            if (typeof phone === 'string') {
              existing.phone = phone.trim().slice(0, 32) || undefined;
            }
            if (typeof shopNote === 'string') {
              existing.shopNote = shopNote.trim().slice(0, 160) || undefined;
            }
            if (typeof role === 'string' && role.trim()) {
              existing.role = role.trim().slice(0, 64);
            }
            if (typeof department === 'string' && department.trim()) {
              existing.department = department.trim().slice(0, 64);
            }
            existing.lastSeen = Date.now();
            savePersistedPeerProfiles();
            sendToPeer(registeredPeerId, {
              type: 'peer:profile_saved',
              payload: {
                id: existing.id,
                name: existing.name,
                phone: existing.phone,
                shopNote: existing.shopNote,
              },
            });
            broadcastToAll({
              type: 'peer:list',
              payload: getPublicPeersList(),
            });
          }
          return;
        }

        if (msg.type === 'chat:delete_message') {
          const { messageId, roomId, scope } = msg.payload ?? {};
          if (typeof messageId !== 'string' || typeof roomId !== 'string') return;
          const isParticipant = roomId.includes('__')
            ? roomId.split('__').includes(registeredPeerId)
            : groupsMap.get(roomId)?.memberIds.includes(registeredPeerId) ?? false;
          if (!isParticipant) return;

          let delSet = deletedIdsByPeer.get(registeredPeerId);
          if (!delSet) {
            delSet = new Set<string>();
            deletedIdsByPeer.set(registeredPeerId, delSet);
          }
          delSet.add(messageId);

          if (scope === 'everyone') {
            const idx = messagesStore.findIndex(
              (m) => m.id === messageId && m.roomId === roomId && m.senderId === registeredPeerId,
            );
            if (idx !== -1) {
              messagesStore.splice(idx, 1);
              const targetMembers = roomId.includes('__')
                ? roomId.split('__')
                : groupsMap.get(roomId)?.memberIds ?? [];
              for (const mId of targetMembers) {
                if (mId !== registeredPeerId) {
                  sendToPeer(mId, {
                    type: 'chat:message_deleted',
                    payload: { messageId, roomId },
                  });
                }
              }
            }
          }
          return;
        }

        if (msg.type === 'chat:clear_room') {
          const { roomId, scope, clearedAt } = msg.payload ?? {};
          if (typeof roomId !== 'string' || typeof clearedAt !== 'number') return;
          const isParticipant = roomId.includes('__')
            ? roomId.split('__').includes(registeredPeerId)
            : groupsMap.get(roomId)?.memberIds.includes(registeredPeerId) ?? false;
          if (!isParticipant) return;

          let peerMap = clearedBeforeByPeer.get(registeredPeerId);
          if (!peerMap) {
            peerMap = new Map<string, number>();
            clearedBeforeByPeer.set(registeredPeerId, peerMap);
          }
          peerMap.set(roomId, clearedAt);

          if (scope === 'everyone') {
            for (let i = messagesStore.length - 1; i >= 0; i--) {
              const m = messagesStore[i];
              if (m.roomId === roomId && m.timestamp <= clearedAt) {
                messagesStore.splice(i, 1);
              }
            }
            const targetMembers = roomId.includes('__')
              ? roomId.split('__')
              : groupsMap.get(roomId)?.memberIds ?? [];
            for (const mId of targetMembers) {
              if (mId !== registeredPeerId) {
                sendToPeer(mId, {
                  type: 'chat:room_cleared',
                  payload: { roomId, clearedAt, clearedBy: registeredPeerId },
                });
              }
            }
          }
          return;
        }

        if (msg.type === 'chat:clear_all') {
          const { clearedAt } = msg.payload ?? {};
          const ts = typeof clearedAt === 'number' ? clearedAt : Date.now();
          let peerMap = clearedBeforeByPeer.get(registeredPeerId);
          if (!peerMap) {
            peerMap = new Map<string, number>();
            clearedBeforeByPeer.set(registeredPeerId, peerMap);
          }
          for (const grp of groupsMap.values()) {
            if (grp.memberIds.includes(registeredPeerId)) {
              peerMap.set(grp.id, ts);
            }
          }
          for (const p of peersMap.values()) {
            if (p.id !== registeredPeerId) {
              const directId = [registeredPeerId, p.id].sort().join('__');
              peerMap.set(directId, ts);
            }
          }
          return;
        }

        if (msg.type === 'chat:message') {
          deliverChatWireMessage(registeredPeerId, msg.payload);
          return;
        }

        if (msg.type === 'chat:read') {
          const { roomId, messageIds } = msg.payload ?? {};
          if (!roomId || !Array.isArray(messageIds)) return;

          for (const m of messagesStore) {
            if (m.roomId === roomId && messageIds.includes(m.id)) {
              m.status = 'read';
              if (!m.readBy.includes(registeredPeerId)) {
                m.readBy.push(registeredPeerId);
              }
              if (m.senderId !== registeredPeerId) {
                sendToPeer(m.senderId, {
                  type: 'chat:ack',
                  payload: { messageId: m.id, roomId, status: 'read', readerId: registeredPeerId },
                });
              }
            }
          }
          return;
        }

        if (msg.type === 'peer:typing') {
          const { roomId, roomType, recipientId, isTyping } = msg.payload ?? {};
          if (roomType === 'direct' && recipientId) {
            sendToPeer(recipientId, {
              type: 'peer:typing',
              payload: { roomId, peerId: registeredPeerId, isTyping: !!isTyping },
            });
          } else if (roomType === 'group') {
            const grp = groupsMap.get(roomId);
            for (const mId of grp?.memberIds ?? []) {
              if (mId !== registeredPeerId) {
                sendToPeer(mId, {
                  type: 'peer:typing',
                  payload: { roomId, peerId: registeredPeerId, isTyping: !!isTyping },
                });
              }
            }
          }
          return;
        }

        if (msg.type === 'group:create') {
          const { id, name, description, memberIds, wrappedGroupKeys } = msg.payload ?? {};
          if (!id || !name || !Array.isArray(memberIds)) return;

          const uniqueMembers = Array.from(new Set([registeredPeerId, ...memberIds]));
          const newGroup: ServerGroupRecord = {
            id,
            type: 'group',
            name: String(name).slice(0, 80),
            description: String(description || 'Grup komunikasi tim lokal').slice(0, 160),
            memberIds: uniqueMembers,
            createdBy: registeredPeerId,
            createdAt: Date.now(),
            wrappedGroupKeys: wrappedGroupKeys || {},
          };
          groupsMap.set(newGroup.id, newGroup);

          const publicGroup = {
            id: newGroup.id,
            type: 'group' as const,
            name: newGroup.name,
            description: newGroup.description,
            memberIds: newGroup.memberIds,
            createdBy: newGroup.createdBy,
            createdAt: newGroup.createdAt,
            wrappedGroupKeys: newGroup.wrappedGroupKeys,
            unreadCount: 0,
          };

          for (const memberId of uniqueMembers) {
            sendToPeer(memberId, { type: 'group:created', payload: publicGroup });
          }
          return;
        }

        if (msg.type === 'group:add_member') {
          const { groupId, memberId, wrappedKeyForMember } = msg.payload ?? {};
          const grp = groupsMap.get(groupId);
          if (!grp || !memberId) return;

          if (!grp.memberIds.includes(memberId)) {
            grp.memberIds.push(memberId);
          }
          if (wrappedKeyForMember) {
            grp.wrappedGroupKeys[memberId] = wrappedKeyForMember;
          }

          const publicGroup = {
            id: grp.id,
            type: 'group' as const,
            name: grp.name,
            description: grp.description,
            memberIds: grp.memberIds,
            createdBy: grp.createdBy,
            createdAt: grp.createdAt,
            wrappedGroupKeys: grp.wrappedGroupKeys,
            unreadCount: 0,
          };

          for (const mId of grp.memberIds) {
            sendToPeer(mId, { type: 'group:updated', payload: publicGroup });
          }
          return;
        }

        // WebRTC / Wi-Fi Direct signaling relay (supports multi-socket parallel lanes)
        if (msg.type === 'rtc:signal') {
          const { targetPeerId, signalType, payload, laneIndex } = msg.payload ?? {};
          if (!targetPeerId || !signalType) return;
          sendToPeer(targetPeerId, {
            type: 'rtc:signal',
            payload: {
              fromPeerId: registeredPeerId,
              signalType,
              payload,
              laneIndex: typeof laneIndex === 'number' ? laneIndex : 0,
            },
          });
          return;
        }

        // LocalSend-style transfer session handshake relays (prepare -> decision -> cancel -> file_ready)
        if (msg.type === 'transfer:prepare') {
          const { targetPeerId, sessionId, files, encryptFiles, transport } = msg.payload ?? {};
          if (!targetPeerId || !sessionId || !Array.isArray(files)) return;
          const sender = peersMap.get(registeredPeerId);
          sendToPeer(targetPeerId, {
            type: 'transfer:prepare',
            payload: {
              sessionId,
              senderId: registeredPeerId,
              senderName: sender?.name || 'Perangkat Lokal',
              senderIp: sender?.localIp || remoteIp,
              senderDeviceName: sender?.deviceName || 'Perangkat Lokal',
              files,
              encryptFiles: !!encryptFiles,
              transport: transport === 'wifi-direct' ? 'wifi-direct' : 'lan-sync',
            },
          });
          return;
        }

        if (msg.type === 'transfer:decision') {
          const {
            targetPeerId,
            sessionId,
            accepted,
            requiresPin,
            pinError,
            acceptedFileIds,
          } = msg.payload ?? {};
          if (!targetPeerId || !sessionId) return;
          sendToPeer(targetPeerId, {
            type: 'transfer:decision',
            payload: {
              sessionId,
              fromPeerId: registeredPeerId,
              accepted: !!accepted,
              requiresPin: !!requiresPin,
              pinError: typeof pinError === 'string' ? pinError : undefined,
              acceptedFileIds: Array.isArray(acceptedFileIds) ? acceptedFileIds : undefined,
            },
          });
          return;
        }

        if (msg.type === 'transfer:cancel') {
          const { targetPeerId, sessionId } = msg.payload ?? {};
          if (!targetPeerId || !sessionId) return;
          sendToPeer(targetPeerId, {
            type: 'transfer:cancel',
            payload: {
              sessionId,
              fromPeerId: registeredPeerId,
            },
          });
          return;
        }

        if (msg.type === 'transfer:file_ready') {
          const {
            targetPeerId,
            sessionId,
            fileId,
            name,
            size,
            mimeType,
            encrypted,
            transport,
            speedBytesPerSec,
            savedToDiskPath,
          } = msg.payload ?? {};
          if (!targetPeerId || !fileId) return;
          const sender = peersMap.get(registeredPeerId);
          sendToPeer(targetPeerId, {
            type: 'transfer:file_ready',
            payload: {
              sessionId,
              senderId: registeredPeerId,
              senderName: sender?.name || 'Perangkat Lokal',
              fileId,
              name,
              size,
              mimeType,
              encrypted: !!encrypted,
              transport: transport === 'wifi-direct' ? 'wifi-direct' : 'lan-sync',
              speedBytesPerSec: Number(speedBytesPerSec || 0),
              savedToDiskPath: typeof savedToDiskPath === 'string' ? savedToDiskPath : undefined,
            },
          });
        }
      } catch {
        // Ignore malformed WebSocket frames
      }
    });

    ws.on('close', () => {
      if (registeredPeerId) {
        activeSockets.delete(registeredPeerId);
        const p = peersMap.get(registeredPeerId);
        if (p) {
          p.online = false;
          p.lastSeen = Date.now();
          if (p.isLiveSession) {
            // Keep peer in list as offline so existing chats remain accessible
            p.online = false;
          }
        }
        broadcastToAll({
          type: 'peer:list',
          payload: getPublicPeersList(),
        });
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: false,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.get('/@vite/client', async (req, res, next) => {
      try {
        const result = await vite.transformRequest(req.originalUrl);
        if (!result) {
          next();
          return;
        }
        const safeCode = result.code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* HMR disabled */',
          )
          .replace(
            'else throw new SendBeforeConnectError("send was called before connect");',
            'else return;',
          );
        res
          .status(200)
          .setHeader('Cache-Control', 'no-store, max-age=0')
          .type('application/javascript; charset=utf-8')
          .send(safeCode);
      } catch (err) {
        next(err);
      }
    });
    app.get('/dev-sw.js', (_req, res) => {
      res
        .status(200)
        .setHeader('Cache-Control', 'no-store, max-age=0')
        .type('application/javascript; charset=utf-8')
        .send(
          `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
  })());
});`,
        );
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`KiremData LAN Hub berjalan di http://0.0.0.0:${PORT}`);
  });
}

startServer();
