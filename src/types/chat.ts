export type MessageType = 'text' | 'voice' | 'file' | 'system';

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read';

export type TransferTransport = 'wifi-direct' | 'lan-sync';

export type TransferStatus =
  | 'queued'
  | 'transferring'
  | 'verifying'
  | 'completed'
  | 'paused'
  | 'error';

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
  algorithm: 'AES-GCM-256' | 'LAN-PLAIN';
}

export interface LanPeer {
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
  isSeedPeer?: boolean;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  lastSeen: number;
  p2pConnected?: boolean;
}

export interface FileAttachmentMeta {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  totalChunks: number;
  transport: TransferTransport;
  encrypted?: boolean;
  iv?: string;
}

export interface VoiceAttachmentMeta {
  voiceId: string;
  durationSec: number;
  mimeType: string;
  waveform: number[];
  audioBase64?: string;
}

export interface ReplyPreview {
  messageId: string;
  senderName: string;
  snippet: string;
  type: MessageType;
}

export interface DecryptedMessageContent {
  text?: string;
  fileMeta?: FileAttachmentMeta;
  voiceMeta?: VoiceAttachmentMeta;
  replyTo?: ReplyPreview;
}

export interface WireChatMessage {
  id: string;
  roomId: string;
  roomType: 'direct' | 'group';
  senderId: string;
  senderName: string;
  recipientId?: string;
  type: MessageType;
  encryptedPayload?: EncryptedBlob;
  wrappedKeys?: Record<string, EncryptedBlob>;
  plaintextFallback?: DecryptedMessageContent;
  timestamp: number;
  status: DeliveryStatus;
  readBy?: string[];
}

export interface ChatMessage {
  id: string;
  roomId: string;
  roomType: 'direct' | 'group';
  senderId: string;
  senderName: string;
  type: MessageType;
  text: string;
  fileMeta?: FileAttachmentMeta;
  voiceMeta?: VoiceAttachmentMeta;
  replyTo?: ReplyPreview;
  timestamp: number;
  status: DeliveryStatus;
  isEncrypted: boolean;
  decryptionError?: boolean;
  readBy?: string[];
}

export interface ChatRoom {
  id: string;
  type: 'direct' | 'group';
  name: string;
  description?: string;
  avatar?: string;
  memberIds: string[];
  createdBy: string;
  createdAt: number;
  wrappedGroupKeys?: Record<string, { senderId: string; blob: EncryptedBlob }>;
  unreadCount: number;
  lastMessageText?: string;
  lastMessageTime?: number;
  lastMessageSender?: string;
  typingUserIds?: string[];
  pinned?: boolean;
}

export interface FileTransferTask {
  fileId: string;
  roomId: string;
  peerId?: string;
  peerName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  direction: 'send' | 'receive';
  transport: TransferTransport;
  status: TransferStatus;
  transferredBytes: number;
  totalChunks: number;
  completedChunks: number;
  speedBytesPerSec: number;
  sha256: string;
  verified: boolean;
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
  localUrl?: string;
  encrypted?: boolean;
  savedToDiskPath?: string;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
  cidr: string | null;
}

export interface NetworkStatusInfo {
  hostname: string;
  port: number;
  interfaces: NetworkInterfaceInfo[];
  connectedPeersCount: number;
  mode: 'local-lan-offline';
  saveDir?: string;
  isCloudContainer?: boolean;
}

export interface ToastNotificationItem {
  id: string;
  roomId: string;
  senderName: string;
  roomName: string;
  preview: string;
  timestamp: number;
  type: MessageType;
}

export type NotificationMode = 'all' | 'mentions' | 'muted';

export type QuickSaveMode = 'off' | 'contacts' | 'all';

export type PrimaryWorkspaceTab = 'send' | 'receive' | 'chat' | 'history';

export interface QueuedSendFile {
  queueId: string;
  file: File;
  relativePath?: string;
}

export interface TransferBatchFileItem {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  transferredBytes: number;
  speedBytesPerSec: number;
  status: TransferStatus | 'rejected' | 'cancelled';
  encrypted: boolean;
  transport: TransferTransport;
  token?: string;
  sha256?: string;
  localUrl?: string;
  errorMessage?: string;
}

export interface TransferBatchSession {
  sessionId: string;
  direction: 'send' | 'receive';
  peerId: string;
  peerName: string;
  peerIp: string;
  peerDeviceName: string;
  status:
    | 'preparing'
    | 'waiting_acceptance'
    | 'transferring'
    | 'completed'
    | 'rejected'
    | 'cancelled'
    | 'error';
  encryptFiles: boolean;
  transport: TransferTransport;
  files: TransferBatchFileItem[];
  startedAt: number;
  completedAt?: number;
  errorMessage?: string;
}

export interface IncomingPrepareOffer {
  sessionId: string;
  senderId: string;
  senderName: string;
  senderIp: string;
  senderDeviceName: string;
  encryptFiles: boolean;
  transport: TransferTransport;
  requiresPin: boolean;
  pinError?: string;
  files: Array<{
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
  createdAt: number;
}

