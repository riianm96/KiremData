import { useMemo, useState } from 'react';
import {
  Bell,
  BellOff,
  Download,
  Eye,
  File as FileGenericIcon,
  FileText,
  Image as ImageIcon,
  Lock,
  MessageSquarePlus,
  MonitorDown,
  Radio,
  Search,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  ChatMessage,
  ChatRoom,
  LanPeer,
  NotificationMode,
} from '../types/chat';
import {
  classifyFileCategory,
  formatBytes,
  formatTime,
  type FileCategory,
} from '../utils/format';
import { Avatar } from './Avatar';

export type SidebarTab = 'chats' | 'groups' | 'documents' | 'peers';
export type FileTypeFilter = 'all' | FileCategory;
export type FileDirectionFilter = 'all' | 'received' | 'sent';

interface SidebarProps {
  currentUser: LanPeer | null;
  rooms: ChatRoom[];
  peers: LanPeer[];
  messages: ChatMessage[];
  activeRoomId: string | null;
  muted: boolean;
  notificationMode: NotificationMode;
  wsConnected: boolean;
  isOnline: boolean;
  swOfflineReady: boolean;
  p2pConnectedMap: Record<string, boolean>;
  onSelectRoom: (roomId: string) => void;
  onStartDirectChat: (peer: LanPeer) => void;
  onConnectP2P: (peerId: string) => void;
  onOpenCreateGroup: () => void;
  onOpenLanModal: () => void;
  onToggleMute: () => void;
  onJumpToMessage: (roomId: string, messageId: string) => void;
  onDownloadFile: (message: ChatMessage) => void;
  onPreviewFile: (message: ChatMessage) => void;
  isInstalled: boolean;
  onOpenInstallModal: () => void;
}

function getFileTypeIcon(category: FileCategory) {
  switch (category) {
    case 'image':
      return ImageIcon;
    case 'document':
      return FileText;
    default:
      return FileGenericIcon;
  }
}

export function Sidebar({
  currentUser,
  rooms,
  peers,
  messages,
  activeRoomId,
  muted,
  notificationMode,
  wsConnected,
  isOnline,
  swOfflineReady,
  p2pConnectedMap,
  onSelectRoom,
  onStartDirectChat,
  onConnectP2P,
  onOpenCreateGroup,
  onOpenLanModal,
  onToggleMute,
  onJumpToMessage,
  onDownloadFile,
  onPreviewFile,
  isInstalled,
  onOpenInstallModal,
}: SidebarProps) {
  const [tab, setTab] = useState<SidebarTab>('chats');
  const [searchQuery, setSearchQuery] = useState('');
  const [fileDirectionFilter, setFileDirectionFilter] = useState<FileDirectionFilter>('received');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');

  const onlinePeersCount = peers.filter((p) => p.online && p.id !== currentUser?.id).length;

  const filteredRooms = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rooms
      .filter((r) => (tab === 'groups' ? r.type === 'group' : true))
      .filter((r) => {
        if (!q) return true;
        return (
          r.name.toLowerCase().includes(q) ||
          (r.lastMessageText ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (b.lastMessageTime ?? b.createdAt) - (a.lastMessageTime ?? a.createdAt));
  }, [rooms, tab, searchQuery]);

  // Fast full-history global message search when query >= 2 chars
  const matchingMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const roomLookup = new Map(rooms.map((r) => [r.id, r]));
    return messages
      .filter((m) => {
        const textMatch = m.text?.toLowerCase().includes(q);
        const fileMatch = m.fileMeta?.name.toLowerCase().includes(q);
        return textMatch || fileMatch;
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 20)
      .map((m) => ({
        message: m,
        room: roomLookup.get(m.roomId),
      }))
      .filter((item) => !!item.room);
  }, [messages, rooms, searchQuery]);

  // All files across every room with direction & Document/Image/Other classification
  const allDocumentEntries = useMemo(() => {
    const roomLookup = new Map(rooms.map((r) => [r.id, r]));
    return messages
      .filter((m) => m.type === 'file' && !!m.fileMeta)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((m) => ({
        message: m,
        roomName: roomLookup.get(m.roomId)?.name ?? 'Ruang Lokal',
        direction: (m.senderId === currentUser?.id ? 'sent' : 'received') as 'sent' | 'received',
        category: classifyFileCategory(m.fileMeta!.mimeType, m.fileMeta!.name),
      }));
  }, [messages, rooms, currentUser?.id]);

  const directionCounts = useMemo(() => {
    let received = 0;
    let sent = 0;
    for (const item of allDocumentEntries) {
      if (item.direction === 'received') received += 1;
      else sent += 1;
    }
    return { all: allDocumentEntries.length, received, sent };
  }, [allDocumentEntries]);

  const directionScopedDocuments = useMemo(() => {
    if (fileDirectionFilter === 'all') return allDocumentEntries;
    return allDocumentEntries.filter((item) => item.direction === fileDirectionFilter);
  }, [allDocumentEntries, fileDirectionFilter]);

  const documentCounts = useMemo(() => {
    const counts: Record<FileTypeFilter, number> = {
      all: directionScopedDocuments.length,
      document: 0,
      image: 0,
      other: 0,
    };
    for (const item of directionScopedDocuments) {
      counts[item.category] += 1;
    }
    return counts;
  }, [directionScopedDocuments]);

  const filteredDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return directionScopedDocuments
      .filter((item) => (fileTypeFilter === 'all' ? true : item.category === fileTypeFilter))
      .filter((item) => {
        if (!q) return true;
        return (
          item.message.fileMeta!.name.toLowerCase().includes(q) ||
          item.message.senderName.toLowerCase().includes(q) ||
          item.roomName.toLowerCase().includes(q)
        );
      });
  }, [directionScopedDocuments, fileTypeFilter, searchQuery]);


  const otherPeers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return peers
      .filter((p) => p.id !== currentUser?.id)
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.role.toLowerCase().includes(q) ||
          (p.phone?.toLowerCase().includes(q) ?? false) ||
          (p.shopNote?.toLowerCase().includes(q) ?? false) ||
          p.localIp.includes(q)
        );
      })
      .sort((a, b) => Number(b.isLiveSession) - Number(a.isLiveSession) || Number(b.online) - Number(a.online));
  }, [peers, currentUser?.id, searchQuery]);

  return (
    <aside className="w-full md:w-[360px] lg:w-[390px] bg-[#111B21] border-r border-white/8 flex flex-col h-full shrink-0">
      {/* Top workspace header */}
      <div className="h-16 px-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between gap-3 shrink-0">
        <button
          type="button"
          onClick={onOpenLanModal}
          title="Ubah nama perangkat lokal & pengaturan LAN"
          className="flex items-center gap-3 min-w-0 text-left group rounded-lg pr-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00A884]"
        >
          <Avatar
            name={currentUser?.name || 'Perangkat Saya'}
            src={currentUser?.avatar}
            online={wsConnected}
            size="sm"
          />
          <div className="min-w-0">
            <h1 className="font-display font-bold text-base text-[#E9EDEF] tracking-tight truncate group-hover:text-white transition-colors">
              {currentUser?.name || 'KiremData'}
            </h1>
            <p className="text-[11px] text-[#8696A0] truncate">
              {!isOnline
                ? 'Mode Offline · Cache PWA Aktif'
                : wsConnected
                  ? `Hub Aktif · ${currentUser?.localIp ?? '127.0.0.1'}`
                  : 'Menyambung ulang ke Hub...'}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {!isInstalled && (
            <button
              type="button"
              onClick={onOpenInstallModal}
              title="Pasang KiremData di iOS, Android, Windows, atau Linux"
              aria-label="Pasang Aplikasi"
              className="h-9 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25 transition-colors whitespace-nowrap shrink-0"
            >
              <MonitorDown className="w-4 h-4" />
              <span className="hidden sm:inline">Pasang</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenLanModal}
            title="Radar Perangkat LAN & Tautan Lokal"
            aria-label="Radar LAN"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            <Radio className="w-4.5 h-4.5 text-[#00A884]" />
          </button>

          <button
            type="button"
            onClick={onOpenCreateGroup}
            title="Buat Grup Tim Kantor"
            aria-label="Buat Grup Baru"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            <MessageSquarePlus className="w-4.5 h-4.5" />
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            title={
              notificationMode === 'muted'
                ? 'Notifikasi dibisukan — klik untuk aktifkan'
                : notificationMode === 'mentions'
                  ? 'Mode Hanya Sebutan (@Nama) — klik untuk bisukan'
                  : 'Semua pesan berbunyi — klik untuk bisukan'
            }
            aria-label={muted ? 'Aktifkan notifikasi' : 'Bisukan notifikasi'}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            {notificationMode === 'muted' ? (
              <BellOff className="w-4.5 h-4.5 text-amber-400" />
            ) : (
              <>
                <Bell
                  className={`w-4.5 h-4.5 ${
                    notificationMode === 'mentions' ? 'text-[#00A884]' : ''
                  }`}
                />
                {notificationMode === 'mentions' && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#00A884]" />
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Global Search Input & Segmented Navigation */}
      <div className="px-3 py-2.5 border-b border-white/6 bg-[#111B21]">
        <div className="relative flex items-center bg-[#202C33] rounded-lg px-3 h-10 border border-white/5 focus-within:border-[#00A884]/50 transition-colors">
          <Search className="w-4 h-4 text-[#8696A0] shrink-0 mr-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              tab === 'documents'
                ? 'Cari nama dokumen, pengirim, atau ruangan...'
                : 'Cari obrolan, pesan, atau dokumen...'
            }
            className="w-full bg-transparent text-sm text-[#E9EDEF] placeholder-[#8696A0] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Bersihkan pencarian"
              className="text-[#8696A0] hover:text-white ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Segmented filter tabs */}
        <div className="grid grid-cols-4 gap-1 mt-2.5 p-1 rounded-lg bg-[#202C33]/80 border border-white/5">
          <button
            type="button"
            onClick={() => setTab('chats')}
            className={`py-1.5 px-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap truncate ${
              tab === 'chats'
                ? 'bg-[#00A884]/20 text-[#00A884]'
                : 'text-[#8696A0] hover:text-[#E9EDEF]'
            }`}
          >
            Obrolan
          </button>
          <button
            type="button"
            onClick={() => setTab('groups')}
            className={`py-1.5 px-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap truncate ${
              tab === 'groups'
                ? 'bg-[#00A884]/20 text-[#00A884]'
                : 'text-[#8696A0] hover:text-[#E9EDEF]'
            }`}
          >
            Grup
          </button>
          <button
            type="button"
            onClick={() => setTab('documents')}
            className={`py-1.5 px-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap truncate ${
              tab === 'documents'
                ? 'bg-[#00A884]/20 text-[#00A884]'
                : 'text-[#8696A0] hover:text-[#E9EDEF]'
            }`}
          >
            File
          </button>
          <button
            type="button"
            onClick={() => setTab('peers')}
            className={`py-1.5 px-1 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap truncate ${
              tab === 'peers'
                ? 'bg-[#00A884]/20 text-[#00A884]'
                : 'text-[#8696A0] hover:text-[#E9EDEF]'
            }`}
          >
            Perangkat ({onlinePeersCount})
          </button>
        </div>
      </div>

      {/* Main list area */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {(tab === 'chats' || tab === 'groups') && (
          <>
            {filteredRooms.length === 0 && matchingMessages.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-sm text-[#8696A0] mb-3">
                  {searchQuery ? 'Tidak ada obrolan yang cocok.' : 'Belum ada percakapan aktif.'}
                </p>
                <button
                  type="button"
                  onClick={onOpenCreateGroup}
                  className="px-4 py-2 rounded-lg bg-[#00A884] text-[#0B141A] text-xs font-semibold hover:bg-[#029676] transition-colors"
                >
                  Buat Grup Tim Baru
                </button>
              </div>
            )}

            {filteredRooms.map((room) => {
              const peer =
                room.type === 'direct'
                  ? peers.find((p) => p.id !== currentUser?.id && room.memberIds.includes(p.id))
                  : undefined;
              const isSelected = room.id === activeRoomId;
              const isTyping = (room.typingUserIds?.length ?? 0) > 0;

              return (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => onSelectRoom(room.id)}
                  className={`w-full px-3.5 py-3 flex items-center gap-3 text-left transition-colors ${
                    isSelected ? 'bg-[#2A3942]' : 'hover:bg-[#202C33]/70'
                  }`}
                >
                  <Avatar
                    name={room.name}
                    src={room.avatar ?? peer?.avatar}
                    isGroup={room.type === 'group'}
                    online={peer?.online}
                    size="md"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display font-medium text-[14.5px] text-[#E9EDEF] truncate">
                        {room.name}
                      </span>
                      <span
                        className={`text-[11px] font-mono-tabular shrink-0 ${
                          room.unreadCount > 0 ? 'text-[#00A884] font-semibold' : 'text-[#8696A0]'
                        }`}
                      >
                        {room.lastMessageTime ? formatTime(room.lastMessageTime) : ''}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p
                        className={`text-xs truncate ${
                          isTyping ? 'text-[#00A884] font-medium' : 'text-[#8696A0]'
                        }`}
                      >
                        {isTyping
                          ? 'Sedang mengetik...'
                          : room.lastMessageText || 'Saluran terenkripsi siap digunakan'}
                      </p>

                      {room.unreadCount > 0 && (
                        <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#00A884] text-[#0B141A] text-[11px] font-mono-tabular font-bold flex items-center justify-center shrink-0">
                          {room.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}

            {/* Global message search results section */}
            {matchingMessages.length > 0 && (
              <div className="pt-2 pb-4 bg-[#0B141A]/40">
                <div className="px-4 py-2 text-xs font-semibold text-[#00A884] flex items-center justify-between">
                  <span>Riwayat Pesan Cocok</span>
                  <span className="font-mono-tabular text-[#8696A0]">{matchingMessages.length} hasil</span>
                </div>
                {matchingMessages.map(({ message, room }) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => onJumpToMessage(message.roomId, message.id)}
                    className="w-full px-4 py-2.5 text-left hover:bg-[#202C33]/80 transition-colors border-t border-white/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#E9EDEF] truncate">
                        {room?.name}
                      </span>
                      <span className="text-[11px] font-mono-tabular text-[#8696A0]">
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs text-[#8696A0] truncate mt-0.5">
                      <span className="text-[#AEBAC1]">{message.senderName}: </span>
                      {message.fileMeta ? `Dokumen: ${message.fileMeta.name}` : message.text}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'documents' && (
          <div>
            {/* Direction & File type filter bar */}
            <div className="px-3 py-2.5 bg-[#182229]/70 border-b border-white/6 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#E9EDEF]">
                  {fileDirectionFilter === 'received'
                    ? 'Daftar File Diterima'
                    : fileDirectionFilter === 'sent'
                      ? 'Daftar File Dikirim'
                      : 'Semua File Lintas Ruangan'}
                </span>
                <span className="font-mono-tabular text-[#8696A0]">
                  {filteredDocuments.length} berkas
                </span>
              </div>

              {/* Direction tabs */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#111B21] border border-white/5">
                {(
                  [
                    { id: 'received', label: 'Diterima' },
                    { id: 'sent', label: 'Dikirim' },
                    { id: 'all', label: 'Semua' },
                  ] as const
                ).map((dir) => (
                  <button
                    key={dir.id}
                    type="button"
                    onClick={() => setFileDirectionFilter(dir.id)}
                    className={`py-1 px-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                      fileDirectionFilter === dir.id
                        ? 'bg-[#202C33] text-[#E9EDEF] border border-white/10'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    {dir.label} ({directionCounts[dir.id]})
                  </button>
                ))}
              </div>

              {/* Category filter tabs: Semua | Dokumen | Gambar | Lainnya */}
              <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#111B21] border border-white/5">
                {(
                  [
                    { id: 'all', label: 'Semua' },
                    { id: 'document', label: 'Dokumen' },
                    { id: 'image', label: 'Gambar' },
                    { id: 'other', label: 'Lainnya' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFileTypeFilter(item.id)}
                    className={`py-1 px-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                      fileTypeFilter === item.id
                        ? 'bg-[#00A884]/20 text-[#00A884]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    {item.label} ({documentCounts[item.id]})
                  </button>
                ))}
              </div>
            </div>

            {filteredDocuments.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="w-8 h-8 text-[#8696A0] mx-auto mb-2 opacity-60" />
                <p className="text-sm text-[#E9EDEF] font-medium mb-1">
                  Tidak Ada File
                </p>
                <p className="text-xs text-[#8696A0] leading-relaxed">
                  {searchQuery || fileTypeFilter !== 'all'
                    ? 'Tidak ditemukan file yang cocok dengan filter tipe file atau kata kunci.'
                    : fileDirectionFilter === 'received'
                      ? 'File transaksi, foto unit, atau dokumen yang diterima dari rekan akan muncul di sini.'
                      : 'File yang Anda bagikan atau terima di seluruh obrolan dan grup akan muncul di sini.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredDocuments.map(({ message, roomName, direction, category }) => {
                  const fileMeta = message.fileMeta!;
                  const FileIcon = getFileTypeIcon(category);
                  const canPreview =
                    fileMeta.mimeType.startsWith('image/') ||
                    fileMeta.mimeType.startsWith('text/');

                  return (
                    <div
                      key={message.id}
                      className="px-3.5 py-3 hover:bg-[#202C33]/60 transition-colors flex items-start gap-3"
                    >
                      <div className="w-9 h-9 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0 mt-0.5">
                        <FileIcon className="w-4.5 h-4.5" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => onJumpToMessage(message.roomId, message.id)}
                          title="Buka pesan di ruangan"
                          className="text-left w-full group"
                        >
                          <p className="text-sm font-medium text-[#E9EDEF] group-hover:text-[#00A884] truncate transition-colors">
                            {fileMeta.name}
                          </p>
                          <p className="text-[11px] text-[#8696A0] truncate mt-0.5">
                            {direction === 'received' ? 'Dari' : 'Terkirim'} {message.senderName} · {roomName}
                          </p>
                          <p className="text-[11px] font-mono-tabular text-[#8696A0]/90 mt-0.5">
                            {formatBytes(fileMeta.size)} ·{' '}
                            {category === 'document'
                              ? 'Dokumen'
                              : category === 'image'
                                ? 'Gambar'
                                : 'Lainnya'}{' '}
                            · {formatTime(message.timestamp)}
                          </p>
                        </button>
                      </div>

                      <div className="flex items-center gap-1 shrink-0 mt-0.5">
                        {canPreview && (
                          <button
                            type="button"
                            onClick={() => onPreviewFile(message)}
                            title="Pratinjau file"
                            aria-label={`Pratinjau ${fileMeta.name}`}
                            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/12 text-[#AEBAC1] hover:text-white flex items-center justify-center transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onDownloadFile(message)}
                          title="Unduh file"
                          aria-label={`Unduh ${fileMeta.name}`}
                          className="w-8 h-8 rounded-lg bg-[#00A884]/15 hover:bg-[#00A884]/25 text-[#00A884] flex items-center justify-center transition-colors"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'peers' && (
          <div className="divide-y divide-white/5">
            <div className="px-4 py-3 bg-[#182229]/60 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-[#E9EDEF]">Rekan & Perangkat Jaringan Lokal</p>
                <p className="text-[11px] text-[#8696A0] mt-0.5">
                  Klik rekan untuk obrolan terenkripsi atau hubungkan Wi-Fi Direct
                </p>
              </div>
            </div>

            {otherPeers.map((peer) => {
              const isP2P = !!p2pConnectedMap[peer.id];
              return (
                <div
                  key={peer.id}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-[#202C33]/50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onStartDirectChat(peer)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <Avatar name={peer.name} src={peer.avatar} online={peer.online} size="md" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display font-medium text-sm text-[#E9EDEF] truncate">
                          {peer.name}
                        </span>
                        {peer.isLiveSession && (
                          <span className="text-[10px] font-medium text-[#00A884]">· Tab/Perangkat Aktif</span>
                        )}
                      </div>
                      <p className="text-xs text-[#8696A0] truncate">
                        {peer.shopNote ? peer.shopNote : peer.role} ·{' '}
                        <span className="font-mono-tabular">
                          {peer.phone ? `${peer.phone} · ` : ''}
                          {peer.localIp}
                        </span>
                      </p>
                      <p className="text-[11px] text-[#8696A0]/80 font-mono-tabular truncate mt-0.5">
                        Kunci: {peer.fingerprint}
                      </p>
                    </div>
                  </button>

                  {peer.isLiveSession && peer.online && (
                    <button
                      type="button"
                      onClick={() => onConnectP2P(peer.id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors ${
                        isP2P
                          ? 'bg-[#00A884]/15 text-[#00A884] border-[#00A884]/35'
                          : 'bg-[#202C33] text-[#E9EDEF] border-white/10 hover:border-[#00A884]/50'
                      }`}
                    >
                      {isP2P ? 'P2P Siap' : 'Pair P2P'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Quiet bottom encryption & PWA offline status footer */}
      <div className="px-4 py-2.5 bg-[#0B141A] border-t border-white/6 flex items-center justify-between text-[11px] text-[#8696A0] shrink-0">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-[#00A884]" />
          <span>ECDH P-256 · AES-GCM-256</span>
        </span>
        <span className="inline-flex items-center gap-1 font-mono-tabular">
          {isOnline ? (
            <Wifi className="w-3 h-3 text-[#00A884]" />
          ) : (
            <WifiOff className="w-3 h-3 text-amber-400" />
          )}
          <span className={!isOnline ? 'text-amber-300' : ''}>
            {!isOnline
              ? 'Offline · Cache Lokal'
              : swOfflineReady
                ? 'PWA Siap Offline'
                : 'Online'}
          </span>
        </span>
      </div>
    </aside>
  );
}
