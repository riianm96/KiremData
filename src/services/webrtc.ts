import {
  decryptBinaryBuffer,
  decryptBinaryBufferRaw,
  encryptBinaryBufferRaw,
  sha256Hex,
} from './crypto';

export type P2PRouteType = 'lan-direct' | 'stun-nat' | 'relay' | 'unknown';

export interface P2PChannelState {
  peerId: string;
  state: RTCPeerConnectionState | 'idle';
  channelOpen: boolean;
  lanesOpen: number;
  routeType: P2PRouteType;
}

type ChunkStorageItem = ArrayBuffer | Uint8Array<ArrayBuffer> | null;

interface EarlyChunkItem {
  chunkIndex: number;
  iv: Uint8Array<ArrayBuffer> | null;
  payloadView: Uint8Array<ArrayBuffer>;
}

interface OpfsReceiverState {
  root: FileSystemDirectoryHandle;
  fileName: string;
  fileHandle: FileSystemFileHandle;
  writable: FileSystemWritableFileStream;
}

interface IncomingP2PTransfer {
  fileId: string;
  streamId: number;
  roomId: string;
  senderId: string;
  senderName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  sha256: string;
  encrypted: boolean;
  aesKeyPromise: Promise<CryptoKey | null> | null;
  chunks: ChunkStorageItem[];
  writtenChunkMask: Uint8Array;
  receivedCount: number;
  receivedBytes: number;
  startedAt: number;
  lastProgressEmitAt: number;
  windowStartAt: number;
  windowBytes: number;
  lastSpeedBytesPerSec: number;
  fileEndReceived: boolean;
  pendingDecryptions: number;
  endWaitCount: number;
  finalSha256?: string;
  finalized: boolean;
  endTimeout?: ReturnType<typeof setTimeout>;
  opfsPromise: Promise<OpfsReceiverState | null> | null;
  opfsState: OpfsReceiverState | null;
  opfsChain: Promise<void>;
  opfsFailed: boolean;
}

interface P2PCallbacks {
  onSendSignal: (
    targetPeerId: string,
    signalType: 'offer' | 'answer' | 'ice',
    payload: unknown,
    laneIndex?: number,
  ) => void;
  onPeerStateChange: (
    peerId: string,
    connected: boolean,
    pcState: string,
    lanesOpen?: number,
    routeType?: P2PRouteType,
  ) => void;
  onReceiveProgress: (info: {
    fileId: string;
    roomId: string;
    peerId: string;
    peerName: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    receivedBytes: number;
    completedChunks: number;
    totalChunks: number;
    speedBytesPerSec: number;
    sha256: string;
    encrypted: boolean;
  }) => void;
  onReceiveComplete: (info: {
    fileId: string;
    roomId: string;
    peerId: string;
    peerName: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    blob: Blob;
    sha256: string;
    verified: boolean;
    speedBytesPerSec: number;
    encrypted: boolean;
  }) => void;
  onReceiveError: (info: {
    fileId: string;
    roomId: string;
    peerId: string;
    peerName: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    encrypted: boolean;
  }) => void;
  getRoomOrPeerAesKey: (roomId: string, peerId: string) => Promise<CryptoKey | null>;
}

// Multi-socket WebRTC Swarm:
// 6 independent RTCPeerConnections (= 6 UDP sockets, 6 DTLS engines, 6 SCTP congestion windows)
// Lane 0 carries a dedicated ordered control channel + 2 unordered data channels;
// Lanes 1..5 carry 2 unordered data channels each (= 12 pure unordered data channels total).
const PEER_SOCKET_LANES = 6;
const DATA_CHANNELS_PER_LANE = 2;
const DEFAULT_P2P_CHUNK_SIZE = 128 * 1024; // 128 KB optimal WebKit/Chromium IPC & SCTP size
const SUPER_BLOCK_BYTES = 16 * 1024 * 1024; // 16 MB super-block disk prefetch
const PER_CHANNEL_HIGH_WATER = 2 * 1024 * 1024; // 2 MB per channel (4 MB per RTCPeerConnection, safely < 16 MB cap)
const PER_CHANNEL_LOW_WATER = 1024 * 1024; // 1 MB fires continuous bufferedamountlow before drain
const PROGRESS_EMIT_INTERVAL_MS = 120;
const MAX_HASH_BYTES = 128 * 1024 * 1024;
const OPFS_STREAM_THRESHOLD_BYTES = 32 * 1024 * 1024;

const COMPACT_MAGIC = 0x4b; // 'K'
const COMPACT_VERSION = 0x02;

const textDecoder = new TextDecoder();

function computeStreamId(fileId: string): number {
  let h = 2166136261;
  for (let i = 0; i < fileId.length; i++) {
    h ^= fileId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function writeCompactBinaryFrameInto(
  scratch: Uint8Array<ArrayBuffer>,
  scratchView: DataView,
  streamId: number,
  chunkIndex: number,
  iv: Uint8Array | null,
  payloadView: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const ivLen = iv ? 12 : 0;
  const headerLen = 12 + ivLen;
  scratch[0] = COMPACT_MAGIC;
  scratch[1] = COMPACT_VERSION;
  scratch[2] = iv ? 1 : 0;
  scratch[3] = 0;
  viewSetU32(scratchView, 4, streamId);
  viewSetU32(scratchView, 8, chunkIndex);
  if (iv) {
    scratch.set(iv, 12);
  }
  scratch.set(payloadView, headerLen);
  return scratch.subarray(0, headerLen + payloadView.byteLength);
}

function viewSetU32(view: DataView, offset: number, val: number): void {
  view.setUint32(offset, val >>> 0, true);
}

function packCompactBinaryFrame(
  streamId: number,
  chunkIndex: number,
  iv: Uint8Array | null,
  payloadView: Uint8Array,
): ArrayBuffer {
  const ivLen = iv ? 12 : 0;
  const headerLen = 12 + ivLen;
  const frame = new Uint8Array(headerLen + payloadView.byteLength);
  const view = new DataView(frame.buffer);
  writeCompactBinaryFrameInto(frame, view, streamId, chunkIndex, iv, payloadView);
  return frame.buffer;
}

function unpackBinaryChunkFrame(buffer: ArrayBuffer): {
  streamId?: number;
  fileId?: string;
  chunkIndex: number;
  iv: Uint8Array<ArrayBuffer> | null;
  payloadView: Uint8Array<ArrayBuffer>;
} | null {
  if (buffer.byteLength < 12) return null;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (bytes[0] === COMPACT_MAGIC && bytes[1] === COMPACT_VERSION) {
    const hasIv = bytes[2] === 1;
    const streamId = view.getUint32(4, true);
    const chunkIndex = view.getUint32(8, true);
    const headerLen = 12 + (hasIv ? 12 : 0);
    if (buffer.byteLength < headerLen) return null;
    const iv = hasIv ? new Uint8Array(buffer, 12, 12) : null;
    const payloadView = new Uint8Array(buffer, headerLen);
    return { streamId, chunkIndex, iv, payloadView };
  }

  const fileIdLen = view.getUint32(0, true);
  if (fileIdLen === 0 || fileIdLen > 128 || buffer.byteLength < 4 + fileIdLen + 5) {
    return null;
  }
  const fileId = textDecoder.decode(new Uint8Array(buffer, 4, fileIdLen));
  const idxOffset = 4 + fileIdLen;
  const chunkIndex = view.getUint32(idxOffset, true);
  const hasIv = view.getUint8(idxOffset + 4) === 1;
  const headerLen = idxOffset + 5 + (hasIv ? 12 : 0);
  if (buffer.byteLength < headerLen) return null;

  const iv = hasIv ? new Uint8Array(buffer, idxOffset + 5, 12) : null;
  const payloadView = new Uint8Array(buffer, headerLen);
  return { fileId, chunkIndex, iv, payloadView };
}

function laneKey(peerId: string, laneIndex: number): string {
  return `${peerId}::${laneIndex}`;
}

async function openOpfsTempWriter(streamId: number): Promise<OpfsReceiverState | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const fileName = `kd-rx-${streamId}-${Date.now()}.bin`;
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    if (typeof fileHandle.createWritable !== 'function') {
      return null;
    }
    const writable = await fileHandle.createWritable();
    return { root, fileName, fileHandle, writable };
  } catch {
    return null;
  }
}

export class WifiDirectManager {
  private localPeerId = '';
  private connections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel[]>();
  private controlChannels = new Map<string, RTCDataChannel>();
  private connectingPromises = new Map<string, Promise<boolean>>();
  private makingOffer = new Map<string, boolean>();
  private pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private incomingTransfers = new Map<string, IncomingP2PTransfer>();
  private streamIdToFileId = new Map<number, string>();
  private earlyChunksByStream = new Map<number, EarlyChunkItem[]>();
  private pendingBinaryMeta = new Map<
    string,
    { fileId: string; chunkIndex: number; iv?: string }
  >();
  private peerRouteTypes = new Map<string, P2PRouteType>();
  private roundRobinCursor = 0;
  private callbacks: P2PCallbacks;

  constructor(callbacks: P2PCallbacks) {
    this.callbacks = callbacks;
    void this.cleanupStaleOpfsTempFiles();
  }

  private async cleanupStaleOpfsTempFiles(): Promise<void> {
    try {
      if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
      const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
        keys?: () => AsyncIterableIterator<string>;
      };
      if (typeof root.keys !== 'function') return;
      for await (const name of root.keys()) {
        if (name.startsWith('kd-rx-')) {
          await root.removeEntry(name).catch(() => {});
        }
      }
    } catch {
      // Ignore OPFS cleanup failures
    }
  }

  public setLocalPeerId(peerId: string): void {
    this.localPeerId = peerId;
  }

  private getOpenSocketLaneCount(peerId: string): number {
    let count = 0;
    for (let lane = 0; lane < PEER_SOCKET_LANES; lane++) {
      const list = this.dataChannels.get(laneKey(peerId, lane)) ?? [];
      if (list.some((dc) => dc.readyState === 'open')) {
        count++;
      }
    }
    return count;
  }

  // Returns pure unordered open DataChannels interleaved by RTCPeerConnection socket lane
  // so bulk frames stripe evenly across all 6 UDP/DTLS/SCTP sockets with zero control-channel blocking.
  private getOpenDataChannels(peerId: string): RTCDataChannel[] {
    const perLane: RTCDataChannel[][] = [];
    for (let lane = 0; lane < PEER_SOCKET_LANES; lane++) {
      const open = (this.dataChannels.get(laneKey(peerId, lane)) ?? []).filter(
        (dc) => dc.readyState === 'open' && dc.label !== 'kiremdata-ctrl',
      );
      if (open.length > 0) perLane.push(open);
    }

    const interleaved: RTCDataChannel[] = [];
    for (let chIdx = 0; chIdx < DATA_CHANNELS_PER_LANE; chIdx++) {
      for (let laneIdx = 0; laneIdx < perLane.length; laneIdx++) {
        const dc = perLane[laneIdx][chIdx];
        if (dc) interleaved.push(dc);
      }
    }

    // Fallback to any open channel (e.g. legacy peers) if dedicated data lanes aren't ready yet
    if (interleaved.length === 0) {
      const ctrl = this.controlChannels.get(peerId);
      if (ctrl && ctrl.readyState === 'open') {
        interleaved.push(ctrl);
      }
    }
    return interleaved;
  }

  public isPeerConnected(peerId: string): boolean {
    return this.getOpenDataChannels(peerId).length > 0;
  }

  public getPeerConnectionSummary(peerId: string): {
    connected: boolean;
    lanesOpen: number;
    routeType: P2PRouteType;
  } {
    const lanesOpen = this.getOpenSocketLaneCount(peerId);
    return {
      connected: lanesOpen > 0,
      lanesOpen,
      routeType: this.peerRouteTypes.get(peerId) ?? 'unknown',
    };
  }

  private async refreshRouteType(peerId: string, pc: RTCPeerConnection): Promise<void> {
    try {
      const stats = await pc.getStats();
      let selectedPair: { localCandidateId?: string; remoteCandidateId?: string } | null = null;
      const candidates = new Map<string, { candidateType?: string }>();

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report.nominated || report.state === 'succeeded')) {
          selectedPair = report as { localCandidateId?: string; remoteCandidateId?: string };
        } else if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidates.set(report.id, report as { candidateType?: string });
        }
      });

      let detected: P2PRouteType = 'unknown';
      if (selectedPair) {
        const pair = selectedPair as { localCandidateId?: string; remoteCandidateId?: string };
        const localType = pair.localCandidateId
          ? candidates.get(pair.localCandidateId)?.candidateType
          : undefined;
        const remoteType = pair.remoteCandidateId
          ? candidates.get(pair.remoteCandidateId)?.candidateType
          : undefined;

        if (localType === 'relay' || remoteType === 'relay') {
          detected = 'relay';
        } else if (localType === 'host' && remoteType === 'host') {
          detected = 'lan-direct';
        } else if (localType || remoteType) {
          detected = 'stun-nat';
        }
      }

      this.peerRouteTypes.set(peerId, detected);
      const lanesOpen = this.getOpenSocketLaneCount(peerId);
      this.callbacks.onPeerStateChange(
        peerId,
        lanesOpen > 0,
        lanesOpen > 0 ? 'connected' : pc.connectionState,
        lanesOpen,
        detected,
      );
    } catch {
      // Ignore stats unsupported errors
    }
  }

  private async connectSingleLane(peerId: string, lane: number): Promise<boolean> {
    const key = laneKey(peerId, lane);
    const existingOpen = (this.dataChannels.get(key) ?? []).some((dc) => dc.readyState === 'open');
    if (existingOpen) return true;

    const pc = this.createPeerConnection(peerId, lane);
    const existingList = this.dataChannels.get(key) ?? [];

    if (existingList.length === 0) {
      if (lane === 0) {
        const ctrlDc = pc.createDataChannel('kiremdata-ctrl', { ordered: true });
        this.setupDataChannel(peerId, lane, ctrlDc);
      }
      for (let i = 0; i < DATA_CHANNELS_PER_LANE; i++) {
        const dc = pc.createDataChannel(`kiremdata-l${lane}-d${i}`, {
          ordered: false,
        });
        this.setupDataChannel(peerId, lane, dc);
      }
    }

    try {
      this.makingOffer.set(key, true);
      const offer = await pc.createOffer();
      if (pc.signalingState !== 'stable') {
        return this.isPeerConnected(peerId);
      }
      await pc.setLocalDescription(offer);
      this.callbacks.onSendSignal(peerId, 'offer', pc.localDescription ?? offer, lane);
    } catch {
      return false;
    } finally {
      this.makingOffer.set(key, false);
    }

    return true;
  }

  public async connectToPeer(peerId: string): Promise<boolean> {
    const openLanes = this.getOpenSocketLaneCount(peerId);
    if (openLanes >= PEER_SOCKET_LANES) return true;

    const inflight = this.connectingPromises.get(peerId);
    if (inflight) return inflight;

    const connectPromise = (async () => {
      // Initiate all missing RTCPeerConnection socket lanes concurrently
      await Promise.all(
        Array.from({ length: PEER_SOCKET_LANES }, (_, lane) => this.connectSingleLane(peerId, lane)),
      );

      if (this.isPeerConnected(peerId)) return true;

      return await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          clearInterval(checkInterval);
          resolve(this.isPeerConnected(peerId));
        }, 5500);

        const checkInterval = setInterval(() => {
          if (this.isPeerConnected(peerId)) {
            clearTimeout(timeout);
            clearInterval(checkInterval);
            resolve(true);
          }
        }, 25);
      });
    })();

    this.connectingPromises.set(peerId, connectPromise);
    try {
      return await connectPromise;
    } finally {
      this.connectingPromises.delete(peerId);
    }
  }

  public async handleSignal(
    fromPeerId: string,
    signalType: 'offer' | 'answer' | 'ice',
    payload: unknown,
    laneIndex = 0,
  ): Promise<void> {
    const lane = Math.max(0, Math.min(PEER_SOCKET_LANES - 1, laneIndex));
    const key = laneKey(fromPeerId, lane);

    if (signalType === 'offer') {
      const pc = this.createPeerConnection(fromPeerId, lane, true);
      const polite = this.localPeerId ? this.localPeerId < fromPeerId : true;
      const offerCollision = this.makingOffer.get(key) || pc.signalingState !== 'stable';

      if (offerCollision && !polite) {
        return;
      }

      try {
        if (offerCollision && polite && pc.signalingState === 'have-local-offer') {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(
          new RTCSessionDescription(payload as RTCSessionDescriptionInit),
        );
        await this.flushPendingIce(key, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.callbacks.onSendSignal(fromPeerId, 'answer', pc.localDescription ?? answer, lane);
      } catch {
        // Ignore transient glare errors
      }
    } else if (signalType === 'answer') {
      const pc = this.connections.get(key);
      if (pc && pc.signalingState !== 'stable') {
        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription(payload as RTCSessionDescriptionInit),
          );
          await this.flushPendingIce(key, pc);
        } catch {
          // Ignore stale answer
        }
      }
    } else if (signalType === 'ice') {
      const candidate = payload as RTCIceCandidateInit;
      const pc = this.connections.get(key);
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          // Ignore late/stale ICE candidates
        }
      } else if (candidate) {
        const queued = this.pendingIceCandidates.get(key) ?? [];
        queued.push(candidate);
        this.pendingIceCandidates.set(key, queued);
      }
    }
  }

  private async flushPendingIce(key: string, pc: RTCPeerConnection): Promise<void> {
    const queued = this.pendingIceCandidates.get(key);
    if (!queued || queued.length === 0) return;
    this.pendingIceCandidates.delete(key);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignore stale ICE
      }
    }
  }

  private pickWritableChannel(channels: RTCDataChannel[]): RTCDataChannel | null {
    const len = channels.length;
    if (len === 0) return null;

    let best: RTCDataChannel | null = null;
    let lowestBuffered = Number.POSITIVE_INFINITY;

    for (let offset = 0; offset < len; offset++) {
      const idx = (this.roundRobinCursor + offset) % len;
      const dc = channels[idx];
      if (dc.readyState !== 'open') continue;
      if (dc.bufferedAmount <= PER_CHANNEL_LOW_WATER) {
        this.roundRobinCursor = (idx + 1) % len;
        return dc;
      }
      if (dc.bufferedAmount < lowestBuffered) {
        lowestBuffered = dc.bufferedAmount;
        best = dc;
      }
    }

    if (best) {
      this.roundRobinCursor = (this.roundRobinCursor + 1) % len;
    }
    return best;
  }

  private async waitForPoolDrain(channels: RTCDataChannel[]): Promise<RTCDataChannel | null> {
    const open = channels.filter((dc) => dc.readyState === 'open');
    if (open.length === 0) return null;

    const readyNow = this.pickWritableChannel(open);
    if (readyNow && readyNow.bufferedAmount <= PER_CHANNEL_HIGH_WATER) {
      return readyNow;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const cleanups: Array<() => void> = [];
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const fn of cleanups) fn();
        resolve();
      };

      for (const dc of open) {
        dc.addEventListener('bufferedamountlow', done);
        cleanups.push(() => dc.removeEventListener('bufferedamountlow', done));
      }

      const timer = setTimeout(done, 2);
    });

    return this.pickWritableChannel(channels);
  }

  public async sendFileDirect(params: {
    peerId: string;
    roomId: string;
    senderId: string;
    senderName: string;
    fileId: string;
    file: File;
    sha256: string;
    aesKey: CryptoKey | null;
    onProgress: (
      transferredBytes: number,
      completedChunks: number,
      totalChunks: number,
      speedBytesPerSec: number,
    ) => void;
    shouldPauseOrAbort: () => 'run' | 'pause' | 'abort';
  }): Promise<boolean> {
    // Non-blockingly top up any missing socket lanes so speed ramps across all 6 sockets
    if (this.getOpenSocketLaneCount(params.peerId) < PEER_SOCKET_LANES) {
      void this.connectToPeer(params.peerId);
    }

    const allDataChannels = this.getOpenDataChannels(params.peerId);
    const controlDc =
      this.controlChannels.get(params.peerId)?.readyState === 'open'
        ? this.controlChannels.get(params.peerId)!
        : allDataChannels[0];

    if (!controlDc || controlDc.readyState !== 'open' || allDataChannels.length === 0) {
      return false;
    }

    const pc0 = this.connections.get(laneKey(params.peerId, 0));
    const maxSctpMsg = pc0?.sctp?.maxMessageSize || 262144;
    const chunkSize = Math.max(32 * 1024, Math.min(DEFAULT_P2P_CHUNK_SIZE, maxSctpMsg - 512));
    const totalChunks = Math.max(1, Math.ceil(params.file.size / chunkSize));
    const startedAt = performance.now();
    const streamId = computeStreamId(params.fileId);
    const isEncrypted = !!params.aesKey;

    for (const dc of allDataChannels) {
      dc.bufferedAmountLowThreshold = PER_CHANNEL_LOW_WATER;
    }

    controlDc.send(
      JSON.stringify({
        kind: 'file-start',
        fileId: params.fileId,
        streamId,
        roomId: params.roomId,
        senderId: params.senderId,
        senderName: params.senderName,
        fileName: params.file.name,
        fileSize: params.file.size,
        mimeType: params.file.type || 'application/octet-stream',
        chunkSize,
        totalChunks,
        sha256: params.sha256,
        encrypted: isEncrypted,
      }),
    );

    const chunksPerBlock = Math.max(1, Math.floor(SUPER_BLOCK_BYTES / chunkSize));
    const superBlockSize = chunksPerBlock * chunkSize;
    const totalBlocks = Math.max(1, Math.ceil(params.file.size / superBlockSize));

    const readSuperBlock = (blockIdx: number): Promise<ArrayBuffer> => {
      const bStart = blockIdx * superBlockSize;
      const bEnd = Math.min(params.file.size, bStart + superBlockSize);
      return params.file.slice(bStart, bEnd).arrayBuffer();
    };

    let nextBlockPromise: Promise<ArrayBuffer> | null = totalBlocks > 0 ? readSuperBlock(0) : null;

    // Zero-GC reusable scratch frame buffer for Mode Super (W3C send() synchronously copies bytes)
    const scratchBuf = new Uint8Array(12 + chunkSize);
    const scratchView = new DataView(scratchBuf.buffer);

    let sentBytes = 0;
    let completedChunks = 0;
    let lastProgressAt = 0;
    let windowStartAt = startedAt;
    let windowBytes = 0;
    let smoothedSpeed = 0;

    for (let blockIdx = 0; blockIdx < totalBlocks; blockIdx++) {
      const currentBlockPromise = nextBlockPromise ?? readSuperBlock(blockIdx);
      nextBlockPromise = blockIdx + 1 < totalBlocks ? readSuperBlock(blockIdx + 1) : null;

      const blockBuffer = await currentBlockPromise;
      const blockBaseChunk = blockIdx * chunksPerBlock;
      const blockChunksCount =
        params.file.size === 0
          ? 1
          : Math.min(chunksPerBlock, totalChunks - blockBaseChunk);

      if (!isEncrypted) {
        let activePool = this.getOpenDataChannels(params.peerId);
        for (let localIdx = 0; localIdx < blockChunksCount; localIdx++) {
          if (params.shouldPauseOrAbort() === 'pause') {
            while (params.shouldPauseOrAbort() === 'pause') {
              await new Promise((r) => setTimeout(r, 80));
            }
          }
          if (params.shouldPauseOrAbort() === 'abort') {
            return false;
          }

          if ((localIdx & 15) === 0 || activePool.length === 0) {
            activePool = this.getOpenDataChannels(params.peerId);
            if (activePool.length === 0) return false;
          }

          let targetDc = this.pickWritableChannel(activePool);
          while (targetDc && targetDc.bufferedAmount > PER_CHANNEL_HIGH_WATER) {
            if (params.shouldPauseOrAbort() === 'abort') return false;
            targetDc = await this.waitForPoolDrain(activePool);
          }

          if (!targetDc || targetDc.readyState !== 'open') {
            activePool = this.getOpenDataChannels(params.peerId);
            targetDc = this.pickWritableChannel(activePool);
            if (!targetDc || targetDc.readyState !== 'open') return false;
          }

          if (targetDc.bufferedAmountLowThreshold !== PER_CHANNEL_LOW_WATER) {
            targetDc.bufferedAmountLowThreshold = PER_CHANNEL_LOW_WATER;
          }

          const chunkIndex = blockBaseChunk + localIdx;
          const relStart = localIdx * chunkSize;
          const relEnd = Math.min(blockBuffer.byteLength, relStart + chunkSize);
          const payloadView = new Uint8Array(blockBuffer, relStart, relEnd - relStart);

          // Copy into reusable scratch view & immediately pass to native SCTP buffer (zero heap allocs)
          const frameSlice = writeCompactBinaryFrameInto(
            scratchBuf,
            scratchView,
            streamId,
            chunkIndex,
            null,
            payloadView,
          );
          targetDc.send(frameSlice);

          const rawBytes = relEnd - relStart;
          sentBytes += rawBytes;
          windowBytes += rawBytes;
          completedChunks += 1;

          const now = performance.now();
          if (now - lastProgressAt >= PROGRESS_EMIT_INTERVAL_MS || completedChunks === totalChunks) {
            lastProgressAt = now;
            const windowSec = (now - windowStartAt) / 1000;
            if (windowSec >= 0.3) {
              const instantSpeed = windowBytes / windowSec;
              smoothedSpeed =
                smoothedSpeed > 0 ? smoothedSpeed * 0.4 + instantSpeed * 0.6 : instantSpeed;
              windowStartAt = now;
              windowBytes = 0;
            }
            const avgSpeed = sentBytes / Math.max(0.02, (now - startedAt) / 1000);
            params.onProgress(
              sentBytes,
              completedChunks,
              totalChunks,
              smoothedSpeed > 0 ? smoothedSpeed : avgSpeed,
            );
          }
        }
      } else {
        const aesKey = params.aesKey!;
        const ENCRYPT_BATCH = 12;
        for (let batchStart = 0; batchStart < blockChunksCount; batchStart += ENCRYPT_BATCH) {
          const batchEnd = Math.min(blockChunksCount, batchStart + ENCRYPT_BATCH);
          const preparedBatch = await Promise.all(
            Array.from({ length: batchEnd - batchStart }, async (_, offset) => {
              const localIdx = batchStart + offset;
              const chunkIndex = blockBaseChunk + localIdx;
              const relStart = localIdx * chunkSize;
              const relEnd = Math.min(blockBuffer.byteLength, relStart + chunkSize);
              const sliceBuf = blockBuffer.slice(relStart, relEnd);
              const enc = await encryptBinaryBufferRaw(aesKey, sliceBuf);
              return {
                rawBytes: relEnd - relStart,
                frame: packCompactBinaryFrame(
                  streamId,
                  chunkIndex,
                  enc.iv,
                  new Uint8Array(enc.data),
                ),
              };
            }),
          );

          for (const item of preparedBatch) {
            while (params.shouldPauseOrAbort() === 'pause') {
              await new Promise((r) => setTimeout(r, 80));
            }
            if (params.shouldPauseOrAbort() === 'abort') {
              return false;
            }

            const activePool = this.getOpenDataChannels(params.peerId);
            if (activePool.length === 0) return false;

            let targetDc = this.pickWritableChannel(activePool);
            while (targetDc && targetDc.bufferedAmount > PER_CHANNEL_HIGH_WATER) {
              if (params.shouldPauseOrAbort() === 'abort') return false;
              targetDc = await this.waitForPoolDrain(activePool);
            }

            if (!targetDc || targetDc.readyState !== 'open') {
              return false;
            }

            targetDc.send(item.frame);
            sentBytes += item.rawBytes;
            windowBytes += item.rawBytes;
            completedChunks += 1;

            const now = performance.now();
            if (now - lastProgressAt >= PROGRESS_EMIT_INTERVAL_MS || completedChunks === totalChunks) {
              lastProgressAt = now;
              const windowSec = (now - windowStartAt) / 1000;
              if (windowSec >= 0.3) {
                const instantSpeed = windowBytes / windowSec;
                smoothedSpeed =
                  smoothedSpeed > 0 ? smoothedSpeed * 0.4 + instantSpeed * 0.6 : instantSpeed;
                windowStartAt = now;
                windowBytes = 0;
              }
              const avgSpeed = sentBytes / Math.max(0.02, (now - startedAt) / 1000);
              params.onProgress(
                sentBytes,
                completedChunks,
                totalChunks,
                smoothedSpeed > 0 ? smoothedSpeed : avgSpeed,
              );
            }
          }
        }
      }
    }

    let drainWaits = 0;
    while (drainWaits < 350) {
      const activePool = this.getOpenDataChannels(params.peerId);
      if (activePool.length === 0) break;
      const totalBuffered = activePool.reduce((sum, dc) => sum + dc.bufferedAmount, 0);
      if (totalBuffered <= 32 * 1024) break;
      drainWaits++;
      await new Promise((r) => setTimeout(r, 6));
    }

    if (controlDc.readyState !== 'open') {
      return false;
    }

    controlDc.send(
      JSON.stringify({
        kind: 'file-end',
        fileId: params.fileId,
        sha256: params.sha256,
      }),
    );

    const finalElapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
    params.onProgress(sentBytes, totalChunks, totalChunks, sentBytes / finalElapsed);
    return true;
  }

  public closeAll(): void {
    for (const list of this.dataChannels.values()) {
      for (const dc of list) {
        dc.close();
      }
    }
    for (const pc of this.connections.values()) {
      pc.close();
    }
    this.dataChannels.clear();
    this.controlChannels.clear();
    this.connections.clear();
    this.connectingPromises.clear();
    this.pendingIceCandidates.clear();
    this.peerRouteTypes.clear();
  }

  private createPeerConnection(
    peerId: string,
    lane: number,
    resetIfDisconnected = false,
  ): RTCPeerConnection {
    const key = laneKey(peerId, lane);
    const existing = this.connections.get(key);
    if (
      existing &&
      existing.connectionState !== 'closed' &&
      existing.connectionState !== 'failed' &&
      (!resetIfDisconnected || existing.connectionState === 'connected')
    ) {
      return existing;
    }
    if (existing) {
      existing.close();
      this.dataChannels.delete(key);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      iceCandidatePoolSize: 8,
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.callbacks.onSendSignal(peerId, 'ice', event.candidate, lane);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed' && typeof pc.restartIce === 'function') {
        try {
          pc.restartIce();
        } catch {
          // Ignore ICE restart unsupported
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const lanesOpen = this.getOpenSocketLaneCount(peerId);
      const open = lanesOpen > 0;
      if (pc.connectionState === 'connected' && lane === 0) {
        void this.refreshRouteType(peerId, pc);
      } else {
        this.callbacks.onPeerStateChange(
          peerId,
          open,
          pc.connectionState,
          lanesOpen,
          this.peerRouteTypes.get(peerId) ?? 'unknown',
        );
      }
    };

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, lane, event.channel);
    };

    this.connections.set(key, pc);
    return pc;
  }

  private emitReceiveProgress(transfer: IncomingP2PTransfer, peerId: string): void {
    const now = performance.now();
    if (
      now - transfer.lastProgressEmitAt >= PROGRESS_EMIT_INTERVAL_MS ||
      transfer.receivedCount === transfer.totalChunks
    ) {
      transfer.lastProgressEmitAt = now;
      const windowSec = (now - transfer.windowStartAt) / 1000;
      if (windowSec >= 0.3) {
        const instant = transfer.windowBytes / windowSec;
        transfer.lastSpeedBytesPerSec =
          transfer.lastSpeedBytesPerSec > 0
            ? transfer.lastSpeedBytesPerSec * 0.4 + instant * 0.6
            : instant;
        transfer.windowStartAt = now;
        transfer.windowBytes = 0;
      }
      const avgSpeed = transfer.receivedBytes / Math.max(0.02, (now - transfer.startedAt) / 1000);
      this.callbacks.onReceiveProgress({
        fileId: transfer.fileId,
        roomId: transfer.roomId,
        peerId,
        peerName: transfer.senderName,
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        mimeType: transfer.mimeType,
        receivedBytes: transfer.receivedBytes,
        completedChunks: transfer.receivedCount,
        totalChunks: transfer.totalChunks,
        speedBytesPerSec:
          transfer.lastSpeedBytesPerSec > 0 ? transfer.lastSpeedBytesPerSec : avgSpeed,
        sha256: transfer.sha256,
        encrypted: transfer.encrypted,
      });
    }
  }

  private failIncomingTransfer(transfer: IncomingP2PTransfer, peerId: string): void {
    if (transfer.finalized) return;
    transfer.finalized = true;
    if (transfer.endTimeout) clearTimeout(transfer.endTimeout);
    this.incomingTransfers.delete(transfer.fileId);
    this.streamIdToFileId.delete(transfer.streamId);
    this.earlyChunksByStream.delete(transfer.streamId);
    if (transfer.opfsState) {
      void transfer.opfsState.writable.abort().catch(() => {});
      void transfer.opfsState.root.removeEntry(transfer.opfsState.fileName).catch(() => {});
    }
    this.callbacks.onReceiveError({
      fileId: transfer.fileId,
      roomId: transfer.roomId,
      peerId,
      peerName: transfer.senderName,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      mimeType: transfer.mimeType,
      encrypted: transfer.encrypted,
    });
  }

  private scheduleChunkWrite(
    transfer: IncomingP2PTransfer,
    chunkIndex: number,
    bytes: Uint8Array<ArrayBuffer> | ArrayBuffer,
  ): void {
    const byteLen = bytes.byteLength;
    if (transfer.writtenChunkMask[chunkIndex] === 1) return;
    transfer.writtenChunkMask[chunkIndex] = 1;
    transfer.receivedCount += 1;
    transfer.receivedBytes += byteLen;
    transfer.windowBytes += byteLen;

    if (transfer.opfsState && !transfer.opfsFailed) {
      const position = chunkIndex * transfer.chunkSize;
      const writable = transfer.opfsState.writable;
      transfer.opfsChain = transfer.opfsChain.then(async () => {
        try {
          await writable.write({ type: 'write', position, data: bytes });
        } catch {
          transfer.opfsFailed = true;
          transfer.chunks[chunkIndex] = bytes;
        }
      });
      return;
    }

    transfer.chunks[chunkIndex] = bytes;
  }

  private applyReceivedChunk(
    transfer: IncomingP2PTransfer,
    peerId: string,
    chunkIndex: number,
    rawIv: Uint8Array<ArrayBuffer> | null,
    rawPayloadView: Uint8Array<ArrayBuffer>,
    legacyIv?: string,
    legacyRawBuffer?: ArrayBuffer,
  ): void {
    if (transfer.finalized || chunkIndex < 0 || chunkIndex >= transfer.totalChunks) {
      return;
    }

    if (!transfer.encrypted) {
      this.scheduleChunkWrite(transfer, chunkIndex, rawPayloadView);
      this.emitReceiveProgress(transfer, peerId);

      if (transfer.fileEndReceived && transfer.receivedCount >= transfer.totalChunks) {
        void this.finalizeIncomingTransfer(transfer.fileId, peerId, transfer.finalSha256);
      }
      return;
    }
    if (!rawIv && !legacyIv) {
      this.failIncomingTransfer(transfer, peerId);
      return;
    }

    transfer.pendingDecryptions += 1;
    void (async () => {
      let chunkBuf: ArrayBuffer;
      const aesKey = transfer.aesKeyPromise ? await transfer.aesKeyPromise : null;
      if (!aesKey) throw new Error('Kunci dekripsi file tidak tersedia.');
      chunkBuf = rawIv
        ? await decryptBinaryBufferRaw(aesKey, rawIv, rawPayloadView)
        : await decryptBinaryBuffer(
            aesKey,
            legacyIv!,
            legacyRawBuffer ?? rawPayloadView.slice().buffer,
          );

      if (transfer.finalized) return;

      this.scheduleChunkWrite(transfer, chunkIndex, chunkBuf);
      this.emitReceiveProgress(transfer, peerId);

    })()
      .catch(() => this.failIncomingTransfer(transfer, peerId))
      .finally(() => {
        transfer.pendingDecryptions = Math.max(0, transfer.pendingDecryptions - 1);
        if (!transfer.finalized && transfer.fileEndReceived && transfer.receivedCount >= transfer.totalChunks) {
          void this.finalizeIncomingTransfer(transfer.fileId, peerId, transfer.finalSha256);
        }
      });
  }

  private setupDataChannel(peerId: string, lane: number, dc: RTCDataChannel): void {
    const key = laneKey(peerId, lane);
    dc.binaryType = 'arraybuffer';
    if (dc.label === 'kiremdata-ctrl' || (lane === 0 && dc.ordered && !this.controlChannels.has(peerId))) {
      this.controlChannels.set(peerId, dc);
    }

    const existing = (this.dataChannels.get(key) ?? []).filter(
      (c) => c.readyState !== 'closed' && c.readyState !== 'closing',
    );
    if (!existing.includes(dc)) {
      existing.push(dc);
    }
    this.dataChannels.set(key, existing);

    dc.onopen = () => {
      const lanesOpen = this.getOpenSocketLaneCount(peerId);
      const pc = this.connections.get(key);
      if (pc && lane === 0) {
        void this.refreshRouteType(peerId, pc);
      } else {
        this.callbacks.onPeerStateChange(
          peerId,
          lanesOpen > 0,
          'connected',
          lanesOpen,
          this.peerRouteTypes.get(peerId) ?? 'unknown',
        );
      }
    };

    dc.onclose = () => {
      if (this.controlChannels.get(peerId) === dc) {
        this.controlChannels.delete(peerId);
      }
      const remaining = (this.dataChannels.get(key) ?? []).filter(
        (c) => c !== dc && c.readyState !== 'closed' && c.readyState !== 'closing',
      );
      this.dataChannels.set(key, remaining);
      const lanesOpen = this.getOpenSocketLaneCount(peerId);
      this.callbacks.onPeerStateChange(
        peerId,
        lanesOpen > 0,
        lanesOpen > 0 ? 'connected' : 'disconnected',
        lanesOpen,
        this.peerRouteTypes.get(peerId) ?? 'unknown',
      );
    };

    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.kind === 'file-start') {
            const startedAt = performance.now();
            const aesKeyPromise = msg.encrypted
              ? this.callbacks.getRoomOrPeerAesKey(msg.roomId, peerId)
              : null;
            const streamId = Number(msg.streamId || computeStreamId(msg.fileId));
            const chunkSize = Number(msg.chunkSize || DEFAULT_P2P_CHUNK_SIZE);
            const useOpfs = Number(msg.fileSize || 0) >= OPFS_STREAM_THRESHOLD_BYTES;

            const transfer: IncomingP2PTransfer = {
              fileId: msg.fileId,
              streamId,
              roomId: msg.roomId,
              senderId: msg.senderId,
              senderName: msg.senderName,
              fileName: msg.fileName,
              fileSize: msg.fileSize,
              mimeType: msg.mimeType,
              chunkSize,
              totalChunks: msg.totalChunks,
              sha256: msg.sha256 || '',
              encrypted: !!msg.encrypted,
              aesKeyPromise,
              chunks: new Array(msg.totalChunks).fill(null),
              writtenChunkMask: new Uint8Array(msg.totalChunks),
              receivedCount: 0,
              receivedBytes: 0,
              startedAt,
              lastProgressEmitAt: 0,
              windowStartAt: startedAt,
              windowBytes: 0,
              lastSpeedBytesPerSec: 0,
              fileEndReceived: false,
              pendingDecryptions: 0,
              endWaitCount: 0,
              finalized: false,
              opfsPromise: useOpfs ? openOpfsTempWriter(streamId) : null,
              opfsState: null,
              opfsChain: Promise.resolve(),
              opfsFailed: false,
            };

            if (transfer.opfsPromise) {
              void transfer.opfsPromise.then((state) => {
                if (!state || transfer.finalized) return;
                transfer.opfsState = state;
                // Flush any early chunks already in RAM directly to OPFS SSD and free heap memory
                for (let idx = 0; idx < transfer.chunks.length; idx++) {
                  const pending = transfer.chunks[idx];
                  if (pending !== null) {
                    transfer.chunks[idx] = null;
                    const position = idx * transfer.chunkSize;
                    transfer.opfsChain = transfer.opfsChain.then(async () => {
                      try {
                        await state.writable.write({ type: 'write', position, data: pending });
                      } catch {
                        transfer.opfsFailed = true;
                        transfer.chunks[idx] = pending;
                      }
                    });
                  }
                }
              });
            }

            this.streamIdToFileId.set(streamId, msg.fileId);
            this.incomingTransfers.set(msg.fileId, transfer);

            const early = this.earlyChunksByStream.get(streamId);
            if (early && early.length > 0) {
              this.earlyChunksByStream.delete(streamId);
              for (const item of early) {
                this.applyReceivedChunk(
                  transfer,
                  peerId,
                  item.chunkIndex,
                  item.iv,
                  item.payloadView,
                );
              }
            }
          } else if (msg.kind === 'file-chunk-meta') {
            this.pendingBinaryMeta.set(peerId, {
              fileId: msg.fileId,
              chunkIndex: msg.chunkIndex,
              iv: msg.iv,
            });
          } else if (msg.kind === 'file-end') {
            const transfer = this.incomingTransfers.get(msg.fileId);
            if (!transfer) return;
            transfer.fileEndReceived = true;
            transfer.finalSha256 = msg.sha256;

            if (transfer.receivedCount >= transfer.totalChunks) {
              void this.finalizeIncomingTransfer(msg.fileId, peerId, msg.sha256);
            } else {
              const waitForPendingChunks = () => {
                if (transfer.finalized) return;
                if (transfer.pendingDecryptions > 0 && transfer.endWaitCount < 5) {
                  transfer.endWaitCount += 1;
                  transfer.endTimeout = setTimeout(waitForPendingChunks, 2500);
                  return;
                }
                if (transfer.receivedCount !== transfer.totalChunks) {
                  this.failIncomingTransfer(transfer, peerId);
                  return;
                }
                void this.finalizeIncomingTransfer(msg.fileId, peerId, transfer.finalSha256);
              };
              transfer.endTimeout = setTimeout(waitForPendingChunks, 2500);
            }
          }
        } catch {
          // Ignore malformed control frame
        }
        return;
      }

      if (!(event.data instanceof ArrayBuffer)) return;

      const legacyMeta = this.pendingBinaryMeta.get(peerId);
      let fileId: string | undefined;
      let streamId: number | undefined;
      let chunkIndex: number;
      let rawPayloadView: Uint8Array<ArrayBuffer>;
      let rawIv: Uint8Array<ArrayBuffer> | null = null;
      let legacyIv: string | undefined;

      if (legacyMeta) {
        this.pendingBinaryMeta.delete(peerId);
        fileId = legacyMeta.fileId;
        chunkIndex = legacyMeta.chunkIndex;
        legacyIv = legacyMeta.iv;
        rawPayloadView = new Uint8Array(event.data);
      } else {
        const unpacked = unpackBinaryChunkFrame(event.data);
        if (!unpacked) return;
        streamId = unpacked.streamId;
        fileId =
          unpacked.fileId ??
          (streamId !== undefined ? this.streamIdToFileId.get(streamId) : undefined);
        chunkIndex = unpacked.chunkIndex;
        rawIv = unpacked.iv;
        rawPayloadView = unpacked.payloadView;
      }

      if (!fileId && streamId !== undefined) {
        const q = this.earlyChunksByStream.get(streamId) ?? [];
        q.push({ chunkIndex, iv: rawIv, payloadView: rawPayloadView });
        this.earlyChunksByStream.set(streamId, q);
        return;
      }

      if (!fileId) return;
      const transfer = this.incomingTransfers.get(fileId);
      if (!transfer) return;

      this.applyReceivedChunk(
        transfer,
        peerId,
        chunkIndex,
        rawIv,
        rawPayloadView,
        legacyIv,
        event.data,
      );
    };
  }

  private async finalizeIncomingTransfer(
    fileId: string,
    peerId: string,
    finalSha256?: string,
  ): Promise<void> {
    const transfer = this.incomingTransfers.get(fileId);
    if (!transfer || transfer.finalized) return;
    if (
      transfer.receivedCount !== transfer.totalChunks ||
      transfer.receivedBytes !== transfer.fileSize
    ) {
      this.failIncomingTransfer(transfer, peerId);
      return;
    }
    transfer.finalized = true;
    if (transfer.endTimeout) {
      clearTimeout(transfer.endTimeout);
      transfer.endTimeout = undefined;
    }
    this.incomingTransfers.delete(fileId);
    this.streamIdToFileId.delete(transfer.streamId);
    this.earlyChunksByStream.delete(transfer.streamId);

    const expectedSha = finalSha256 || transfer.sha256;
    let blob: Blob;

    const opfsState =
      transfer.opfsState ?? (transfer.opfsPromise ? await transfer.opfsPromise : null);

    if (opfsState && !transfer.opfsFailed) {
      try {
        for (let idx = 0; idx < transfer.chunks.length; idx++) {
          const pending = transfer.chunks[idx];
          if (pending !== null) {
            transfer.chunks[idx] = null;
            const position = idx * transfer.chunkSize;
            transfer.opfsChain = transfer.opfsChain.then(async () => {
              await opfsState.writable.write({ type: 'write', position, data: pending });
            });
          }
        }
        await transfer.opfsChain;
        await opfsState.writable.close();
        const diskFile = await opfsState.fileHandle.getFile();
        blob = diskFile.slice(0, diskFile.size, transfer.mimeType);
      } catch {
        const validChunks = transfer.chunks.filter(
          (c): c is ArrayBuffer | Uint8Array<ArrayBuffer> => c !== null,
        );
        blob = new Blob(validChunks, { type: transfer.mimeType });
      }
    } else {
      const validChunks = transfer.chunks.filter(
        (c): c is ArrayBuffer | Uint8Array<ArrayBuffer> => c !== null,
      );
      blob = new Blob(validChunks, { type: transfer.mimeType });
    }

    transfer.chunks = [];

    let actualSha = expectedSha || '';
    let verified = false;

    if (transfer.encrypted && blob.size <= MAX_HASH_BYTES && expectedSha) {
      const fullBuffer = await blob.arrayBuffer();
      actualSha = await sha256Hex(fullBuffer);
      verified = actualSha === expectedSha;
    }

    if (expectedSha && blob.size <= MAX_HASH_BYTES && actualSha !== expectedSha) {
      if (opfsState) void opfsState.root.removeEntry(opfsState.fileName).catch(() => {});
      this.callbacks.onReceiveError({
        fileId: transfer.fileId,
        roomId: transfer.roomId,
        peerId,
        peerName: transfer.senderName,
        fileName: transfer.fileName,
        fileSize: transfer.fileSize,
        mimeType: transfer.mimeType,
        encrypted: transfer.encrypted,
      });
      return;
    }

    const elapsedSec = Math.max(0.02, (performance.now() - transfer.startedAt) / 1000);

    this.callbacks.onReceiveComplete({
      fileId: transfer.fileId,
      roomId: transfer.roomId,
      peerId,
      peerName: transfer.senderName,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      mimeType: transfer.mimeType,
      blob,
      sha256: actualSha,
      verified,
      speedBytesPerSec: transfer.receivedBytes / elapsedSec,
      encrypted: transfer.encrypted,
    });
  }
}
