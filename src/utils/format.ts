import type { ChatMessage } from '../types/chat';

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateDivider(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Hari Ini';
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';

  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 10 || exp === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exp]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.max(1, Math.round(bytesPerSec / 1024))} KB/s`;
}

export function formatDuration(seconds: number): string {
  const clean = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clean / 60);
  const secs = clean % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const SENDER_PALETTE = [
  'text-[#53BDEB]',
  'text-[#00A884]',
  'text-[#F59E0B]',
  'text-[#A78BFA]',
  'text-[#FB7185]',
  'text-[#38BDF8]',
];

export function getSenderColorClass(senderId: string): string {
  let hash = 0;
  for (let i = 0; i < senderId.length; i++) {
    hash = (hash * 31 + senderId.charCodeAt(i)) >>> 0;
  }
  return SENDER_PALETTE[hash % SENDER_PALETTE.length];
}

export type FileCategory = 'document' | 'image' | 'other';

export function classifyFileCategory(mimeType: string, fileName: string): FileCategory {
  const mime = (mimeType || '').toLowerCase();
  const name = (fileName || '').toLowerCase();

  if (
    mime.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif|avif|ico|tiff?)$/i.test(name)
  ) {
    return 'image';
  }

  if (
    mime.startsWith('text/') ||
    mime.includes('pdf') ||
    mime.includes('word') ||
    mime.includes('document') ||
    mime.includes('sheet') ||
    mime.includes('excel') ||
    mime.includes('presentation') ||
    mime.includes('powerpoint') ||
    mime.includes('csv') ||
    mime.includes('rtf') ||
    mime === 'application/json' ||
    /\.(pdf|docx?|xlsx?|csv|pptx?|txt|rtf|odt|ods|odp|md|json|xml|pages|numbers|key)$/i.test(
      name,
    )
  ) {
    return 'document';
  }

  return 'other';
}

export function isMessageMentioningUser(
  message: Pick<ChatMessage, 'text' | 'replyTo'>,
  currentUserName: string,
): boolean {
  const cleanName = currentUserName.trim();
  if (!cleanName) return false;

  // Replies directly quoting the current user's message count as mentions
  if (
    message.replyTo?.senderName &&
    message.replyTo.senderName.trim().toLowerCase() === cleanName.toLowerCase()
  ) {
    return true;
  }

  const text = message.text || '';
  if (!text) return false;

  const escapedFull = cleanName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstToken = cleanName.split(/\s+/)[0] ?? '';
  const escapedFirst =
    firstToken.length >= 2 ? firstToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';

  const mentionTargets = [escapedFull, 'all', 'semua'];
  if (escapedFirst && escapedFirst.toLowerCase() !== escapedFull.toLowerCase()) {
    mentionTargets.push(escapedFirst);
  }

  const pattern = new RegExp(
    `(?:^|\\s)@(?:${mentionTargets.join('|')})(?=$|[\\s,.!?:;)"'])`,
    'i',
  );
  return pattern.test(text);
}
