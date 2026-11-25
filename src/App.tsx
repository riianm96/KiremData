import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  History,
  Lock,
  MessageSquare,
  MonitorDown,
  Radio,
  Send,
  Upload,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { ChatHeader } from './components/ChatHeader';
import { ClearChatModal, type DeleteDialogState } from './components/ClearChatModal';
import { CreateGroupModal } from './components/CreateGroupModal';
import { FilePreviewModal, type PreviewFileState } from './components/FilePreviewModal';
import { IncomingTransferModal } from './components/IncomingTransferModal';
import { InstallAppModal } from './components/InstallAppModal';
import { LanNetworkModal, type ProfileUpdateInput } from './components/LanNetworkModal';
import { MessageComposer } from './components/MessageComposer';
import { MessageList } from './components/MessageList';
import { OfflineIndicator } from './components/OfflineIndicator';
import { QuickSendView } from './components/QuickSendView';
import { ReceiveView } from './components/ReceiveView';
import { RightDrawer, type DrawerMode } from './components/RightDrawer';
import { SecurityModal } from './components/SecurityModal';
import { Sidebar } from './components/Sidebar';
import { ToastNotifications } from './components/ToastNotifications';
import { TransferHistoryView } from './components/TransferHistoryView';
import {
  notifyPendingOutboxCount,
  requestFlushChatOutbox,
  usePWAStatus,
} from './hooks/useOnlineStatus';
import { usePWAInstall } from './hooks/usePWAInstall';
import {
  arrayBufferToBase64,
  decryptPayload,
  deriveSharedAesKey,
  encryptPayload,
  exportAesKeyBase64,
  generateGroupAesKey,
  generateIdentityKeyPair,
  importAesKeyBase64,
  importPrivateKey,
  sha256Hex,
} from './services/crypto';
import {
  cancelLocalSendSession,
  isLocalLanOrigin,
  prepareLocalSendUpload,
  runConcurrentFileWorkers,
  saveBlobWithPickerOrDownload,
  streamUploadFileViaHttp,
} from './services/localsendStream';
import { playMessageNotificationSound } from './services/sound';
import {
  clearAllMessagesFromCache,
  clearRoomMessagesFromCache,
  deleteMessageFromCache,
  enqueueOfflineChatPacket,
  loadDeviceIdentity,
  loadCachedMessages,
  loadFileBlobFromCache,
  loadOfflineChatOutbox,
  removeOfflineChatPacket,
  saveFileBlobToCache,
  saveDeviceIdentity,
  saveMessageToCache,
  type PendingChatPacket,
} from './services/storage';
import { type P2PRouteType, WifiDirectManager } from './services/webrtc';
import type {
  ChatMessage,
  ChatRoom,
  DecryptedMessageContent,
  EncryptedBlob,
  FileTransferTask,
  IncomingPrepareOffer,
  LanPeer,
  NetworkStatusInfo,
  NotificationMode,
  PrimaryWorkspaceTab,
  QueuedSendFile,
  QuickSaveMode,
  ReplyPreview,
  ToastNotificationItem,
  TransferBatchFileItem,
  TransferBatchSession,
  TransferTransport,
  WireChatMessage,
} from './types/chat';
import { isMessageMentioningUser } from './utils/format';

const DEVICE_ID_KEY = 'lokachat_device_peer_id';
const DEVICE_NAME_KEY = 'lokachat_device_peer_name';
const DEVICE_PHONE_KEY = 'lokachat_device_peer_phone';
const DEVICE_SHOP_NOTE_KEY = 'lokachat_device_peer_shop_note';
const DEVICE_CUSTOM_NAME_SET_KEY = 'lokachat_device_custom_name_set';
const DEVICE_KEYS_KEY = 'lokachat_device_jwk_pair';
const LEGACY_SESSION_ID_KEY = 'lokachat_session_peer_id';
const LEGACY_SESSION_NAME_KEY = 'lokachat_session_peer_name';
const LEGACY_SESSION_KEYS_KEY = 'lokachat_session_jwk_pair';
const CLEARED_ROOMS_KEY = 'lokachat_cleared_rooms_at';
const DELETED_MSGS_KEY = 'lokachat_deleted_msg_ids';
const NOTIF_MODE_KEY = 'lokachat_notification_mode';
const ENCRYPT_FILES_KEY = 'kiremdata_encrypt_files_v2';
const QUICK_SAVE_KEY = 'kiremdata_quick_save';
const RECEIVE_PIN_KEY = 'kiremdata_receive_pin';

function readEncryptFilesSetting(): boolean {
  try {
    const val = localStorage.getItem(ENCRYPT_FILES_KEY);
    if (val === 'true') return true;
    if (val === 'false') return false;
  } catch {
    // Ignore storage errors
  }
  return true;
}

function readQuickSaveSetting(): QuickSaveMode {
  try {
    const val = localStorage.getItem(QUICK_SAVE_KEY);
    if (val === 'off' || val === 'contacts' || val === 'all') {
      return val;
    }
  } catch {
    // Ignore storage errors
  }
  return 'off'; // Default matches LocalSend behavior (prompt Accept/Reject unless enabled)
}

function readReceivePinSetting(): string {
  try {
    return localStorage.getItem(RECEIVE_PIN_KEY) ?? '';
  } catch {
    return '';
  }
}

function readNotificationMode(): NotificationMode {
  try {
    const val = localStorage.getItem(NOTIF_MODE_KEY);
    if (val === 'all' || val === 'mentions' || val === 'muted') {
      return val;
    }
  } catch {
    // Ignore storage errors
  }
  return 'all';
}

function readPersistentItem(key: string, legacySessionKey?: string): string | null {
  try {
    const val = localStorage.getItem(key);
    if (val) return val;
    if (legacySessionKey) {
      const legacy = sessionStorage.getItem(legacySessionKey);
      if (legacy) {
        localStorage.setItem(key, legacy);
        return legacy;
      }
    }
  } catch {
    // Fallback cleanly if storage is restricted
  }
  return legacySessionKey ? sessionStorage.getItem(legacySessionKey) : null;
}

function writePersistentItem(key: string, value: string, legacySessionKey?: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore quota/private mode errors
  }
  if (legacySessionKey) {
    try {
      sessionStorage.setItem(legacySessionKey, value);
    } catch {
      // Ignore
    }
  }
}

function readClearedRoomsMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CLEARED_ROOMS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeClearedRoomsMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(CLEARED_ROOMS_KEY, JSON.stringify(map));
  } catch {
    // Ignore
  }
}

function readDeletedMsgIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_MSGS_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function writeDeletedMsgIds(ids: Set<string>): void {
  try {
    localStorage.setItem(DELETED_MSGS_KEY, JSON.stringify(Array.from(ids).slice(-500)));
  } catch {
    // Ignore
  }
}

function makeDirectRoomId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<LanPeer | null>(null);
  const [peers, setPeers] = useState<LanPeer[]>([]);
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [inChatSearchQuery, setInChatSearchQuery] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [notificationMode, setNotificationMode] = useState<NotificationMode>(() =>
    readNotificationMode(),
  );
  const [encryptFiles, setEncryptFiles] = useState<boolean>(() => readEncryptFilesSetting());
  const [activePrimaryTab, setActivePrimaryTab] = useState<PrimaryWorkspaceTab>('chat');
  const [queuedFiles, setQueuedFiles] = useState<QueuedSendFile[]>([]);
  const [preferredSendTransport, setPreferredSendTransport] =
    useState<TransferTransport>(() => (isLocalLanOrigin() ? 'lan-sync' : 'wifi-direct'));
  const [quickSave, setQuickSave] = useState<QuickSaveMode>(() => readQuickSaveSetting());
  const [receivePin, setReceivePin] = useState<string>(() => readReceivePinSetting());
  const [networkInfo, setNetworkInfo] = useState<NetworkStatusInfo | null>(null);
  const [activeSendSession, setActiveSendSession] = useState<TransferBatchSession | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<IncomingPrepareOffer | null>(null);

  const muted = notificationMode === 'muted';
  const [p2pConnectedMap, setP2pConnectedMap] = useState<Record<string, boolean>>({});
  const [p2pRouteMap, setP2pRouteMap] = useState<
    Record<string, { lanesOpen: number; routeType: P2PRouteType }>
  >({});
  const [transfers, setTransfers] = useState<FileTransferTask[]>([]);
  const [toasts, setToasts] = useState<ToastNotificationItem[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');

  // Modals & PWA Install / Offline Status
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [lanModalOpen, setLanModalOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFileState | null>(null);
  const { isInstallable, isInstalled, platform, install: installPWA } = usePWAInstall();
  const { isOnline, swOfflineReady } = usePWAStatus();

  // Refs for crypto keys, WebSocket, WebRTC, and transfer controls
  const wsRef = useRef<WebSocket | null>(null);
  const myPrivateKeyRef = useRef<CryptoKey | null>(null);
  const myPublicJwkRef = useRef<JsonWebKey | null>(null);
  const myPeerIdRef = useRef<string>('');
  const myPeerNameRef = useRef<string>('');
  const identityAuthFailedRef = useRef(false);
  const myPeerPhoneRef = useRef<string>('');
  const myPeerShopNoteRef = useRef<string>('');
  const peersRef = useRef<LanPeer[]>([]);
  const roomsRef = useRef<ChatRoom[]>([]);
  const activeRoomIdRef = useRef<string | null>(null);
  const notificationModeRef = useRef<NotificationMode>(notificationMode);
  const quickSaveRef = useRef<QuickSaveMode>(quickSave);
  const receivePinRef = useRef<string>(receivePin);
  const lastActiveNotifModeRef = useRef<'all' | 'mentions'>(
    notificationMode === 'mentions' ? 'mentions' : 'all',
  );

  const directKeysCacheRef = useRef<Map<string, CryptoKey>>(new Map());
  const groupKeysCacheRef = useRef<Map<string, CryptoKey>>(new Map());
  const transferControlRef = useRef<Map<string, 'run' | 'pause' | 'abort'>>(new Map());
  const localFileRef = useRef<Map<string, Blob>>(new Map());
  const wifiDirectRef = useRef<WifiDirectManager | null>(null);
  const pendingSendResolversRef = useRef<
    Map<
      string,
      (decision: {
        accepted: boolean;
        acceptedFileIds?: string[];
        pinError?: string;
      }) => void
    >
  >(new Map());
  const sendAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const outboxFlushInFlightRef = useRef(false);
  const markQueuedMessageDeliveredRef = useRef<((messageId: string) => Promise<void>) | null>(null);
  const flushOfflineChatOutboxRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    roomsRef.current = rooms;
  }, [rooms]);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    notificationModeRef.current = notificationMode;
    if (notificationMode !== 'muted') {
      lastActiveNotifModeRef.current = notificationMode;
    }
    try {
      localStorage.setItem(NOTIF_MODE_KEY, notificationMode);
    } catch {
      // Ignore storage errors
    }
  }, [notificationMode]);

  useEffect(() => {
    try {
      localStorage.setItem(ENCRYPT_FILES_KEY, String(encryptFiles));
    } catch {
      // Ignore storage errors
    }
  }, [encryptFiles]);

  useEffect(() => {
    quickSaveRef.current = quickSave;
    try {
      localStorage.setItem(QUICK_SAVE_KEY, quickSave);
    } catch {
      // Ignore storage errors
    }
  }, [quickSave]);

  useEffect(() => {
    receivePinRef.current = receivePin;
    try {
      localStorage.setItem(RECEIVE_PIN_KEY, receivePin);
    } catch {
      // Ignore storage errors
    }
  }, [receivePin]);

  useEffect(() => {
    fetch('/api/network-info')
      .then((res) => {
        if (res.status === 401) {
          window.dispatchEvent(new Event('kiremdata:auth-required'));
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        if (data) setNetworkInfo(data as NetworkStatusInfo);
      })
      .catch(() => {});
  }, [wsConnected]);

  // Update browser tab title with unread count
  useEffect(() => {
    const totalUnread = rooms.reduce((acc, r) => acc + r.unreadCount, 0);
    document.title =
      totalUnread > 0
        ? `(${totalUnread}) KiremData — Pesan & Transfer Data Lokal`
        : 'KiremData — Pesan & Transfer Data Lokal';
  }, [rooms]);

  const getDirectAesKey = useCallback(async (peerId: string): Promise<CryptoKey | null> => {
    const cached = directKeysCacheRef.current.get(peerId);
    if (cached) return cached;
    const priv = myPrivateKeyRef.current;
    const peer = peersRef.current.find((p) => p.id === peerId);
    if (!priv || !peer?.publicKeyJwk) return null;

    const aes = await deriveSharedAesKey(priv, peer.publicKeyJwk);
    directKeysCacheRef.current.set(peerId, aes);
    return aes;
  }, []);

  const unwrapGroupKey = useCallback(
    async (room: ChatRoom): Promise<CryptoKey | null> => {
      const cached = groupKeysCacheRef.current.get(room.id);
      if (cached) return cached;

      const myId = myPeerIdRef.current;
      const wrappedEntry = room.wrappedGroupKeys?.[myId];
      if (!wrappedEntry) return null;

      const senderAes = await getDirectAesKey(wrappedEntry.senderId);
      if (!senderAes) return null;

      try {
        const decrypted = await decryptPayload<{ groupKeyBase64: string }>(
          senderAes,
          wrappedEntry.blob,
        );
        const groupKey = await importAesKeyBase64(decrypted.groupKeyBase64);
        groupKeysCacheRef.current.set(room.id, groupKey);
        return groupKey;
      } catch {
        return null;
      }
    },
    [getDirectAesKey],
  );

  const getRoomAesKey = useCallback(
    async (roomId: string, fallbackPeerId?: string): Promise<CryptoKey | null> => {
      const room = roomsRef.current.find((r) => r.id === roomId);
      if (room?.type === 'group') {
        return unwrapGroupKey(room);
      }
      if (room?.type === 'direct') {
        const otherId = room.memberIds.find((id) => id !== myPeerIdRef.current) ?? fallbackPeerId;
        if (otherId) return getDirectAesKey(otherId);
      }
      if (fallbackPeerId) {
        return getDirectAesKey(fallbackPeerId);
      }
      return null;
    },
    [getDirectAesKey, unwrapGroupKey],
  );

  const decryptWireMessage = useCallback(
    async (wire: WireChatMessage): Promise<ChatMessage> => {
      let content: DecryptedMessageContent | null = null;
      let decryptionError = false;

      if (wire.encryptedPayload) {
        const targetPeerId =
          wire.senderId === myPeerIdRef.current ? wire.recipientId : wire.senderId;
        const aesKey = await getRoomAesKey(wire.roomId, targetPeerId);
        if (aesKey) {
          try {
            content = await decryptPayload<DecryptedMessageContent>(aesKey, wire.encryptedPayload);
          } catch {
            decryptionError = true;
          }
        } else {
          decryptionError = true;
        }
      } else if (wire.plaintextFallback) {
        content = wire.plaintextFallback;
      }

      return {
        id: wire.id,
        roomId: wire.roomId,
        roomType: wire.roomType,
        senderId: wire.senderId,
        senderName: wire.senderName,
        type: wire.type,
        text: content?.text ?? (decryptionError ? 'Pesan terenkripsi tidak dapat didekode' : ''),
        fileMeta: content?.fileMeta,
        voiceMeta: content?.voiceMeta,
        replyTo: content?.replyTo,
        timestamp: wire.timestamp,
        status: wire.status,
        isEncrypted: !!wire.encryptedPayload,
        decryptionError,
        readBy: wire.readBy,
      };
    },
    [getRoomAesKey],
  );

  const pushToast = useCallback((item: ToastNotificationItem) => {
    setToasts((prev) => [item, ...prev].slice(0, 4));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== item.id));
    }, 5500);
  }, []);

  const markQueuedMessageDelivered = useCallback(async (messageId: string) => {
    const remaining = await removeOfflineChatPacket(messageId);
    notifyPendingOutboxCount(remaining);
    setMessages((prev) => {
      let updatedMsg: ChatMessage | null = null;
      const next = prev.map((m) => {
        if (m.id !== messageId || m.status === 'delivered' || m.status === 'read') {
          return m;
        }
        updatedMsg = { ...m, status: 'delivered' };
        return updatedMsg;
      });
      if (updatedMsg) {
        void saveMessageToCache(updatedMsg);
      }
      return next;
    });
  }, []);

  const flushOfflineChatOutbox = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (outboxFlushInFlightRef.current) return;
    outboxFlushInFlightRef.current = true;
    try {
      await requestFlushChatOutbox();
      if (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        navigator.serviceWorker.controller
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const pending = await loadOfflineChatOutbox();
      notifyPendingOutboxCount(pending.length);
      if (pending.length === 0) return;

      let deliveredCount = 0;
      for (const packet of pending) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        try {
          const res = await fetch('/api/chat/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(packet),
          });
          if (res.status === 401) {
            window.dispatchEvent(new Event('kiremdata:auth-required'));
            break;
          }
          if (res.ok && res.status === 200) {
            await markQueuedMessageDelivered(packet.id);
            deliveredCount++;
          }
        } catch {
          break;
        }
      }

      if (deliveredCount > 0) {
        pushToast({
          id: makeId('toast'),
          roomId: activeRoomIdRef.current ?? pending[0].roomId,
          senderName: 'BackgroundSync PWA',
          roomName: 'Sinkronisasi Otomatis',
          preview: `${deliveredCount} pesan offline berhasil terkirim otomatis.`,
          timestamp: Date.now(),
          type: 'text',
        });
      }
    } finally {
      outboxFlushInFlightRef.current = false;
    }
  }, [markQueuedMessageDelivered, pushToast]);

  useEffect(() => {
    markQueuedMessageDeliveredRef.current = markQueuedMessageDelivered;
  }, [markQueuedMessageDelivered]);

  useEffect(() => {
    flushOfflineChatOutboxRef.current = flushOfflineChatOutbox;
  }, [flushOfflineChatOutbox]);

  const syncRoomsWithMessages = useCallback(
    (nextMessages: ChatMessage[], baseRooms: ChatRoom[], allPeers: LanPeer[]) => {
      const myId = myPeerIdRef.current;
      const roomMap = new Map<string, ChatRoom>();

      for (const r of baseRooms) {
        roomMap.set(r.id, { ...r });
      }

      // Ensure every peer can be represented if direct messages exist
      for (const msg of nextMessages) {
        if (!roomMap.has(msg.roomId) && msg.roomType === 'direct') {
          const otherId = msg.senderId === myId ? '' : msg.senderId;
          const peer = allPeers.find((p) => p.id === otherId);
          if (peer) {
            roomMap.set(msg.roomId, {
              id: msg.roomId,
              type: 'direct',
              name: peer.name,
              avatar: peer.avatar,
              memberIds: [myId, peer.id],
              createdBy: peer.id,
              createdAt: msg.timestamp,
              unreadCount: 0,
            });
          }
        }
      }

      // Keep direct room names synced with latest peer profiles and update lastMessage previews
      for (const room of roomMap.values()) {
        if (room.type === 'direct') {
          const otherId = room.memberIds.find((id) => id !== myId);
          const peer = otherId ? allPeers.find((p) => p.id === otherId) : undefined;
          if (peer) {
            room.name = peer.name;
            room.avatar = peer.avatar;
          }
        }

        const roomMsgs = nextMessages
          .filter((m) => m.roomId === room.id)
          .sort((a, b) => a.timestamp - b.timestamp);
        const last = roomMsgs[roomMsgs.length - 1];
        if (last) {
          room.lastMessageTime = last.timestamp;
          room.lastMessageSender = last.senderName;
          room.lastMessageText =
            last.type === 'voice'
              ? `${last.senderName}: Pesan suara (${last.voiceMeta?.durationSec ?? 0}d)`
              : last.type === 'file'
                ? `${last.senderName}: Dokumen ${last.fileMeta?.name ?? ''}`
                : room.type === 'group'
                  ? `${last.senderName}: ${last.text}`
                  : last.text;
        } else {
          room.lastMessageTime = undefined;
          room.lastMessageSender = undefined;
          room.lastMessageText = undefined;
        }
      }

      return Array.from(roomMap.values());
    },
    [],
  );

  // Initialize persistent device identity keys, WebRTC Wi-Fi Direct manager, and WebSocket connection
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let handleNetworkOnline: (() => void) | null = null;
    let handleVisibilityChange: (() => void) | null = null;
    let handleSwMessage: ((event: MessageEvent) => void) | null = null;

    async function bootstrap() {
      // 1. Restore or generate persistent device peer ID & ECDH P-256 identity keys (localStorage)
      let peerId = readPersistentItem(DEVICE_ID_KEY, LEGACY_SESSION_ID_KEY);
      if (!peerId) {
        peerId = makeId('device');
      }
      writePersistentItem(DEVICE_ID_KEY, peerId, LEGACY_SESSION_ID_KEY);
      myPeerIdRef.current = peerId;

      let peerName = readPersistentItem(DEVICE_NAME_KEY, LEGACY_SESSION_NAME_KEY);
      if (!peerName) {
        const suffix = Math.floor(10 + Math.random() * 89);
        peerName = `Stasiun Kerja #${suffix}`;
      }
      writePersistentItem(DEVICE_NAME_KEY, peerName, LEGACY_SESSION_NAME_KEY);
      myPeerNameRef.current = peerName;

      const savedPhone = (readPersistentItem(DEVICE_PHONE_KEY) ?? '').trim().slice(0, 32);
      const savedShopNote = (readPersistentItem(DEVICE_SHOP_NOTE_KEY) ?? '').trim().slice(0, 160);
      myPeerPhoneRef.current = savedPhone;
      myPeerShopNoteRef.current = savedShopNote;

      let pubJwk: JsonWebKey;
      let privKey: CryptoKey;
      let fingerprint: string;

      const storedIdentity = await loadDeviceIdentity();
      if (storedIdentity) {
        pubJwk = storedIdentity.publicKeyJwk;
        privKey = storedIdentity.privateKey;
        fingerprint = storedIdentity.fingerprint;
      } else {
        const savedKeysRaw = readPersistentItem(DEVICE_KEYS_KEY, LEGACY_SESSION_KEYS_KEY);
        if (savedKeysRaw) {
          try {
            const parsed = JSON.parse(savedKeysRaw);
            pubJwk = parsed.publicKeyJwk;
            privKey = await importPrivateKey(parsed.privateKeyJwk);
            fingerprint = parsed.fingerprint;
            await saveDeviceIdentity({
              publicKeyJwk: pubJwk,
              privateKey: privKey,
              fingerprint,
            });
            try {
              localStorage.removeItem(DEVICE_KEYS_KEY);
              sessionStorage.removeItem(LEGACY_SESSION_KEYS_KEY);
            } catch {
              // The non-extractable IndexedDB key remains the preferred copy.
            }
          } catch {
            const gen = await generateIdentityKeyPair();
            pubJwk = gen.publicKeyJwk;
            privKey = gen.privateKey;
            fingerprint = gen.fingerprint;
            await saveDeviceIdentity({ publicKeyJwk: pubJwk, privateKey: privKey, fingerprint });
          }
        } else {
          const gen = await generateIdentityKeyPair();
          pubJwk = gen.publicKeyJwk;
          privKey = gen.privateKey;
          fingerprint = gen.fingerprint;
          await saveDeviceIdentity({ publicKeyJwk: pubJwk, privateKey: privKey, fingerprint });
        }
      }

      if (disposed) return;
      myPrivateKeyRef.current = privKey;
      myPublicJwkRef.current = pubJwk;

      const initialSelf: LanPeer = {
        id: peerId,
        name: peerName,
        phone: savedPhone || undefined,
        shopNote: savedShopNote || undefined,
        role: 'Perangkat Lokal',
        department: 'Kantor',
        avatar: '',
        deviceName: navigator.platform || 'Browser Lokal',
        localIp: '127.0.0.1',
        online: true,
        isLiveSession: true,
        publicKeyJwk: pubJwk,
        fingerprint,
        lastSeen: Date.now(),
      };
      setCurrentUser(initialSelf);

      // Load cached IndexedDB messages filtered by local deletions/clearances (and purge legacy dummy seed chats)
      const cachedMsgs = await loadCachedMessages();
      const clearedMap = readClearedRoomsMap();
      const deletedSet = readDeletedMsgIds();
      const dummyRooms = new Set(['group-engineering', 'group-operasional', 'group-desain']);
      const validCached = cachedMsgs.filter((m) => {
        const isDummy =
          m.id.startsWith('seed-msg-') ||
          m.id.startsWith('welcome-') ||
          dummyRooms.has(m.roomId);
        if (isDummy) {
          void deleteMessageFromCache(m.id);
          return false;
        }
        if (deletedSet.has(m.id)) return false;
        if (m.timestamp <= (clearedMap[m.roomId] ?? 0)) return false;
        return true;
      });
      if (!disposed && validCached.length > 0) {
        setMessages((prev) => (prev.length === 0 ? validCached : prev));
      }

      const pendingOutbox = await loadOfflineChatOutbox();
      if (!disposed) {
        notifyPendingOutboxCount(pendingOutbox.length);
      }

      // 2. Setup Wi-Fi Direct Multi-Socket WebRTC DataChannel Manager
      const rtc = new WifiDirectManager({
        onSendSignal: (targetPeerId, signalType, payload, laneIndex = 0) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'rtc:signal',
                payload: { targetPeerId, signalType, payload, laneIndex },
              }),
            );
          }
        },
        onPeerStateChange: (targetPeerId, connected, _pcState, lanesOpen = 0, routeType = 'unknown') => {
          setP2pConnectedMap((prev) =>
            prev[targetPeerId] === connected ? prev : { ...prev, [targetPeerId]: connected },
          );
          setP2pRouteMap((prev) => {
            const cur = prev[targetPeerId];
            if (cur && cur.lanesOpen === lanesOpen && cur.routeType === routeType) return prev;
            return { ...prev, [targetPeerId]: { lanesOpen, routeType } };
          });
        },
        onReceiveProgress: (() => {
          const lastUiSyncByFile = new Map<string, number>();
          return (info) => {
            const now = performance.now();
            const prevSync = lastUiSyncByFile.get(info.fileId) ?? 0;
            if (now - prevSync < 250 && info.completedChunks < info.totalChunks) {
              return;
            }
            lastUiSyncByFile.set(info.fileId, now);
            setTransfers((prev) => {
              const existing = prev.find((t) => t.fileId === info.fileId);
              const nextTask: FileTransferTask = {
                fileId: info.fileId,
                roomId: info.roomId,
                peerId: info.peerId,
                peerName: info.peerName,
                fileName: info.fileName,
                fileSize: info.fileSize,
                mimeType: info.mimeType,
                direction: 'receive',
                transport: 'wifi-direct',
                status: 'transferring',
                transferredBytes: info.receivedBytes,
                totalChunks: info.totalChunks,
                completedChunks: info.completedChunks,
                speedBytesPerSec: info.speedBytesPerSec,
                sha256: info.sha256,
                verified: false,
                startedAt: existing?.startedAt ?? Date.now(),
                encrypted: info.encrypted,
              };
              if (existing) {
                return prev.map((t) => (t.fileId === info.fileId ? nextTask : t));
              }
              return [nextTask, ...prev];
            });
          };
        })(),
        onReceiveComplete: async (info) => {
          localFileRef.current.set(info.fileId, info.blob);
          const localUrl = URL.createObjectURL(info.blob);
          setTransfers((prev) => {
            const existing = prev.find((t) => t.fileId === info.fileId);
            const completedTask: FileTransferTask = {
              fileId: info.fileId,
              roomId: info.roomId,
              peerId: info.peerId,
              peerName: info.peerName,
              fileName: info.fileName,
              fileSize: info.fileSize,
              mimeType: info.mimeType,
              direction: 'receive',
              transport: 'wifi-direct',
              status: 'completed',
              transferredBytes: info.fileSize,
              totalChunks: existing?.totalChunks ?? 1,
              completedChunks: existing?.totalChunks ?? 1,
              speedBytesPerSec: info.speedBytesPerSec,
              sha256: info.sha256,
              verified: info.verified,
              startedAt: existing?.startedAt ?? Date.now(),
              completedAt: Date.now(),
              localUrl,
              encrypted: info.encrypted,
            };
            if (existing) {
              return prev.map((t) => (t.fileId === info.fileId ? completedTask : t));
            }
            return [completedTask, ...prev];
          });
          if (info.blob.size <= 128 * 1024 * 1024) {
            void saveFileBlobToCache(info.fileId, info.fileName, info.mimeType, info.blob).catch(
              () => {},
            );
          }
          if (quickSaveRef.current === 'all') {
            pushToast({
              id: makeId('toast'),
              roomId: info.roomId,
              senderName: info.peerName,
              roomName: 'File Diterima (P2P)',
              preview: `Berhasil menerima ${info.fileName}`,
              timestamp: Date.now(),
              type: 'file',
            });
          }
        },
        onReceiveError: (info) => {
          const message = 'Validasi transfer terenkripsi gagal. File dibuang dan tidak dianggap selesai.';
          setTransfers((prev) => {
            const existing = prev.find((task) => task.fileId === info.fileId);
            const failed: FileTransferTask = {
              fileId: info.fileId,
              roomId: info.roomId,
              peerId: info.peerId,
              peerName: info.peerName,
              fileName: info.fileName,
              fileSize: info.fileSize,
              mimeType: info.mimeType,
              direction: 'receive',
              transport: 'wifi-direct',
              status: 'error',
              transferredBytes: existing?.transferredBytes ?? 0,
              totalChunks: existing?.totalChunks ?? 1,
              completedChunks: existing?.completedChunks ?? 0,
              speedBytesPerSec: 0,
              sha256: '',
              verified: false,
              startedAt: existing?.startedAt ?? Date.now(),
              errorMessage: message,
              encrypted: info.encrypted,
            };
            return existing
              ? prev.map((task) => (task.fileId === info.fileId ? failed : task))
              : [failed, ...prev];
          });
          pushToast({
            id: makeId('toast'),
            roomId: info.roomId,
            senderName: info.peerName,
            roomName: 'Transfer gagal',
            preview: `${info.fileName}: ${message}`,
            timestamp: Date.now(),
            type: 'file',
          });
        },
        getRoomOrPeerAesKey: (roomId, senderPeerId) => getRoomAesKey(roomId, senderPeerId),
      });
      rtc.setLocalPeerId(peerId);
      wifiDirectRef.current = rtc;

      // 3. Connect WebSocket to Local LAN Hub
      function connectWebSocket() {
        if (disposed || identityAuthFailedRef.current) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;
        let hadOpened = false;

        ws.onopen = () => {
          hadOpened = true;
          setWsConnected(true);
          const hasCustomName =
            readPersistentItem(DEVICE_CUSTOM_NAME_SET_KEY) === 'true' ||
            !/^(Stasiun Kerja|Perangkat Lokal)\s*#?\d*$/i.test(myPeerNameRef.current.trim());
          ws.send(
            JSON.stringify({
              type: 'peer:register',
              payload: {
                id: myPeerIdRef.current,
                name: myPeerNameRef.current,
                hasCustomName,
                phone: myPeerPhoneRef.current,
                shopNote: myPeerShopNoteRef.current,
                role: 'Anggota Tim Lokal',
                department: 'Kantor',
                avatar: '',
                deviceName: navigator.platform || 'Perangkat Lokal',
                publicKeyJwk: myPublicJwkRef.current,
              },
            }),
          );
        };

        ws.onmessage = async (event) => {
          try {
            const packet = JSON.parse(event.data);

            if (packet.type === 'peer:auth_error') {
              identityAuthFailedRef.current = true;
              setWsConnected(false);
              pushToast({
                id: makeId('toast'),
                roomId: '',
                senderName: 'KiremData',
                roomName: 'Identitas perangkat ditolak',
                preview: packet.payload?.error || 'Identitas perangkat tidak cocok. Hubungi pengelola sebelum mengatur ulang data browser.',
                timestamp: Date.now(),
                type: 'system',
              });
              return;
            }

            if (packet.type === 'sync:init') {
              const { selfPeer, peers: serverPeers, groups, messages: wireMessages } = packet.payload;
              if (selfPeer) {
                myPeerIdRef.current = selfPeer.id;
                myPeerNameRef.current = selfPeer.name;
                myPeerPhoneRef.current = selfPeer.phone ?? '';
                myPeerShopNoteRef.current = selfPeer.shopNote ?? '';
                writePersistentItem(DEVICE_ID_KEY, selfPeer.id, LEGACY_SESSION_ID_KEY);
                writePersistentItem(DEVICE_NAME_KEY, selfPeer.name, LEGACY_SESSION_NAME_KEY);
                writePersistentItem(DEVICE_PHONE_KEY, selfPeer.phone ?? '');
                writePersistentItem(DEVICE_SHOP_NOTE_KEY, selfPeer.shopNote ?? '');
                if (selfPeer.customNameSet) {
                  writePersistentItem(DEVICE_CUSTOM_NAME_SET_KEY, 'true');
                }
                setCurrentUser(selfPeer);
              }
              void flushOfflineChatOutboxRef.current?.();
              peersRef.current = serverPeers;
              setPeers(serverPeers);

              // Seed direct rooms with colleagues so WhatsApp list feels complete immediately
              const directSeedRooms: ChatRoom[] = serverPeers
                .filter((p: LanPeer) => p.id !== myPeerIdRef.current)
                .map((p: LanPeer) => ({
                  id: makeDirectRoomId(myPeerIdRef.current, p.id),
                  type: 'direct' as const,
                  name: p.name,
                  avatar: p.avatar,
                  memberIds: [myPeerIdRef.current, p.id],
                  createdBy: p.id,
                  createdAt: p.lastSeen - 600_000,
                  unreadCount: 0,
                }));

              const combinedRooms: ChatRoom[] = [...groups, ...directSeedRooms];
              roomsRef.current = combinedRooms;

              // Pre-unwrap group keys
              for (const grp of groups as ChatRoom[]) {
                await unwrapGroupKey(grp);
              }

              const decryptedList = await Promise.all(
                (wireMessages as WireChatMessage[]).map((wm) => decryptWireMessage(wm)),
              );

              const clearedRoomsAt = readClearedRoomsMap();
              const deletedIds = readDeletedMsgIds();
              const filteredIncoming = decryptedList.filter((m) => {
                if (deletedIds.has(m.id)) return false;
                if (m.timestamp <= (clearedRoomsAt[m.roomId] ?? 0)) return false;
                return true;
              });

              // Merge with cached messages idempotently while respecting local cleared/deleted records
              setMessages((prev) => {
                const map = new Map<string, ChatMessage>();
                for (const m of prev) {
                  if (!deletedIds.has(m.id) && m.timestamp > (clearedRoomsAt[m.roomId] ?? 0)) {
                    map.set(m.id, m);
                  }
                }
                for (const m of filteredIncoming) {
                  map.set(m.id, m);
                  saveMessageToCache(m);
                }
                const merged = Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
                setRooms(syncRoomsWithMessages(merged, combinedRooms, serverPeers));
                return merged;
              });

              setActiveRoomId((prev) => prev ?? groups[0]?.id ?? directSeedRooms[0]?.id ?? null);

              // Pre-warm direct P2P channels with live online peers so transfers start instantly
              for (const p of serverPeers as LanPeer[]) {
                if (
                  p.isLiveSession &&
                  p.online &&
                  p.id !== myPeerIdRef.current &&
                  myPeerIdRef.current < p.id &&
                  !rtc.isPeerConnected(p.id)
                ) {
                  void rtc.connectToPeer(p.id);
                }
              }
              return;
            }

            if (packet.type === 'peer:list') {
              const updatedPeers: LanPeer[] = packet.payload;
              peersRef.current = updatedPeers;
              setPeers(updatedPeers);
              // Ensure direct room titles immediately reflect saved/reconnected peer names
              setRooms((prevRooms) =>
                prevRooms.map((room) => {
                  if (room.type !== 'direct') return room;
                  const otherId = room.memberIds.find((id) => id !== myPeerIdRef.current);
                  const peer = otherId ? updatedPeers.find((p) => p.id === otherId) : undefined;
                  return peer ? { ...room, name: peer.name, avatar: peer.avatar } : room;
                }),
              );
              for (const p of updatedPeers) {
                if (
                  p.isLiveSession &&
                  p.online &&
                  p.id !== myPeerIdRef.current &&
                  myPeerIdRef.current < p.id &&
                  !rtc.isPeerConnected(p.id)
                ) {
                  void rtc.connectToPeer(p.id);
                }
              }
              return;
            }

            if (packet.type === 'group:created' || packet.type === 'group:updated') {
              const grp: ChatRoom = packet.payload;
              await unwrapGroupKey(grp);
              setRooms((prev) => {
                const exists = prev.some((r) => r.id === grp.id);
                const next = exists
                  ? prev.map((r) => (r.id === grp.id ? { ...r, ...grp } : r))
                  : [grp, ...prev];
                return next;
              });
              return;
            }

            if (packet.type === 'chat:message') {
              const wire: WireChatMessage = packet.payload;
              const dec = await decryptWireMessage(wire);
              saveMessageToCache(dec);

              setMessages((prev) => {
                if (prev.some((m) => m.id === dec.id)) return prev;
                const next = [...prev, dec].sort((a, b) => a.timestamp - b.timestamp);

                const isCurrentActive = activeRoomIdRef.current === dec.roomId;
                if (isCurrentActive && wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      type: 'chat:read',
                      payload: { roomId: dec.roomId, messageIds: [dec.id] },
                    }),
                  );
                }

                setRooms((prevRooms) => {
                  const updated = syncRoomsWithMessages(next, prevRooms, peersRef.current);
                  return updated.map((r) => {
                    if (r.id === dec.roomId && !isCurrentActive && dec.senderId !== myPeerIdRef.current) {
                      return { ...r, unreadCount: r.unreadCount + 1 };
                    }
                    return r;
                  });
                });

                if (dec.senderId !== myPeerIdRef.current) {
                  const mode = notificationModeRef.current;
                  const shouldNotify =
                    mode === 'all'
                      ? true
                      : mode === 'mentions'
                        ? isMessageMentioningUser(dec, myPeerNameRef.current)
                        : false;

                  if (shouldNotify) {
                    playMessageNotificationSound(false);
                    const roomObj = roomsRef.current.find((r) => r.id === dec.roomId);
                    const preview =
                      dec.type === 'file'
                        ? `Mengirim dokumen: ${dec.fileMeta?.name}`
                        : dec.type === 'voice'
                          ? `Mengirim pesan suara (${dec.voiceMeta?.durationSec ?? 0} detik)`
                          : dec.text;

                    if (!isCurrentActive || document.hidden) {
                      pushToast({
                        id: makeId('toast'),
                        roomId: dec.roomId,
                        senderName: dec.senderName,
                        roomName: roomObj?.name ?? dec.senderName,
                        preview,
                        timestamp: dec.timestamp,
                        type: dec.type,
                      });

                      if (
                        typeof Notification !== 'undefined' &&
                        Notification.permission === 'granted' &&
                        document.hidden
                      ) {
                        new Notification(`${dec.senderName} · ${roomObj?.name ?? 'KiremData'}`, {
                          body: preview,
                        });
                      }
                    }
                  }
                }

                return next;
              });
              return;
            }

            if (packet.type === 'chat:ack') {
              const { messageId, status } = packet.payload ?? {};
              if (typeof messageId === 'string') {
                void removeOfflineChatPacket(messageId).then((remaining) => {
                  notifyPendingOutboxCount(remaining);
                });
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== messageId) return m;
                    const nextMsg = { ...m, status };
                    void saveMessageToCache(nextMsg);
                    return nextMsg;
                  }),
                );
              }
              return;
            }

            if (packet.type === 'peer:typing') {
              const { roomId, peerId: typingId, isTyping } = packet.payload ?? {};
              setRooms((prev) =>
                prev.map((r) => {
                  if (r.id !== roomId) return r;
                  const current = r.typingUserIds ?? [];
                  const next = isTyping
                    ? Array.from(new Set([...current, typingId]))
                    : current.filter((id) => id !== typingId);
                  return { ...r, typingUserIds: next };
                }),
              );
              return;
            }

            if (packet.type === 'chat:message_deleted') {
              const { messageId } = packet.payload ?? {};
              if (typeof messageId === 'string') {
                const deleted = readDeletedMsgIds();
                deleted.add(messageId);
                writeDeletedMsgIds(deleted);
                void deleteMessageFromCache(messageId);
                setMessages((prev) => {
                  const next = prev.filter((m) => m.id !== messageId);
                  setRooms((prevRooms) => syncRoomsWithMessages(next, prevRooms, peersRef.current));
                  return next;
                });
              }
              return;
            }

            if (packet.type === 'chat:room_cleared') {
              const { roomId, clearedAt } = packet.payload ?? {};
              if (typeof roomId === 'string' && typeof clearedAt === 'number') {
                const cleared = readClearedRoomsMap();
                cleared[roomId] = Math.max(cleared[roomId] ?? 0, clearedAt);
                writeClearedRoomsMap(cleared);
                void clearRoomMessagesFromCache(roomId);
                setMessages((prev) => {
                  const next = prev.filter(
                    (m) => !(m.roomId === roomId && m.timestamp <= clearedAt),
                  );
                  setRooms((prevRooms) => syncRoomsWithMessages(next, prevRooms, peersRef.current));
                  return next;
                });
              }
              return;
            }

            if (packet.type === 'rtc:signal') {
              const { fromPeerId, signalType, payload, laneIndex } = packet.payload ?? {};
              if (fromPeerId && signalType) {
                await wifiDirectRef.current?.handleSignal(
                  fromPeerId,
                  signalType,
                  payload,
                  typeof laneIndex === 'number' ? laneIndex : 0,
                );
              }
              return;
            }

            if (packet.type === 'transfer:prepare') {
              const {
                sessionId,
                senderId,
                senderName,
                senderIp,
                senderDeviceName,
                files: offeredFiles,
                encryptFiles: offerEncrypted,
                transport: offerTransport,
              } = packet.payload ?? {};
              if (!sessionId || !senderId || !Array.isArray(offeredFiles)) return;

              const senderPeer = peersRef.current.find((p) => p.id === senderId);
              const isSavedContact = Boolean(senderPeer?.phone || senderPeer?.customNameSet);
              const hasPin = Boolean(receivePinRef.current);
              const autoAccept =
                !hasPin &&
                (quickSaveRef.current === 'all' ||
                  (quickSaveRef.current === 'contacts' && isSavedContact));

              if (autoAccept) {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(
                    JSON.stringify({
                      type: 'transfer:decision',
                      payload: {
                        targetPeerId: senderId,
                        sessionId,
                        accepted: true,
                        acceptedFileIds: offeredFiles.map((f: { fileId: string }) => f.fileId),
                      },
                    }),
                  );
                }
                pushToast({
                  id: makeId('toast'),
                  roomId: makeDirectRoomId(myPeerIdRef.current, senderId),
                  senderName: senderName || 'Perangkat Lokal',
                  roomName: 'Simpan Cepat',
                  preview: `Menerima ${offeredFiles.length} file secara otomatis...`,
                  timestamp: Date.now(),
                  type: 'file',
                });
                return;
              }

              if (notificationModeRef.current !== 'muted') {
                playMessageNotificationSound(false);
              }
              setIncomingOffer({
                sessionId,
                senderId,
                senderName: senderName || 'Perangkat Lokal',
                senderIp: senderIp || 'LAN',
                senderDeviceName: senderDeviceName || 'Perangkat Lokal',
                encryptFiles: !!offerEncrypted,
                transport: offerTransport === 'wifi-direct' ? 'wifi-direct' : 'lan-sync',
                requiresPin: hasPin,
                files: offeredFiles,
                createdAt: Date.now(),
              });
              return;
            }

            if (packet.type === 'transfer:decision') {
              const { sessionId, accepted, acceptedFileIds, pinError } = packet.payload ?? {};
              const resolver = pendingSendResolversRef.current.get(sessionId);
              if (resolver) {
                pendingSendResolversRef.current.delete(sessionId);
                resolver({
                  accepted: !!accepted,
                  acceptedFileIds,
                  pinError,
                });
              }
              return;
            }

            if (packet.type === 'transfer:cancel') {
              const { sessionId } = packet.payload ?? {};
              if (!sessionId) return;
              setIncomingOffer((prev) => (prev?.sessionId === sessionId ? null : prev));
              const abortCtrl = sendAbortControllersRef.current.get(sessionId);
              if (abortCtrl) abortCtrl.abort();
              const resolver = pendingSendResolversRef.current.get(sessionId);
              if (resolver) {
                pendingSendResolversRef.current.delete(sessionId);
                resolver({ accepted: false });
              }
              return;
            }

            if (packet.type === 'transfer:rx_progress') {
              const {
                senderId,
                senderName,
                fileId,
                name,
                size,
                mimeType,
                receivedBytes,
                speedBytesPerSec,
              } = packet.payload ?? {};
              if (!fileId || !name) return;
              const roomId = makeDirectRoomId(myPeerIdRef.current, senderId || 'lan');
              setTransfers((prev) => {
                const existing = prev.find((t) => t.fileId === fileId);
                if (existing?.status === 'completed') return prev;
                const nextTask: FileTransferTask = {
                  fileId,
                  roomId,
                  peerId: senderId,
                  peerName: senderName || 'Perangkat Lokal',
                  fileName: name,
                  fileSize: Number(size || 0),
                  mimeType: mimeType || 'application/octet-stream',
                  direction: 'receive',
                  transport: 'lan-sync',
                  status: 'transferring',
                  transferredBytes: Number(receivedBytes || 0),
                  totalChunks: 1,
                  completedChunks: 0,
                  speedBytesPerSec: Number(speedBytesPerSec || 0),
                  sha256: '',
                  verified: false,
                  startedAt: existing?.startedAt ?? Date.now(),
                  encrypted: false,
                };
                if (existing) {
                  return prev.map((t) => (t.fileId === fileId ? nextTask : t));
                }
                return [nextTask, ...prev];
              });
              return;
            }

            if (packet.type === 'transfer:file_ready') {
              const {
                senderId,
                senderName,
                fileId,
                name,
                size,
                mimeType,
                encrypted,
                transport,
                speedBytesPerSec,
                savedToDiskPath,
              } = packet.payload ?? {};
              if (!fileId || !name) return;

              const roomId = makeDirectRoomId(myPeerIdRef.current, senderId || 'lan');
              setTransfers((prev) => {
                const existing = prev.find((t) => t.fileId === fileId);
                if (existing?.status === 'completed') {
                  return prev;
                }
                const nextTask: FileTransferTask = {
                  fileId,
                  roomId,
                  peerId: senderId,
                  peerName: senderName || 'Perangkat Lokal',
                  fileName: name,
                  fileSize: Number(size || 0),
                  mimeType: mimeType || 'application/octet-stream',
                  direction: 'receive',
                  transport: transport === 'wifi-direct' ? 'wifi-direct' : 'lan-sync',
                  status: 'completed',
                  transferredBytes: Number(size || 0),
                  totalChunks: 1,
                  completedChunks: 1,
                  speedBytesPerSec: Number(speedBytesPerSec || 0),
                  sha256: '',
                  verified: !!encrypted,
                  startedAt: existing?.startedAt ?? Date.now(),
                  completedAt: Date.now(),
                  encrypted: !!encrypted,
                  savedToDiskPath: typeof savedToDiskPath === 'string' ? savedToDiskPath : undefined,
                };
                return [nextTask, ...prev.filter((t) => t.fileId !== fileId)];
              });

              if (notificationModeRef.current !== 'muted') {
                playMessageNotificationSound(false);
              }
              pushToast({
                id: makeId('toast'),
                roomId,
                senderName: senderName || 'Perangkat Lokal',
                roomName: 'File Diterima (HTTP Stream)',
                preview: `File siap disimpan: ${name}`,
                timestamp: Date.now(),
                type: 'file',
              });
            }
          } catch {
            // Ignore malformed incoming WS frame
          }
        };

        ws.onclose = (closeEvent) => {
          setWsConnected(false);
          if (disposed || identityAuthFailedRef.current) return;
          if (!hadOpened || closeEvent.code === 4401) {
            void fetch('/api/auth/session', { cache: 'no-store' })
              .then((res) => (res.ok ? res.json() : null))
              .then((data: { authenticated?: boolean } | null) => {
                if (disposed) return;
                if (data && data.authenticated === false) {
                  identityAuthFailedRef.current = true;
                  window.dispatchEvent(new Event('kiremdata:auth-required'));
                  return;
                }
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connectWebSocket, 2500);
              })
              .catch(() => {
                if (disposed) return;
                if (reconnectTimer) clearTimeout(reconnectTimer);
                reconnectTimer = setTimeout(connectWebSocket, 2500);
              });
            return;
          }
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectWebSocket, 2500);
        };
      }

      connectWebSocket();

      handleNetworkOnline = () => {
        if (disposed) return;
        const state = wsRef.current?.readyState;
        if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          connectWebSocket();
        } else if (state === WebSocket.OPEN) {
          void flushOfflineChatOutboxRef.current?.();
        }
      };

      handleVisibilityChange = () => {
        if (disposed || document.visibilityState !== 'visible') return;
        const state = wsRef.current?.readyState;
        if (state !== WebSocket.OPEN && state !== WebSocket.CONNECTING) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          connectWebSocket();
        }
      };

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        handleSwMessage = (event: MessageEvent) => {
          const data = event.data as
            | { type?: string; payload?: { id?: string; queueSize?: number } }
            | undefined;
          if (!data?.type) return;
          if (data.type === 'CHAT_BG_SYNC_QUEUED') {
            void loadOfflineChatOutbox().then((items) => {
              notifyPendingOutboxCount(Math.max(items.length, data.payload?.queueSize ?? 0));
            });
          } else if (data.type === 'CHAT_BG_SYNC_DELIVERED' && data.payload?.id) {
            void markQueuedMessageDeliveredRef.current?.(data.payload.id);
          }
        };
        navigator.serviceWorker.addEventListener('message', handleSwMessage);
      }

      window.addEventListener('online', handleNetworkOnline);
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    bootstrap();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (handleNetworkOnline) window.removeEventListener('online', handleNetworkOnline);
      if (handleVisibilityChange) document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (handleSwMessage && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
      wsRef.current?.close();
      wifiDirectRef.current?.closeAll();
    };
  }, [decryptWireMessage, getRoomAesKey, pushToast, syncRoomsWithMessages, unwrapGroupKey]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) ?? null,
    [rooms, activeRoomId],
  );

  const activeDirectPeer = useMemo(() => {
    if (!activeRoom || activeRoom.type !== 'direct' || !currentUser) return undefined;
    const otherId = activeRoom.memberIds.find((id) => id !== currentUser.id);
    return peers.find((p) => p.id === otherId);
  }, [activeRoom, peers, currentUser]);

  const activeMessages = useMemo(
    () => messages.filter((m) => m.roomId === activeRoomId),
    [messages, activeRoomId],
  );

  const transfersByFileId = useMemo(() => {
    const rec: Record<string, FileTransferTask> = {};
    for (const t of transfers) rec[t.fileId] = t;
    return rec;
  }, [transfers]);

  const typingNames = useMemo(() => {
    if (!activeRoom?.typingUserIds?.length) return [];
    return activeRoom.typingUserIds
      .map((id) => peers.find((p) => p.id === id)?.name)
      .filter((n): n is string => !!n);
  }, [activeRoom?.typingUserIds, peers]);

  const selectRoom = useCallback(
    (roomId: string) => {
      setActiveRoomId(roomId);
      setMobileView('chat');
      setReplyTo(null);
      setRooms((prev) => prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r)));

      // Mark unread messages in this room as read
      const unreadIds = messages
        .filter((m) => m.roomId === roomId && m.senderId !== myPeerIdRef.current && m.status !== 'read')
        .map((m) => m.id);
      if (unreadIds.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:read',
            payload: { roomId, messageIds: unreadIds },
          }),
        );
      }

      const targetRoom = roomsRef.current.find((r) => r.id === roomId);
      if (targetRoom?.type === 'direct' && wifiDirectRef.current) {
        const otherId = targetRoom.memberIds.find((id) => id !== myPeerIdRef.current);
        const otherPeer = otherId ? peersRef.current.find((p) => p.id === otherId) : undefined;
        if (otherPeer?.isLiveSession && otherPeer.online && !wifiDirectRef.current.isPeerConnected(otherPeer.id)) {
          void wifiDirectRef.current.connectToPeer(otherPeer.id);
        }
      }
    },
    [messages],
  );

  const handleStartDirectChat = useCallback(
    (peer: LanPeer) => {
      if (!currentUser) return;
      const roomId = makeDirectRoomId(currentUser.id, peer.id);
      setRooms((prev) => {
        if (prev.some((r) => r.id === roomId)) return prev;
        return [
          {
            id: roomId,
            type: 'direct',
            name: peer.name,
            avatar: peer.avatar,
            memberIds: [currentUser.id, peer.id],
            createdBy: currentUser.id,
            createdAt: Date.now(),
            unreadCount: 0,
          },
          ...prev,
        ];
      });
      selectRoom(roomId);
    },
    [currentUser, selectRoom],
  );

  const handleConnectP2P = useCallback(async (peerId: string) => {
    if (!wifiDirectRef.current) return;
    await wifiDirectRef.current.connectToPeer(peerId);
  }, []);

  const sendEncryptedMessage = useCallback(
    async (
      type: 'text' | 'voice' | 'file',
      content: DecryptedMessageContent,
    ) => {
      if (!activeRoom || !currentUser) return;
      const recipientId =
        activeRoom.type === 'direct'
          ? activeRoom.memberIds.find((id) => id !== currentUser.id)
          : undefined;

      const aesKey = await getRoomAesKey(activeRoom.id, recipientId);
      if (!aesKey) return;

      const encryptedPayload = await encryptPayload(aesKey, content);
      const msgId = makeId('msg');
      const timestamp = Date.now();
      const isChannelOnline =
        (typeof navigator === 'undefined' || navigator.onLine) &&
        wsRef.current?.readyState === WebSocket.OPEN;

      const optimistic: ChatMessage = {
        id: msgId,
        roomId: activeRoom.id,
        roomType: activeRoom.type,
        senderId: currentUser.id,
        senderName: currentUser.name,
        type,
        text: content.text ?? '',
        fileMeta: content.fileMeta,
        voiceMeta: content.voiceMeta,
        replyTo: content.replyTo,
        timestamp,
        status: isChannelOnline ? 'sent' : 'sending',
        isEncrypted: true,
      };

      saveMessageToCache(optimistic);
      setMessages((prev) => {
        const next = [...prev, optimistic];
        setRooms((prevRooms) => syncRoomsWithMessages(next, prevRooms, peersRef.current));
        return next;
      });
      setReplyTo(null);

      const wirePacket: PendingChatPacket = {
        id: msgId,
        roomId: activeRoom.id,
        roomType: activeRoom.type,
        senderId: currentUser.id,
        senderName: currentUser.name,
        recipientId,
        type,
        encryptedPayload,
        timestamp,
      };

      if (isChannelOnline && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:message',
            payload: wirePacket,
          }),
        );
        return;
      }

      // Offline or disconnected: save to local IDB outbox & dispatch through SW BackgroundSync route
      const queuedCount = await enqueueOfflineChatPacket(wirePacket);
      notifyPendingOutboxCount(queuedCount);

      try {
        const res = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(wirePacket),
        });
        if (res.status === 401) {
          window.dispatchEvent(new Event('kiremdata:auth-required'));
          return;
        }
        if (res.ok && res.status === 200) {
          await markQueuedMessageDelivered(msgId);
        }
      } catch {
        // Queued by SW BackgroundSync or retained in IDB outbox until 'online' fires
      }
    },
    [activeRoom, currentUser, getRoomAesKey, markQueuedMessageDelivered, syncRoomsWithMessages],
  );

  const handleSendText = useCallback(
    (text: string) => {
      sendEncryptedMessage('text', {
        text,
        replyTo: replyTo ?? undefined,
      });
    },
    [replyTo, sendEncryptedMessage],
  );

  const handleSendVoice = useCallback(
    async (blob: Blob, durationSec: number, waveform: number[]) => {
      const buffer = await blob.arrayBuffer();
      const audioBase64 = arrayBufferToBase64(buffer);
      await sendEncryptedMessage('voice', {
        text: '',
        voiceMeta: {
          voiceId: makeId('voice'),
          durationSec,
          mimeType: blob.type || 'audio/webm',
          waveform,
          audioBase64,
        },
        replyTo: replyTo ?? undefined,
      });
    },
    [replyTo, sendEncryptedMessage],
  );

  const handleSendFile = useCallback(
    async (file: File, preferredTransport: TransferTransport, encryptFileParam?: boolean) => {
      if (!activeRoom || !currentUser) return;
      const shouldEncrypt = encryptFileParam ?? encryptFiles;
      const fileId = makeId('file').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      const mimeType = file.type || 'application/octet-stream';

      // Zero-delay instant local registration without full-file RAM read or blocking IDB write
      localFileRef.current.set(fileId, file);
      const localUrl = URL.createObjectURL(file);

      // Compute SHA-256 after transfer finishes (skip full-file read for large files in Mode Super)
      const shaHashLimit = shouldEncrypt ? 128 * 1024 * 1024 : 16 * 1024 * 1024;
      let shaPromise: Promise<string> | null = null;
      const computePostTransferSha = () => {
        if (!shaPromise) {
          shaPromise = file.size <= shaHashLimit
            ? file.arrayBuffer().then((buf) => sha256Hex(buf)).catch(() => '')
            : Promise.resolve('');
        }
        return shaPromise;
      };

      const recipientId =
        activeRoom.type === 'direct'
          ? activeRoom.memberIds.find((id) => id !== currentUser.id)
          : undefined;
      const recipientPeer = recipientId ? peersRef.current.find((p) => p.id === recipientId) : undefined;
      const targetPeers: LanPeer[] =
        activeRoom.type === 'direct'
          ? (recipientPeer ? [recipientPeer] : [])
          : activeRoom.memberIds
              .filter((id) => id !== currentUser.id)
              .map((id) => peersRef.current.find((p) => p.id === id))
              .filter((p): p is LanPeer => Boolean(p));
      const onlineTargetPeers = targetPeers.filter((p) => p.isLiveSession && p.online);

      // Attempt real WebRTC DataChannel Wi-Fi Direct for live direct/group peers
      const p2pTargets: LanPeer[] = [];
      if (
        (preferredTransport === 'wifi-direct' || shouldEncrypt) &&
        onlineTargetPeers.length > 0 &&
        wifiDirectRef.current
      ) {
        const rtc = wifiDirectRef.current;
        const connectedPeers = await Promise.all(
          onlineTargetPeers.map(async (peer) => {
            const connected = rtc.isPeerConnected(peer.id)
              ? true
              : await rtc.connectToPeer(peer.id);
            return connected ? peer : null;
          }),
        );
        for (const peer of connectedPeers) {
          if (peer) p2pTargets.push(peer);
        }
      }
      const useP2P = p2pTargets.length > 0;

      const actualTransport: TransferTransport = useP2P ? 'wifi-direct' : 'lan-sync';
      const lanChunkSize =
        file.size >= 48 * 1024 * 1024
          ? 8 * 1024 * 1024
          : file.size >= 12 * 1024 * 1024
            ? 4 * 1024 * 1024
            : file.size >= 2 * 1024 * 1024
              ? 2 * 1024 * 1024
              : 512 * 1024;
      const initialTotalChunks = useP2P
        ? Math.max(1, Math.ceil(file.size / (240 * 1024)))
        : Math.max(1, Math.ceil(file.size / lanChunkSize));

      transferControlRef.current.set(fileId, 'run');

      const initialTask: FileTransferTask = {
        fileId,
        roomId: activeRoom.id,
        peerId: recipientId,
        peerName: activeRoom.name,
        fileName: file.name,
        fileSize: file.size,
        mimeType,
        direction: 'send',
        transport: actualTransport,
        status: 'transferring',
        transferredBytes: 0,
        totalChunks: initialTotalChunks,
        completedChunks: 0,
        speedBytesPerSec: 0,
        sha256: '',
        verified: false,
        startedAt: Date.now(),
        localUrl,
        encrypted: shouldEncrypt,
      };

      if (shouldEncrypt && !useP2P) {
        const errorMessage =
          activeRoom.type === 'group' && onlineTargetPeers.length === 0
            ? 'Belum ada anggota grup yang online untuk transfer file P2P terenkripsi. Tunggu anggota online atau matikan E2EE File untuk Mode Super.'
            : 'File terenkripsi memerlukan koneksi P2P langsung. Matikan enkripsi hanya jika Anda menerima risiko transfer LAN tanpa enkripsi.';
        setTransfers((prev) => [
          {
            ...initialTask,
            status: 'error',
            errorMessage,
          },
          ...prev,
        ]);
        return;
      }

      setTransfers((prev) => [initialTask, ...prev]);

      // Send chat timeline card immediately so live transfer telemetry appears right away
      void sendEncryptedMessage('file', {
        text: '',
        fileMeta: {
          fileId,
          name: file.name,
          size: file.size,
          mimeType,
          sha256: '',
          totalChunks: initialTotalChunks,
          transport: actualTransport,
          encrypted: shouldEncrypt,
        },
        replyTo: replyTo ?? undefined,
      });

      const aesKey = shouldEncrypt ? await getRoomAesKey(activeRoom.id, recipientId) : null;

      // 1. Direct WebRTC Wi-Fi Direct Turbo Multi-Channel Binary P2P Stream
      if (useP2P && wifiDirectRef.current) {
        const rtc = wifiDirectRef.current;
        const fileSha256 = shouldEncrypt ? await computePostTransferSha() : '';
        const peerProgress = new Map<string, { bytes: number; chunks: number; speed: number }>();
        let totalChunksKnown = initialTotalChunks;
        let successCount = 0;

        await runConcurrentFileWorkers(p2pTargets, 3, async (targetPeer) => {
          const p2pSuccess = await rtc.sendFileDirect({
            peerId: targetPeer.id,
            roomId: activeRoom.id,
            senderId: currentUser.id,
            senderName: currentUser.name,
            fileId,
            file,
            sha256: fileSha256,
            aesKey,
            shouldPauseOrAbort: () => transferControlRef.current.get(fileId) ?? 'run',
            onProgress: (transferredBytes, completedChunks, total, speedBytesPerSec) => {
              totalChunksKnown = total;
              peerProgress.set(targetPeer.id, {
                bytes: transferredBytes,
                chunks: completedChunks,
                speed: speedBytesPerSec,
              });
              let sumBytes = 0;
              let sumChunks = 0;
              let sumSpeed = 0;
              for (const entry of peerProgress.values()) {
                sumBytes += entry.bytes;
                sumChunks += entry.chunks;
                sumSpeed += entry.speed;
              }
              const divisor = Math.max(1, p2pTargets.length);
              setTransfers((prev) =>
                prev.map((t) =>
                  t.fileId === fileId
                    ? {
                        ...t,
                        transferredBytes: Math.round(sumBytes / divisor),
                        completedChunks: Math.round(sumChunks / divisor),
                        totalChunks: totalChunksKnown,
                        speedBytesPerSec: sumSpeed / Math.max(1, peerProgress.size),
                      }
                    : t,
                ),
              );
            },
          });
          if (p2pSuccess) {
            successCount += 1;
          }
        });

        let finalSpeed = 0;
        for (const entry of peerProgress.values()) {
          finalSpeed += entry.speed;
        }
        finalSpeed = finalSpeed / Math.max(1, peerProgress.size);

        if (successCount > 0 && (!shouldEncrypt || successCount === p2pTargets.length)) {
          setTransfers((prev) =>
            prev.map((t) =>
              t.fileId === fileId
                ? {
                    ...t,
                    status: 'completed',
                    transferredBytes: file.size,
                    completedChunks: totalChunksKnown,
                    totalChunks: totalChunksKnown,
                    speedBytesPerSec: finalSpeed,
                    verified: shouldEncrypt,
                    completedAt: Date.now(),
                  }
                : t,
            ),
          );
          void computePostTransferSha().then((computedSha) => {
            if (!computedSha) return;
            setTransfers((prev) =>
              prev.map((t) =>
                t.fileId === fileId ? { ...t, sha256: computedSha, verified: true } : t,
              ),
            );
          });
          if (file.size <= 128 * 1024 * 1024) {
            void saveFileBlobToCache(fileId, file.name, mimeType, file).catch(() => {});
          }
          return;
        }
      }

      if (shouldEncrypt) {
        setTransfers((prev) =>
          prev.map((task) =>
            task.fileId === fileId
              ? {
                  ...task,
                  status: 'error',
                  errorMessage: 'Koneksi P2P terputus. File terenkripsi tidak dialihkan ke transfer LAN.',
                }
              : task,
          ),
        );
        return;
      }

      // 2. LocalSend v2 Continuous Binary HTTP Stream (req.pipe(WriteStream) — zero chunk overhead)
      try {
        const prepared = await prepareLocalSendUpload({
          files: [{ fileId, name: file.name, size: file.size, mimeType }],
          senderName: currentUser.name,
        });
        const token = prepared.files[fileId];
        if (!token) {
          throw new Error('Token sesi stream HTTP tidak diterima.');
        }

        const abortController = new AbortController();
        sendAbortControllersRef.current.set(fileId, abortController);
        const startedAt = performance.now();

        const uploadResult = await streamUploadFileViaHttp({
          sessionId: prepared.sessionId,
          fileId,
          token,
          file,
          targetPeerId: recipientPeer?.id,
          senderId: currentUser.id,
          senderName: currentUser.name,
          signal: abortController.signal,
          onProgress: (loadedBytes, totalBytes, speedBytesPerSec) => {
            if (transferControlRef.current.get(fileId) === 'abort') {
              abortController.abort();
              return;
            }
            setTransfers((prev) =>
              prev.map((t) =>
                t.fileId === fileId
                  ? {
                      ...t,
                      transport: 'lan-sync',
                      transferredBytes: Math.min(totalBytes, loadedBytes),
                      completedChunks: loadedBytes >= totalBytes ? 1 : 0,
                      totalChunks: 1,
                      speedBytesPerSec,
                    }
                  : t,
              ),
            );
          },
        });

        sendAbortControllersRef.current.delete(fileId);
        if (transferControlRef.current.get(fileId) === 'abort') return;

        const totalElapsedSec = Math.max(0.02, (performance.now() - startedAt) / 1000);
        const finalSpeed = uploadResult.speedBytesPerSec || file.size / totalElapsedSec;

        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? {
                  ...t,
                  transport: 'lan-sync',
                  status: 'completed',
                  transferredBytes: file.size,
                  completedChunks: 1,
                  totalChunks: 1,
                  speedBytesPerSec: finalSpeed,
                  verified: shouldEncrypt,
                  completedAt: Date.now(),
                }
              : t,
          ),
        );

        void computePostTransferSha().then((computedSha) => {
          if (!computedSha) return;
          setTransfers((prev) =>
            prev.map((t) =>
              t.fileId === fileId ? { ...t, sha256: computedSha, verified: true } : t,
            ),
          );
          void fetch('/api/files/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId, sha256: computedSha }),
          }).catch(() => {});
        });

        if (file.size <= 128 * 1024 * 1024) {
          void saveFileBlobToCache(fileId, file.name, mimeType, file).catch(() => {});
        }
      } catch {
        sendAbortControllersRef.current.delete(fileId);
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? { ...t, status: 'error', errorMessage: 'Koneksi stream LAN terputus.' }
              : t,
          ),
        );
      }
    },
    [activeRoom, currentUser, encryptFiles, getRoomAesKey, replyTo, sendEncryptedMessage],
  );

  // Quick Send LocalSend-style Batch Handlers
  const handleAddQueuedFiles = useCallback((fileList: FileList | File[]) => {
    const incoming = Array.from(fileList).map((file) => {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return {
        queueId: makeId('q'),
        file,
        relativePath: rel && rel.length > 0 ? rel : undefined,
      };
    });
    if (incoming.length === 0) return;
    setQueuedFiles((prev) => [...prev, ...incoming]);
  }, []);

  const handleAcceptIncomingOffer = useCallback(
    (sessionId: string, selectedFileIds: string[], pinInput?: string) => {
      const currentOffer = incomingOffer;
      if (!currentOffer || currentOffer.sessionId !== sessionId) return;

      if (receivePinRef.current && (pinInput ?? '').trim() !== receivePinRef.current) {
        setIncomingOffer((prev) =>
          prev && prev.sessionId === sessionId
            ? { ...prev, pinError: 'PIN salah. Coba periksa kembali PIN perangkat ini.' }
            : prev,
        );
        return;
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transfer:decision',
            payload: {
              targetPeerId: currentOffer.senderId,
              sessionId,
              accepted: true,
              acceptedFileIds: selectedFileIds,
            },
          }),
        );
      }
      setIncomingOffer(null);
    },
    [incomingOffer],
  );

  const handleRejectIncomingOffer = useCallback(
    (sessionId: string) => {
      const currentOffer = incomingOffer;
      if (currentOffer && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'transfer:decision',
            payload: {
              targetPeerId: currentOffer.senderId,
              sessionId,
              accepted: false,
            },
          }),
        );
      }
      setIncomingOffer(null);
    },
    [incomingOffer],
  );

  const handleCancelBatchSession = useCallback(
    (sessionId: string) => {
      const ctrl = sendAbortControllersRef.current.get(sessionId);
      if (ctrl) ctrl.abort();
      const resolver = pendingSendResolversRef.current.get(sessionId);
      if (resolver) {
        pendingSendResolversRef.current.delete(sessionId);
        resolver({ accepted: false });
      }
      if (activeSendSession && activeSendSession.sessionId === sessionId) {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'transfer:cancel',
              payload: { targetPeerId: activeSendSession.peerId, sessionId },
            }),
          );
        }
        setActiveSendSession((prev) =>
          prev && prev.sessionId === sessionId ? { ...prev, status: 'cancelled' } : prev,
        );
      }
    },
    [activeSendSession],
  );

  const handleSendBatchToPeer = useCallback(
    async (targetPeer: LanPeer) => {
      if (!currentUser || queuedFiles.length === 0) return;

      const filesToSend = [...queuedFiles];
      const sessionId = makeId('ls').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
      const shouldEncrypt = encryptFiles;
      const roomId = makeDirectRoomId(currentUser.id, targetPeer.id);

      let useP2P = false;
      if (
        (preferredSendTransport === 'wifi-direct' || shouldEncrypt) &&
        targetPeer.isLiveSession &&
        targetPeer.online &&
        wifiDirectRef.current
      ) {
        useP2P = wifiDirectRef.current.isPeerConnected(targetPeer.id)
          ? true
          : await wifiDirectRef.current.connectToPeer(targetPeer.id);
      }

      const transport: TransferTransport = useP2P ? 'wifi-direct' : 'lan-sync';
      const batchItems: (TransferBatchFileItem & { rawFile: File })[] = filesToSend.map((q) => {
        const fid = makeId('file').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
        localFileRef.current.set(fid, q.file);
        return {
          fileId: fid,
          name: q.file.name,
          size: q.file.size,
          mimeType: q.file.type || 'application/octet-stream',
          transferredBytes: 0,
          speedBytesPerSec: 0,
          status: 'queued',
          encrypted: shouldEncrypt,
          transport,
          localUrl: URL.createObjectURL(q.file),
          rawFile: q.file,
        };
      });

      if (shouldEncrypt && !useP2P) {
        setActiveSendSession({
          sessionId,
          direction: 'send',
          peerId: targetPeer.id,
          peerName: targetPeer.name,
          peerIp: targetPeer.localIp,
          peerDeviceName: targetPeer.deviceName,
          status: 'error',
          encryptFiles: true,
          transport: 'lan-sync',
          files: batchItems.map(({ rawFile: _file, ...item }) => ({
            ...item,
            status: 'error',
            errorMessage: 'File terenkripsi memerlukan koneksi P2P langsung.',
          })),
          startedAt: Date.now(),
          errorMessage: 'Perangkat tujuan belum terhubung lewat P2P. File tidak dikirim tanpa enkripsi.',
        });
        return;
      }

      const abortController = new AbortController();
      sendAbortControllersRef.current.set(sessionId, abortController);

      setActiveSendSession({
        sessionId,
        direction: 'send',
        peerId: targetPeer.id,
        peerName: targetPeer.name,
        peerIp: targetPeer.localIp,
        peerDeviceName: targetPeer.deviceName,
        status: targetPeer.isLiveSession && targetPeer.online ? 'waiting_acceptance' : 'transferring',
        encryptFiles: shouldEncrypt,
        transport,
        files: batchItems.map(({ rawFile: _rf, ...rest }) => rest),
        startedAt: Date.now(),
      });

      // LocalSend Prepare-Upload Handshake via WS if live peer is online
      let acceptedIds = new Set(batchItems.map((b) => b.fileId));
      if (targetPeer.isLiveSession && targetPeer.online && wsRef.current?.readyState === WebSocket.OPEN) {
        const decisionPromise = new Promise<{
          accepted: boolean;
          acceptedFileIds?: string[];
          pinError?: string;
        }>((resolve) => {
          pendingSendResolversRef.current.set(sessionId, resolve);
          setTimeout(() => {
            if (pendingSendResolversRef.current.has(sessionId)) {
              pendingSendResolversRef.current.delete(sessionId);
              resolve({ accepted: true }); // Fallback gracefully if peer browser backgrounded
            }
          }, 45000);
        });

        wsRef.current.send(
          JSON.stringify({
            type: 'transfer:prepare',
            payload: {
              targetPeerId: targetPeer.id,
              sessionId,
              encryptFiles: shouldEncrypt,
              transport,
              files: batchItems.map((b) => ({
                fileId: b.fileId,
                name: b.name,
                size: b.size,
                mimeType: b.mimeType,
              })),
            },
          }),
        );

        const decision = await decisionPromise;
        if (abortController.signal.aborted) return;
        if (!decision.accepted) {
          setActiveSendSession((prev) =>
            prev && prev.sessionId === sessionId
              ? {
                  ...prev,
                  status: 'rejected',
                  errorMessage: decision.pinError || 'Permintaan ditolak oleh perangkat tujuan.',
                }
              : prev,
          );
          sendAbortControllersRef.current.delete(sessionId);
          return;
        }
        if (decision.acceptedFileIds?.length) {
          acceptedIds = new Set(decision.acceptedFileIds);
        }
      }

      const acceptedItems = batchItems.filter((item) => acceptedIds.has(item.fileId));
      if (acceptedItems.length === 0) {
        setActiveSendSession((prev) =>
          prev && prev.sessionId === sessionId ? { ...prev, status: 'cancelled' } : prev,
        );
        sendAbortControllersRef.current.delete(sessionId);
        return;
      }

      if (
        !useP2P &&
        preferredSendTransport === 'wifi-direct' &&
        targetPeer.isLiveSession &&
        targetPeer.online &&
        wifiDirectRef.current?.isPeerConnected(targetPeer.id)
      ) {
        useP2P = true;
      }
      const effectiveTransport: TransferTransport = useP2P ? 'wifi-direct' : 'lan-sync';

      // Clear queue immediately once streaming begins
      setQueuedFiles([]);

      // Register in global transfer history
      const newTasks: FileTransferTask[] = acceptedItems.map((item) => ({
        fileId: item.fileId,
        roomId,
        peerId: targetPeer.id,
        peerName: targetPeer.name,
        fileName: item.name,
        fileSize: item.size,
        mimeType: item.mimeType,
        direction: 'send',
        transport: effectiveTransport,
        status: 'transferring',
        transferredBytes: 0,
        totalChunks: 1,
        completedChunks: 0,
        speedBytesPerSec: 0,
        sha256: '',
        verified: false,
        startedAt: Date.now(),
        localUrl: item.localUrl,
        encrypted: shouldEncrypt,
      }));
      setTransfers((prev) => [...newTasks, ...prev]);

      setActiveSendSession((prev) =>
        prev && prev.sessionId === sessionId
          ? {
              ...prev,
              transport: effectiveTransport,
              status: 'transferring',
              startedAt: Date.now(),
              files: acceptedItems.map(({ rawFile: _rf, ...rest }) => ({
                ...rest,
                transport: effectiveTransport,
                status: 'transferring',
              })),
            }
          : prev,
      );

      const lastHistorySyncMap = new Map<string, number>();
      const updateFileProgress = (
        fileId: string,
        transferredBytes: number,
        speedBytesPerSec: number,
        status: 'transferring' | 'completed' | 'error' = 'transferring',
      ) => {
        setActiveSendSession((prev) => {
          if (!prev || prev.sessionId !== sessionId) return prev;
          return {
            ...prev,
            files: prev.files.map((f) =>
              f.fileId === fileId
                ? { ...f, transferredBytes, speedBytesPerSec, status }
                : f,
            ),
          };
        });
        const now = performance.now();
        const lastSync = lastHistorySyncMap.get(fileId) ?? 0;
        if (status === 'transferring' && now - lastSync < 350) {
          return;
        }
        lastHistorySyncMap.set(fileId, now);
        setTransfers((prev) =>
          prev.map((t) =>
            t.fileId === fileId
              ? {
                  ...t,
                  status,
                  transferredBytes,
                  speedBytesPerSec,
                  verified: status === 'completed' ? shouldEncrypt : t.verified,
                  completedAt: status === 'completed' ? Date.now() : t.completedAt,
                }
              : t,
          ),
        );
      };

      const aesKey = shouldEncrypt ? await getDirectAesKey(targetPeer.id) : null;

      let failedP2PTransfers = 0;
      try {
        if (useP2P && wifiDirectRef.current) {
          const rtc = wifiDirectRef.current;
          await runConcurrentFileWorkers(acceptedItems, 2, async (item) => {
            if (abortController.signal.aborted) return;
            let lastSpeed = 0;
            const ok = await rtc.sendFileDirect({
              peerId: targetPeer.id,
              roomId,
              senderId: currentUser.id,
              senderName: currentUser.name,
              fileId: item.fileId,
              file: item.rawFile,
              sha256: shouldEncrypt && item.size <= 128 * 1024 * 1024
                ? await item.rawFile.arrayBuffer().then((buffer) => sha256Hex(buffer)).catch(() => '')
                : '',
              aesKey,
              shouldPauseOrAbort: () =>
                abortController.signal.aborted ? 'abort' : 'run',
              onProgress: (transferredBytes, _chunks, _total, speed) => {
                lastSpeed = speed;
                updateFileProgress(item.fileId, transferredBytes, speed, 'transferring');
              },
            });
            if (!ok) failedP2PTransfers += 1;
            updateFileProgress(
              item.fileId,
              ok ? item.size : 0,
              lastSpeed,
              ok ? 'completed' : 'error',
            );
          });
        } else {
          // LocalSend HTTP Binary Stream + 3 Concurrent Workers
          const prepared = await prepareLocalSendUpload({
            files: acceptedItems.map((item) => ({
              fileId: item.fileId,
              name: item.name,
              size: item.size,
              mimeType: item.mimeType,
            })),
            senderName: currentUser.name,
          });

          await runConcurrentFileWorkers(acceptedItems, 3, async (item) => {
            if (abortController.signal.aborted) return;
            const token = prepared.files[item.fileId];
            if (!token) {
              updateFileProgress(item.fileId, 0, 0, 'error');
              return;
            }
            const res = await streamUploadFileViaHttp({
              sessionId: prepared.sessionId,
              fileId: item.fileId,
              token,
              file: item.rawFile,
              targetPeerId: targetPeer.id,
              senderId: currentUser.id,
              senderName: currentUser.name,
              signal: abortController.signal,
              onProgress: (loaded, _total, speed) => {
                updateFileProgress(item.fileId, loaded, speed, 'transferring');
              },
            });
            updateFileProgress(item.fileId, item.size, res.speedBytesPerSec, 'completed');

            if (
              targetPeer.isLiveSession &&
              targetPeer.online &&
              wsRef.current?.readyState === WebSocket.OPEN
            ) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'transfer:file_ready',
                  payload: {
                    targetPeerId: targetPeer.id,
                    sessionId,
                    fileId: item.fileId,
                    name: item.name,
                    size: item.size,
                    mimeType: item.mimeType,
                    encrypted: shouldEncrypt,
                    transport: 'lan-sync',
                    speedBytesPerSec: res.speedBytesPerSec,
                    savedToDiskPath: res.savedToDiskPath,
                  },
                }),
              );
            }
          });
        }

        if (!abortController.signal.aborted) {
          setActiveSendSession((prev) =>
            prev && prev.sessionId === sessionId
              ? {
                  ...prev,
                  status: failedP2PTransfers > 0 ? 'error' : 'completed',
                  errorMessage: failedP2PTransfers > 0
                    ? 'Satu atau lebih transfer P2P gagal; file terenkripsi tidak dikirim lewat hub.'
                    : undefined,
                  completedAt: Date.now(),
                }
              : prev,
          );
        }
      } catch {
        if (abortController.signal.aborted) {
          void cancelLocalSendSession(sessionId);
        } else {
          setActiveSendSession((prev) =>
            prev && prev.sessionId === sessionId
              ? {
                  ...prev,
                  status: 'error',
                  errorMessage: 'Terjadi gangguan jaringan saat streaming file.',
                }
              : prev,
          );
        }
      } finally {
        sendAbortControllersRef.current.delete(sessionId);
      }
    },
    [
      currentUser,
      encryptFiles,
      getDirectAesKey,
      preferredSendTransport,
      queuedFiles,
    ],
  );

  const handlePauseResumeTransfer = useCallback((fileId: string) => {
    const current = transferControlRef.current.get(fileId) ?? 'run';
    const next = current === 'pause' ? 'run' : 'pause';
    transferControlRef.current.set(fileId, next);
    setTransfers((prev) =>
      prev.map((t) =>
        t.fileId === fileId
          ? { ...t, status: next === 'pause' ? 'paused' : 'transferring' }
          : t,
      ),
    );
  }, []);

  const resolveFileBlobUrl = useCallback(
    async (fileId: string, name: string, mimeType: string): Promise<{ url: string; blob: Blob } | null> => {
      const memCached = localFileRef.current.get(fileId);
      if (memCached) {
        return { url: URL.createObjectURL(memCached), blob: memCached };
      }
      const cached = await loadFileBlobFromCache(fileId);
      if (cached) {
        localFileRef.current.set(fileId, cached.blob);
        return { url: URL.createObjectURL(cached.blob), blob: cached.blob };
      }
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`);
      if (res.status === 401) {
        window.dispatchEvent(new Event('kiremdata:auth-required'));
        return null;
      }
      if (!res.ok) return null;
      const blob = await res.blob();
      localFileRef.current.set(fileId, blob);
      if (blob.size <= 128 * 1024 * 1024) {
        void saveFileBlobToCache(fileId, name, mimeType, blob).catch(() => {});
      }
      return { url: URL.createObjectURL(blob), blob };
    },
    [],
  );

  const handleDownloadFile = useCallback(
    async (msg: ChatMessage) => {
      if (!msg.fileMeta) return;
      const resolved = await resolveFileBlobUrl(
        msg.fileMeta.fileId,
        msg.fileMeta.name,
        msg.fileMeta.mimeType,
      );
      if (!resolved) return;
      const a = document.createElement('a');
      a.href = resolved.url;
      a.download = msg.fileMeta.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
    },
    [resolveFileBlobUrl],
  );

  const handlePreviewFile = useCallback(
    async (msg: ChatMessage) => {
      if (!msg.fileMeta) return;
      const resolved = await resolveFileBlobUrl(
        msg.fileMeta.fileId,
        msg.fileMeta.name,
        msg.fileMeta.mimeType,
      );
      if (!resolved) return;
      let textContent: string | undefined;
      if (msg.fileMeta.mimeType.startsWith('text/')) {
        textContent = await resolved.blob.text();
      }
      setPreviewFile({
        name: msg.fileMeta.name,
        mimeType: msg.fileMeta.mimeType,
        url: resolved.url,
        textContent,
      });
    },
    [resolveFileBlobUrl],
  );

  const handleCreateGroup = useCallback(
    async (name: string, description: string, memberIds: string[]) => {
      if (!currentUser || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const groupId = makeId('group');
      const groupKey = await generateGroupAesKey();
      groupKeysCacheRef.current.set(groupId, groupKey);
      const groupKeyBase64 = await exportAesKeyBase64(groupKey);

      const allMembers = Array.from(new Set([currentUser.id, ...memberIds]));
      const wrappedGroupKeys: Record<string, { senderId: string; blob: EncryptedBlob }> = {};

      for (const memberId of allMembers) {
        if (memberId === currentUser.id) {
          // Wrap for self using self ECDH or direct derivation
          const selfAes = await deriveSharedAesKey(
            myPrivateKeyRef.current!,
            currentUser.publicKeyJwk,
          );
          wrappedGroupKeys[memberId] = {
            senderId: currentUser.id,
            blob: await encryptPayload(selfAes, { groupKeyBase64 }),
          };
        } else {
          const aes = await getDirectAesKey(memberId);
          if (aes) {
            wrappedGroupKeys[memberId] = {
              senderId: currentUser.id,
              blob: await encryptPayload(aes, { groupKeyBase64 }),
            };
          }
        }
      }

      wsRef.current.send(
        JSON.stringify({
          type: 'group:create',
          payload: {
            id: groupId,
            name,
            description,
            memberIds: allMembers,
            wrappedGroupKeys,
          },
        }),
      );

      setActiveRoomId(groupId);
      setMobileView('chat');
    },
    [currentUser, getDirectAesKey],
  );

  const handleAddGroupMember = useCallback(
    async (groupId: string, peerId: string) => {
      if (!currentUser || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const room = rooms.find((r) => r.id === groupId);
      if (!room) return;
      const groupKey = await unwrapGroupKey(room);
      const memberAes = await getDirectAesKey(peerId);
      if (!groupKey || !memberAes) return;

      const groupKeyBase64 = await exportAesKeyBase64(groupKey);
      const blob = await encryptPayload(memberAes, { groupKeyBase64 });

      wsRef.current.send(
        JSON.stringify({
          type: 'group:add_member',
          payload: {
            groupId,
            memberId: peerId,
            wrappedKeyForMember: {
              senderId: currentUser.id,
              blob,
            },
          },
        }),
      );
    },
    [currentUser, getDirectAesKey, rooms, unwrapGroupKey],
  );

  const handleUpdateProfile = useCallback(
    (profile: ProfileUpdateInput) => {
      const trimmedName = profile.name.trim().slice(0, 64);
      if (!trimmedName) return;
      const trimmedPhone = (profile.phone ?? '').trim().slice(0, 32);
      const trimmedShopNote = (profile.shopNote ?? '').trim().slice(0, 160);

      writePersistentItem(DEVICE_NAME_KEY, trimmedName, LEGACY_SESSION_NAME_KEY);
      writePersistentItem(DEVICE_PHONE_KEY, trimmedPhone);
      writePersistentItem(DEVICE_SHOP_NOTE_KEY, trimmedShopNote);
      writePersistentItem(DEVICE_CUSTOM_NAME_SET_KEY, 'true');

      myPeerNameRef.current = trimmedName;
      myPeerPhoneRef.current = trimmedPhone;
      myPeerShopNoteRef.current = trimmedShopNote;

      setCurrentUser((prev) =>
        prev
          ? {
              ...prev,
              name: trimmedName,
              phone: trimmedPhone || undefined,
              shopNote: trimmedShopNote || undefined,
            }
          : prev,
      );

      setPeers((prev) =>
        prev.map((p) =>
          p.id === myPeerIdRef.current
            ? {
                ...p,
                name: trimmedName,
                phone: trimmedPhone || undefined,
                shopNote: trimmedShopNote || undefined,
              }
            : p,
        ),
      );

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'peer:update_profile',
            payload: {
              name: trimmedName,
              phone: trimmedPhone,
              shopNote: trimmedShopNote,
            },
          }),
        );
      }
    },
    [],
  );

  const handleConfirmRoomClear = useCallback(
    (roomId: string, scope: 'me' | 'everyone') => {
      const clearedAt = Date.now();
      const cleared = readClearedRoomsMap();
      cleared[roomId] = clearedAt;
      writeClearedRoomsMap(cleared);
      void clearRoomMessagesFromCache(roomId);

      setMessages((prev) => {
        const next = prev.filter((m) => m.roomId !== roomId);
        setRooms((prevRooms) => syncRoomsWithMessages(next, prevRooms, peersRef.current));
        return next;
      });
      setReplyTo((prev) => (prev ? null : prev));

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:clear_room',
            payload: { roomId, scope, clearedAt },
          }),
        );
      }
    },
    [syncRoomsWithMessages],
  );

  const handleConfirmDeleteMessage = useCallback(
    (message: ChatMessage, scope: 'me' | 'everyone') => {
      const deleted = readDeletedMsgIds();
      deleted.add(message.id);
      writeDeletedMsgIds(deleted);
      void deleteMessageFromCache(message.id);

      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== message.id);
        setRooms((prevRooms) => syncRoomsWithMessages(next, prevRooms, peersRef.current));
        return next;
      });

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'chat:delete_message',
            payload: { messageId: message.id, roomId: message.roomId, scope },
          }),
        );
      }
    },
    [syncRoomsWithMessages],
  );

  const handleConfirmClearAll = useCallback(() => {
    const clearedAt = Date.now();
    const cleared = readClearedRoomsMap();
    for (const room of roomsRef.current) {
      cleared[room.id] = clearedAt;
    }
    writeClearedRoomsMap(cleared);
    void clearAllMessagesFromCache();

    setMessages([]);
    setReplyTo(null);
    setRooms((prevRooms) => syncRoomsWithMessages([], prevRooms, peersRef.current));

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'chat:clear_all',
          payload: { clearedAt },
        }),
      );
    }
  }, [syncRoomsWithMessages]);

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      if (!activeRoom || !currentUser || wsRef.current?.readyState !== WebSocket.OPEN) return;
      const recipientId =
        activeRoom.type === 'direct'
          ? activeRoom.memberIds.find((id) => id !== currentUser.id)
          : undefined;
      wsRef.current.send(
        JSON.stringify({
          type: 'peer:typing',
          payload: {
            roomId: activeRoom.id,
            roomType: activeRoom.type,
            recipientId,
            isTyping,
          },
        }),
      );
    },
    [activeRoom, currentUser],
  );

  const handleTestNotification = useCallback(async (): Promise<{
    desktopSent: boolean;
    message: string;
  }> => {
    const modeLabel =
      notificationModeRef.current === 'muted'
        ? 'Bisukan'
        : notificationModeRef.current === 'mentions'
          ? 'Hanya Sebutan'
          : 'Semua Pesan';

    let permission: NotificationPermission | 'unsupported' =
      typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';

    if (typeof Notification !== 'undefined' && permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        // Ignore browser permission request failures
      }
    }

    if (notificationModeRef.current !== 'muted') {
      playMessageNotificationSound(false);
    }

    const previewBody =
      notificationModeRef.current === 'muted'
        ? 'Simulasi uji dikirim (saat ini mode Bisukan aktif, jadi suara tidak diputar).'
        : `Notifikasi berjalan normal pada mode "${modeLabel}".`;

    pushToast({
      id: makeId('toast'),
      roomId: activeRoomIdRef.current ?? roomsRef.current[0]?.id ?? '',
      senderName: 'KiremData',
      roomName: 'Uji Notifikasi',
      preview: previewBody,
      timestamp: Date.now(),
      type: 'text',
    });

    if (typeof Notification !== 'undefined' && permission === 'granted') {
      try {
        new Notification('KiremData · Uji Notifikasi', {
          body: previewBody,
          icon: '/pwa-192x192.png',
        });
        return {
          desktopSent: true,
          message: `Notifikasi uji berhasil dikirim ke desktop & aplikasi (mode: ${modeLabel}).`,
        };
      } catch {
        // Fallback when Notification constructor is restricted (e.g. iframe/mobile webview)
      }
    }

    return {
      desktopSent: false,
      message:
        permission === 'denied'
          ? 'Izin notifikasi browser ditolak; pratinjau uji ditampilkan di dalam aplikasi.'
          : 'Notifikasi uji ditampilkan di dalam aplikasi.',
    };
  }, [pushToast]);

  const handleSaveTransferTaskToDisk = useCallback(
    async (task: FileTransferTask) => {
      const memBlob = localFileRef.current.get(task.fileId);
      if (memBlob) {
        await saveBlobWithPickerOrDownload(memBlob, task.fileName);
        return;
      }
      const res = await resolveFileBlobUrl(task.fileId, task.fileName, task.mimeType);
      if (res) {
        await saveBlobWithPickerOrDownload(res.blob, task.fileName);
      }
    },
    [resolveFileBlobUrl],
  );

  const handlePreviewTransferTask = useCallback(
    async (task: FileTransferTask) => {
      const res = await resolveFileBlobUrl(task.fileId, task.fileName, task.mimeType);
      if (!res) return;
      let textContent: string | undefined;
      if (task.mimeType.startsWith('text/')) {
        textContent = await res.blob.text();
      }
      setPreviewFile({
        name: task.fileName,
        mimeType: task.mimeType,
        url: res.url,
        textContent,
      });
    },
    [resolveFileBlobUrl],
  );

  const totalUnreadMessages = useMemo(
    () => rooms.reduce((sum, r) => sum + r.unreadCount, 0),
    [rooms],
  );
  const activeTransfersCount = useMemo(
    () => transfers.filter((t) => t.status === 'transferring').length,
    [transfers],
  );
  const receivedTransfers = useMemo(
    () => transfers.filter((t) => t.direction === 'receive'),
    [transfers],
  );

  const showMobileBottomNav = !(activePrimaryTab === 'chat' && mobileView === 'chat');

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-[#0B141A] text-[#E9EDEF] flex relative"
      onDragOver={(e) => {
        if (activePrimaryTab !== 'chat') {
          e.preventDefault();
          setIsDraggingFile(true);
        }
      }}
      onDragLeave={(e) => {
        if (activePrimaryTab !== 'chat') {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsDraggingFile(false);
        }
      }}
      onDrop={(e) => {
        if (activePrimaryTab !== 'chat') {
          e.preventDefault();
          setIsDraggingFile(false);
          if (e.dataTransfer.files.length) {
            handleAddQueuedFiles(e.dataTransfer.files);
            setActivePrimaryTab('send');
          }
        }
      }}
    >
      {/* Desktop Left Navigation Rail (Chat + Quick File PWA) */}
      <nav
        aria-label="Navigasi utama"
        className="hidden md:flex w-[76px] shrink-0 bg-[#111B21] border-r border-white/8 flex-col items-center justify-between py-4 select-none"
      >
        <div className="flex flex-col items-center gap-2 w-full px-2">
          <div className="mb-2 text-center">
            <div className="w-10 h-10 rounded-xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mx-auto font-display font-bold text-base">
              KD
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('chat')}
            className={`w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors relative ${
              activePrimaryTab === 'chat'
                ? 'bg-[#00A884] text-[#0B141A]'
                : 'text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="text-[11px] font-semibold whitespace-nowrap">Pesan</span>
            {totalUnreadMessages > 0 && activePrimaryTab !== 'chat' && (
              <span className="absolute top-1.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#00A884] text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {totalUnreadMessages}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('send')}
            className={`w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
              activePrimaryTab === 'send'
                ? 'bg-[#00A884] text-[#0B141A]'
                : 'text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5'
            }`}
          >
            <Send className="w-4 h-4" />
            <span className="text-[11px] font-semibold whitespace-nowrap">Kirim</span>
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('receive')}
            className={`w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors relative ${
              activePrimaryTab === 'receive'
                ? 'bg-[#00A884] text-[#0B141A]'
                : 'text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5'
            }`}
          >
            <Download className="w-4 h-4" />
            <span className="text-[11px] font-semibold whitespace-nowrap">Terima</span>
            {receivedTransfers.length > 0 && activePrimaryTab !== 'receive' && (
              <span className="absolute top-1.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-[#00A884] text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {receivedTransfers.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('history')}
            className={`w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors relative ${
              activePrimaryTab === 'history'
                ? 'bg-[#00A884] text-[#0B141A]'
                : 'text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5'
            }`}
          >
            <History className="w-4 h-4" />
            <span className="text-[11px] font-semibold whitespace-nowrap">Riwayat</span>
            {activeTransfersCount > 0 && activePrimaryTab !== 'history' && (
              <span className="absolute top-1.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {activeTransfersCount}
              </span>
            )}
          </button>
        </div>

        <div className="flex flex-col items-center gap-2 w-full px-2">
          <div
            title={
              !isOnline
                ? 'Browser offline — cache PWA aktif'
                : swOfflineReady
                  ? 'PWA siap offline & terhubung'
                  : 'Mode online'
            }
            className="w-full py-1.5 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium text-[#8696A0]"
          >
            {isOnline ? (
              <Wifi className={`w-3.5 h-3.5 ${swOfflineReady ? 'text-[#00A884]' : 'text-[#8696A0]'}`} />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span className={!isOnline ? 'text-amber-300' : ''}>
              {!isOnline ? 'Offline' : swOfflineReady ? 'Siap PWA' : 'Online'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setLanModalOpen(true)}
            title="Profil & Jaringan LAN"
            className="w-full py-2.5 rounded-xl flex flex-col items-center justify-center gap-1 text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            <Radio className="w-4 h-4 text-[#00A884]" />
            <span className="text-[10px] font-medium whitespace-nowrap">Jaringan</span>
          </button>
          {!isInstalled && (
            <button
              type="button"
              onClick={() => {
                if (isInstallable) {
                  void installPWA();
                } else {
                  setInstallModalOpen(true);
                }
              }}
              title="Pasang aplikasi lokal"
              className="w-full py-2 rounded-xl flex flex-col items-center justify-center gap-1 text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors"
            >
              <MonitorDown className="w-4 h-4" />
              <span className="text-[10px] font-medium whitespace-nowrap">Pasang</span>
            </button>
          )}
        </div>
      </nav>

      {/* Primary View 1: Quick Send */}
      {activePrimaryTab === 'send' && (
        <QuickSendView
          currentUser={currentUser}
          peers={peers}
          isOnline={isOnline}
          p2pConnectedMap={p2pConnectedMap}
          p2pRouteMap={p2pRouteMap}
          queuedFiles={queuedFiles}
          encryptFiles={encryptFiles}
          preferredTransport={preferredSendTransport}
          activeSendSession={activeSendSession}
          onAddFiles={handleAddQueuedFiles}
          onRemoveQueuedFile={(queueId) =>
            setQueuedFiles((prev) => prev.filter((item) => item.queueId !== queueId))
          }
          onClearQueue={() => setQueuedFiles([])}
          onToggleEncryptFiles={setEncryptFiles}
          onChangePreferredTransport={setPreferredSendTransport}
          onSendToPeer={handleSendBatchToPeer}
          onCancelSession={handleCancelBatchSession}
          onClearCompletedSession={() => setActiveSendSession(null)}
          onOpenChatWithPeer={(peer) => {
            handleStartDirectChat(peer);
            setActivePrimaryTab('chat');
          }}
          onConnectP2P={handleConnectP2P}
        />
      )}

      {/* Primary View 2: Receive & Quick Save + PWA Offline Status */}
      {activePrimaryTab === 'receive' && (
        <ReceiveView
          currentUser={currentUser}
          wsConnected={wsConnected}
          isOnline={isOnline}
          swOfflineReady={swOfflineReady}
          isInstalled={isInstalled}
          isInstallable={isInstallable}
          networkInfo={networkInfo}
          quickSave={quickSave}
          receivePin={receivePin}
          receivedTransfers={receivedTransfers}
          onChangeQuickSave={setQuickSave}
          onChangeReceivePin={setReceivePin}
          onOpenProfileModal={() => setLanModalOpen(true)}
          onInstallPWA={() => {
            if (isInstallable) {
              void installPWA();
            } else {
              setInstallModalOpen(true);
            }
          }}
          onSaveTaskToDisk={handleSaveTransferTaskToDisk}
          onPreviewTask={handlePreviewTransferTask}
        />
      )}

      {/* Primary View 4: Transfer History */}
      {activePrimaryTab === 'history' && (
        <TransferHistoryView
          transfers={transfers}
          onSaveTaskToDisk={handleSaveTransferTaskToDisk}
          onPreviewTask={handlePreviewTransferTask}
          onClearHistory={() =>
            setTransfers((prev) => prev.filter((t) => t.status === 'transferring'))
          }
          onGoToSend={() => setActivePrimaryTab('send')}
        />
      )}

      {/* Primary View: Encrypted Messaging & Voice */}
      {activePrimaryTab === 'chat' && (
        <>
          <div
            className={`${mobileView === 'chat' ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full pb-16 md:pb-0`}
          >
            <Sidebar
              currentUser={currentUser}
              rooms={rooms}
              peers={peers}
              messages={messages}
              activeRoomId={activeRoomId}
              muted={muted}
              notificationMode={notificationMode}
              wsConnected={wsConnected}
              isOnline={isOnline}
              swOfflineReady={swOfflineReady}
              p2pConnectedMap={p2pConnectedMap}
              onSelectRoom={selectRoom}
              onStartDirectChat={handleStartDirectChat}
              onConnectP2P={handleConnectP2P}
              onOpenCreateGroup={() => setCreateGroupOpen(true)}
              onOpenLanModal={() => setLanModalOpen(true)}
              onToggleMute={() =>
                setNotificationMode((prev) =>
                  prev === 'muted' ? lastActiveNotifModeRef.current : 'muted',
                )
              }
              onJumpToMessage={(roomId, messageId) => {
                selectRoom(roomId);
                setHighlightedMessageId(messageId);
              }}
              onDownloadFile={handleDownloadFile}
              onPreviewFile={handlePreviewFile}
              isInstalled={isInstalled}
              onOpenInstallModal={() => setInstallModalOpen(true)}
            />
          </div>

          <main
            className={`${
              mobileView === 'list' ? 'hidden md:flex' : 'flex'
            } flex-1 flex-col min-w-0 h-full relative`}
            onDragOver={(e) => {
              e.preventDefault();
              if (activeRoom) setIsDraggingFile(true);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setIsDraggingFile(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              if (!activeRoom || !e.dataTransfer.files.length) return;
              Array.from(e.dataTransfer.files).forEach((f) =>
                handleSendFile(f, preferredSendTransport, encryptFiles),
              );
            }}
          >
            {activeRoom && currentUser ? (
              <>
                <ChatHeader
                  room={activeRoom}
                  peer={activeDirectPeer}
                  p2pConnected={
                    activeDirectPeer ? !!p2pConnectedMap[activeDirectPeer.id] : false
                  }
                  typingNames={typingNames}
                  onBackMobile={() => setMobileView('list')}
                  onOpenSearch={() =>
                    setDrawerMode((prev) => (prev === 'search' ? null : 'search'))
                  }
                  onOpenSecurity={() => setSecurityModalOpen(true)}
                  onOpenInfo={() =>
                    setDrawerMode((prev) => (prev === 'info' ? null : 'info'))
                  }
                  onRequestClearRoom={() =>
                    setDeleteDialog({
                      kind: 'room',
                      roomId: activeRoom.id,
                      roomName: activeRoom.name,
                      messageCount: activeMessages.length,
                    })
                  }
                  onConnectWifiDirect={() => {
                    if (activeDirectPeer) handleConnectP2P(activeDirectPeer.id);
                  }}
                />

                <MessageList
                  messages={activeMessages}
                  currentUserId={currentUser.id}
                  transfersByFileId={transfersByFileId}
                  highlightedMessageId={highlightedMessageId}
                  searchQuery={drawerMode === 'search' ? inChatSearchQuery : ''}
                  onReply={(msg) =>
                    setReplyTo({
                      messageId: msg.id,
                      senderName: msg.senderName,
                      type: msg.type,
                      snippet:
                        msg.type === 'file'
                          ? `Dokumen: ${msg.fileMeta?.name ?? ''}`
                          : msg.type === 'voice'
                            ? `Pesan Suara (${msg.voiceMeta?.durationSec ?? 0}d)`
                            : msg.text,
                    })
                  }
                  onRequestDeleteMessage={(msg) =>
                    setDeleteDialog({
                      kind: 'message',
                      message: msg,
                      isOwn: msg.senderId === currentUser.id,
                    })
                  }
                  onDownloadFile={handleDownloadFile}
                  onPreviewFile={handlePreviewFile}
                  onPauseResumeTransfer={handlePauseResumeTransfer}
                  onClearHighlight={() => setHighlightedMessageId(null)}
                />

                <MessageComposer
                  muted={muted}
                  p2pConnected={
                    activeDirectPeer ? !!p2pConnectedMap[activeDirectPeer.id] : false
                  }
                  encryptFiles={encryptFiles}
                  onToggleEncryptFiles={setEncryptFiles}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  onTyping={handleTyping}
                  onSendText={handleSendText}
                  onSendFile={handleSendFile}
                  onSendVoice={handleSendVoice}
                />
              </>
            ) : (
              <div className="flex-1 chat-canvas-pattern flex items-center justify-center p-8">
                <div className="max-w-md text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-[#202C33] border border-white/10 flex items-center justify-center mx-auto text-[#00A884]">
                    <Wifi className="w-8 h-8" />
                  </div>
                  <h2 className="font-display font-bold text-2xl text-[#E9EDEF] text-balance">
                    KiremData Pesan Lokal
                  </h2>
                  <p className="text-sm text-[#8696A0] leading-relaxed">
                    Pilih percakapan atau grup di sebelah kiri untuk berkirim pesan terenkripsi dan pesan suara di jaringan lokal.
                  </p>
                  <div className="pt-2 flex items-center justify-center gap-2 text-xs text-[#8696A0]">
                    <Lock className="w-3.5 h-3.5 text-[#00A884]" />
                    <span>Dilindungi Enkripsi Ujung-ke-Ujung (ECDH P-256)</span>
                  </div>
                </div>
              </div>
            )}
          </main>

          {activeRoom && currentUser && drawerMode && (
            <RightDrawer
              mode={drawerMode}
              room={activeRoom}
              peers={peers}
              messages={activeMessages}
              currentUserId={currentUser.id}
              searchQuery={inChatSearchQuery}
              onSearchQueryChange={setInChatSearchQuery}
              onClose={() => {
                setDrawerMode(null);
                setInChatSearchQuery('');
              }}
              onJumpToMessage={(msgId) => {
                setHighlightedMessageId(msgId);
              }}
              onOpenSecurity={() => setSecurityModalOpen(true)}
              onAddGroupMember={handleAddGroupMember}
              onDownloadFile={handleDownloadFile}
              onRequestClearRoom={() =>
                setDeleteDialog({
                  kind: 'room',
                  roomId: activeRoom.id,
                  roomName: activeRoom.name,
                  messageCount: activeMessages.length,
                })
              }
            />
          )}
        </>
      )}

      {/* Global Drag-and-Drop Overlay */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-40 bg-[#0B141A]/85 backdrop-blur-xs border-2 border-dashed border-[#00A884] m-3 rounded-2xl flex flex-col items-center justify-center pointer-events-none">
          <div className="w-14 h-14 rounded-full bg-[#00A884]/20 text-[#00A884] flex items-center justify-center mb-3">
            <Upload className="w-7 h-7" />
          </div>
          <p className="font-display font-semibold text-lg text-[#E9EDEF]">
            {activePrimaryTab === 'chat'
              ? 'Lepaskan File untuk Dikirim ke Obrolan Ini'
              : 'Lepaskan File untuk Antrean Kirim Cepat'}
          </p>
          <p className="text-xs text-[#8696A0] mt-1">
            {encryptFiles
              ? 'Otomatis dienkripsi AES-GCM-256 dan diverifikasi SHA-256'
              : 'Mode Super aktif: Stream biner langsung tanpa enkripsi file tambahan'}
          </p>
        </div>
      )}

      {/* Mobile Bottom Navigation Bar (<= 15% viewport height, thumb-zone accessible) */}
      {showMobileBottomNav && (
        <nav
          aria-label="Navigasi seluler"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-[#111B21]/95 backdrop-blur-md border-t border-white/10 grid grid-cols-4 items-center px-1"
        >
          <button
            type="button"
            onClick={() => {
              setActivePrimaryTab('chat');
              setMobileView('list');
            }}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors relative ${
              activePrimaryTab === 'chat' ? 'text-[#00A884]' : 'text-[#8696A0]'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">Pesan</span>
            {totalUnreadMessages > 0 && (
              <span className="absolute top-1 right-4 min-w-[16px] h-4 px-1 rounded-full bg-[#00A884] text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {totalUnreadMessages}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('send')}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
              activePrimaryTab === 'send' ? 'text-[#00A884]' : 'text-[#8696A0]'
            }`}
          >
            <Send className="w-5 h-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">Kirim</span>
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('receive')}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors relative ${
              activePrimaryTab === 'receive' ? 'text-[#00A884]' : 'text-[#8696A0]'
            }`}
          >
            <Download className="w-5 h-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">Terima</span>
            {receivedTransfers.length > 0 && (
              <span className="absolute top-1 right-4 min-w-[16px] h-4 px-1 rounded-full bg-[#00A884] text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {receivedTransfers.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActivePrimaryTab('history')}
            className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-lg transition-colors relative ${
              activePrimaryTab === 'history' ? 'text-[#00A884]' : 'text-[#8696A0]'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="text-[11px] font-medium whitespace-nowrap">Riwayat</span>
            {activeTransfersCount > 0 && (
              <span className="absolute top-1 right-4 min-w-[16px] h-4 px-1 rounded-full bg-amber-400 text-[#0B141A] text-[10px] font-bold flex items-center justify-center font-mono-tabular">
                {activeTransfersCount}
              </span>
            )}
          </button>
        </nav>
      )}

      {/* Modals & Notifications */}
      <IncomingTransferModal
        offer={incomingOffer}
        onAccept={handleAcceptIncomingOffer}
        onReject={handleRejectIncomingOffer}
      />

      <CreateGroupModal
        open={createGroupOpen}
        peers={peers}
        currentUserId={currentUser?.id ?? ''}
        onClose={() => setCreateGroupOpen(false)}
        onCreate={handleCreateGroup}
      />

      <SecurityModal
        open={securityModalOpen}
        room={activeRoom}
        currentUser={currentUser}
        targetPeer={activeDirectPeer}
        onClose={() => setSecurityModalOpen(false)}
      />

      <LanNetworkModal
        open={lanModalOpen}
        currentUser={currentUser}
        peers={peers}
        p2pConnectedMap={p2pConnectedMap}
        notificationMode={notificationMode}
        onChangeNotificationMode={setNotificationMode}
        onTestNotification={handleTestNotification}
        onUpdateProfile={handleUpdateProfile}
        onConnectP2P={handleConnectP2P}
        onRequestClearAllChats={() =>
          setDeleteDialog({
            kind: 'all',
            totalMessages: messages.length,
          })
        }
        onClose={() => setLanModalOpen(false)}
      />

      <ClearChatModal
        state={deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirmRoomClear={handleConfirmRoomClear}
        onConfirmDeleteMessage={handleConfirmDeleteMessage}
        onConfirmClearAll={handleConfirmClearAll}
      />

      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      <InstallAppModal
        open={installModalOpen}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        detectedPlatform={platform}
        onInstallNative={installPWA}
        onClose={() => setInstallModalOpen(false)}
      />

      <OfflineIndicator />

      <ToastNotifications
        toasts={toasts}
        onOpenRoom={(roomId) => {
          setActivePrimaryTab('chat');
          selectRoom(roomId);
        }}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
      />
    </div>
  );
}
