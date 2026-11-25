import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  File as FileGenericIcon,
  FileText,
  Image as ImageIcon,
  Laptop,
  Lock,
  Phone,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type { ChatMessage, ChatRoom, LanPeer, MessageType } from '../types/chat';
import { classifyFileCategory, formatBytes, formatTime, type FileCategory } from '../utils/format';
import { Avatar } from './Avatar';

export type DrawerMode = 'search' | 'info' | null;

interface RightDrawerProps {
  mode: DrawerMode;
  room: ChatRoom;
  peers: LanPeer[];
  messages: ChatMessage[];
  currentUserId: string;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onOpenSecurity: () => void;
  onAddGroupMember: (groupId: string, peerId: string) => void;
  onDownloadFile: (message: ChatMessage) => void;
  onRequestClearRoom: () => void;
}

export function RightDrawer({
  mode,
  room,
  peers,
  messages,
  currentUserId,
  searchQuery,
  onSearchQueryChange,
  onClose,
  onJumpToMessage,
  onOpenSecurity,
  onAddGroupMember,
  onDownloadFile,
  onRequestClearRoom,
}: RightDrawerProps) {
  const [typeFilter, setTypeFilter] = useState<'all' | MessageType>('all');
  const [selectedMatchIdx, setSelectedMatchIdx] = useState(0);
  const [showAddMember, setShowAddMember] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [sharedDirFilter, setSharedDirFilter] = useState<'all' | 'received' | 'sent'>('received');
  const [sharedCatFilter, setSharedCatFilter] = useState<'all' | FileCategory>('all');

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return messages
      .filter((m) => (typeFilter === 'all' ? true : m.type === typeFilter))
      .filter((m) => {
        if (!q) return typeFilter !== 'all';
        return (
          m.text.toLowerCase().includes(q) ||
          m.senderName.toLowerCase().includes(q) ||
          (m.fileMeta?.name.toLowerCase().includes(q) ?? false)
        );
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [messages, searchQuery, typeFilter]);

  const sharedFileEntries = useMemo(
    () =>
      messages
        .filter((m) => m.type === 'file' && m.fileMeta)
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((m) => ({
          message: m,
          direction: (m.senderId === currentUserId ? 'sent' : 'received') as 'sent' | 'received',
          category: classifyFileCategory(m.fileMeta!.mimeType, m.fileMeta!.name),
        })),
    [messages, currentUserId],
  );

  const sharedDirCounts = useMemo(() => {
    let received = 0;
    let sent = 0;
    for (const item of sharedFileEntries) {
      if (item.direction === 'received') received += 1;
      else sent += 1;
    }
    return { all: sharedFileEntries.length, received, sent };
  }, [sharedFileEntries]);

  const directionScopedShared = useMemo(() => {
    if (sharedDirFilter === 'all') return sharedFileEntries;
    return sharedFileEntries.filter((item) => item.direction === sharedDirFilter);
  }, [sharedFileEntries, sharedDirFilter]);

  const sharedCatCounts = useMemo(() => {
    const counts: Record<'all' | FileCategory, number> = {
      all: directionScopedShared.length,
      document: 0,
      image: 0,
      other: 0,
    };
    for (const item of directionScopedShared) {
      counts[item.category] += 1;
    }
    return counts;
  }, [directionScopedShared]);

  const filteredSharedFiles = useMemo(
    () =>
      directionScopedShared.filter((item) =>
        sharedCatFilter === 'all' ? true : item.category === sharedCatFilter,
      ),
    [directionScopedShared, sharedCatFilter],
  );

  const memberPeers = useMemo(
    () => room.memberIds.map((id) => peers.find((p) => p.id === id)).filter((p): p is LanPeer => !!p),
    [room.memberIds, peers],
  );

  const directPeer = useMemo(
    () => (room.type === 'direct' ? memberPeers.find((m) => m.id !== currentUserId) : undefined),
    [room.type, memberPeers, currentUserId],
  );

  const availablePeersToAdd = useMemo(
    () => peers.filter((p) => p.id !== currentUserId && !room.memberIds.includes(p.id)),
    [peers, currentUserId, room.memberIds],
  );

  if (!mode) return null;

  function handleCopyPhone(phoneNumber: string) {
    navigator.clipboard?.writeText(phoneNumber).catch(() => {});
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  }

  function stepMatch(delta: number) {
    if (searchResults.length === 0) return;
    const nextIdx = (selectedMatchIdx + delta + searchResults.length) % searchResults.length;
    setSelectedMatchIdx(nextIdx);
    onJumpToMessage(searchResults[nextIdx].id);
  }

  return (
    <aside className="w-full sm:w-[340px] lg:w-[360px] bg-[#111B21] border-l border-white/8 flex flex-col h-full shrink-0 z-20">
      <div className="h-16 px-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between shrink-0">
        <h3 className="font-display font-semibold text-[15px] text-[#E9EDEF]">
          {mode === 'search' ? 'Pencarian Riwayat Pesan' : room.type === 'group' ? 'Info Grup Tim' : 'Info Kontak'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panel"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-white hover:bg-white/5 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {mode === 'search' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3.5 border-b border-white/6 space-y-2.5">
            <div className="flex items-center gap-2 bg-[#202C33] border border-white/6 focus-within:border-[#00A884]/50 rounded-lg px-3 h-10">
              <Search className="w-4 h-4 text-[#8696A0] shrink-0" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => {
                  onSearchQueryChange(e.target.value);
                  setSelectedMatchIdx(0);
                }}
                placeholder="Cari kata kunci atau nama file..."
                className="w-full bg-transparent text-sm text-[#E9EDEF] placeholder-[#8696A0] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchQueryChange('')}
                  className="text-[#8696A0] hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Type filter segmented bar */}
            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#202C33]">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'text', label: 'Teks' },
                  { id: 'file', label: 'Dokumen' },
                  { id: 'voice', label: 'Suara' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTypeFilter(item.id);
                    setSelectedMatchIdx(0);
                  }}
                  className={`py-1.5 rounded-md text-xs font-medium transition-colors ${
                    typeFilter === item.id
                      ? 'bg-[#00A884]/20 text-[#00A884]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {searchResults.length > 0 && (
              <div className="flex items-center justify-between text-xs text-[#8696A0] pt-0.5">
                <span className="font-mono-tabular">
                  {selectedMatchIdx + 1} dari {searchResults.length} hasil
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepMatch(-1)}
                    aria-label="Hasil sebelumnya"
                    className="p-1.5 rounded bg-[#202C33] hover:bg-white/10 text-[#E9EDEF]"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => stepMatch(1)}
                    aria-label="Hasil berikutnya"
                    className="p-1.5 rounded bg-[#202C33] hover:bg-white/10 text-[#E9EDEF]"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {searchResults.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8696A0]">
                {searchQuery || typeFilter !== 'all'
                  ? 'Tidak ditemukan pesan yang sesuai dengan filter.'
                  : 'Ketik kata kunci atau pilih tipe pesan untuk mencari riwayat.'}
              </div>
            ) : (
              searchResults.map((msg, idx) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => {
                    setSelectedMatchIdx(idx);
                    onJumpToMessage(msg.id);
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors ${
                    idx === selectedMatchIdx ? 'bg-[#202C33]' : 'hover:bg-[#202C33]/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-[#00A884] truncate">
                      {msg.senderName}
                    </span>
                    <span className="text-[11px] font-mono-tabular text-[#8696A0]">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-xs text-[#E9EDEF] line-clamp-2 leading-relaxed">
                    {msg.fileMeta
                      ? `Dokumen: ${msg.fileMeta.name} (${formatBytes(msg.fileMeta.size)})`
                      : msg.type === 'voice'
                        ? `Pesan Suara (${msg.voiceMeta?.durationSec ?? 0} detik)`
                        : msg.text}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-white/8">
          {/* Room summary */}
          <div className="p-6 text-center bg-[#182229]/40">
            <div className="flex justify-center mb-3">
              <Avatar
                name={room.name}
                src={room.avatar ?? memberPeers.find((m) => m.id !== currentUserId)?.avatar}
                isGroup={room.type === 'group'}
                size="lg"
              />
            </div>
            <h4 className="font-display font-bold text-lg text-[#E9EDEF]">{room.name}</h4>
            <p className="text-xs text-[#8696A0] mt-1">
              {room.type === 'group'
                ? `Grup Kantor · ${room.memberIds.length} anggota`
                : 'Obrolan Pribadi Jaringan Lokal'}
            </p>
            {room.description && (
              <p className="text-xs text-[#AEBAC1] mt-2.5 leading-relaxed">{room.description}</p>
            )}
          </div>

          {/* Direct peer contact info & shop note */}
          {room.type === 'direct' && directPeer && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8696A0]">
                  Detail Kontak & Info Toko
                </span>
                <span
                  className={`text-[11px] font-medium ${
                    directPeer.online ? 'text-[#00A884]' : 'text-[#8696A0]'
                  }`}
                >
                  {directPeer.online ? 'Terhubung di LAN' : 'Sedang Offline'}
                </span>
              </div>

              <div className="rounded-xl bg-[#182229] border border-white/8 divide-y divide-white/6">
                {/* Phone number row */}
                <div className="p-3 flex items-center justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Phone className="w-4 h-4 text-[#00A884] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-[#8696A0]">Nomor HP / WhatsApp</p>
                      <p
                        className={`text-sm font-mono-tabular mt-0.5 truncate ${
                          directPeer.phone ? 'text-[#E9EDEF] font-medium' : 'text-[#8696A0] italic'
                        }`}
                      >
                        {directPeer.phone || 'Belum ditambahkan'}
                      </p>
                    </div>
                  </div>
                  {directPeer.phone && (
                    <button
                      type="button"
                      onClick={() => handleCopyPhone(directPeer.phone!)}
                      aria-label="Salin nomor HP"
                      className="px-2.5 py-1.5 rounded-lg bg-white/6 hover:bg-white/12 text-xs text-[#E9EDEF] flex items-center gap-1 shrink-0 transition-colors"
                    >
                      {copiedPhone ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-[#00A884]" />
                          <span>Tersalin</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Salin</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Shop note / business bio row */}
                <div className="p-3 flex items-start gap-2.5">
                  <Store className="w-4 h-4 text-[#00A884] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Catatan Toko / Bio</p>
                    <p
                      className={`text-xs mt-0.5 leading-relaxed whitespace-pre-wrap break-words ${
                        directPeer.shopNote ? 'text-[#E9EDEF]' : 'text-[#8696A0] italic'
                      }`}
                    >
                      {directPeer.shopNote || 'Belum ada catatan toko atau bio.'}
                    </p>
                  </div>
                </div>

                {/* Device & local IP row */}
                <div className="p-3 flex items-start gap-2.5">
                  <Laptop className="w-4 h-4 text-[#8696A0] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Perangkat & Alamat LAN</p>
                    <p className="text-xs text-[#AEBAC1] mt-0.5 truncate">
                      {directPeer.deviceName} ·{' '}
                      <span className="font-mono-tabular">{directPeer.localIp}</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* E2EE verification action */}
          <div className="p-4">
            <button
              type="button"
              onClick={onOpenSecurity}
              className="w-full p-3.5 rounded-xl bg-[#182229] hover:bg-[#202C33] border border-white/8 flex items-start gap-3 text-left transition-colors"
            >
              <ShieldCheck className="w-5 h-5 text-[#00A884] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[#E9EDEF]">Enkripsi Ujung-ke-Ujung Aktif</p>
                <p className="text-xs text-[#8696A0] mt-0.5 leading-relaxed">
                  Ketuk untuk memeriksa Nomor Keamanan 60-digit dan sidik jari kunci ECDH P-256.
                </p>
              </div>
            </button>
          </div>

          {/* Group members management */}
          {room.type === 'group' && (
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8696A0] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Anggota Grup ({memberPeers.length})
                </span>

                {availablePeersToAdd.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAddMember((s) => !s)}
                    className="text-xs font-medium text-[#00A884] hover:underline flex items-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Tambah Anggota</span>
                  </button>
                )}
              </div>

              {showAddMember && availablePeersToAdd.length > 0 && (
                <div className="p-2 rounded-lg bg-[#182229] border border-white/8 space-y-1">
                  <p className="text-[11px] text-[#8696A0] px-2 py-1">
                    Pilih rekan LAN untuk bagikan kunci grup terenkripsi:
                  </p>
                  {availablePeersToAdd.map((peer) => (
                    <button
                      key={peer.id}
                      type="button"
                      onClick={() => {
                        onAddGroupMember(room.id, peer.id);
                        setShowAddMember(false);
                      }}
                      className="w-full px-2 py-1.5 rounded-md hover:bg-white/5 flex items-center justify-between text-left text-xs text-[#E9EDEF]"
                    >
                      <span>{peer.name}</span>
                      <span className="text-[#00A884] font-medium">+ Tambah</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2.5">
                {memberPeers.map((member) => (
                  <div key={member.id} className="flex items-start gap-3 py-1">
                    <Avatar name={member.name} src={member.avatar} online={member.online} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#E9EDEF] truncate">
                        {member.name} {member.id === currentUserId ? '(Anda)' : ''}
                      </p>
                      <p className="text-[11px] text-[#8696A0] truncate">
                        {member.role} · <span className="font-mono-tabular">{member.localIp}</span>
                      </p>
                      {(member.phone || member.shopNote) && (
                        <p className="text-[11px] text-[#00A884]/90 truncate mt-0.5">
                          {[member.phone, member.shopNote].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <Lock className="w-3.5 h-3.5 text-[#00A884] shrink-0 mt-1" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Shared files & received documents */}
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#8696A0]">
                File & Dokumen ({sharedFileEntries.length})
              </span>
              <span className="text-[11px] text-[#00A884] inline-flex items-center gap-1">
                <Wifi className="w-3 h-3" /> Tersinkronisasi
              </span>
            </div>

            {sharedFileEntries.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#182229] border border-white/6">
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
                      onClick={() => setSharedDirFilter(dir.id)}
                      className={`py-1 px-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                        sharedDirFilter === dir.id
                          ? 'bg-[#202C33] text-[#E9EDEF]'
                          : 'text-[#8696A0] hover:text-[#E9EDEF]'
                      }`}
                    >
                      {dir.label} ({sharedDirCounts[dir.id]})
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#182229] border border-white/6">
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      { id: 'document', label: 'Dokumen' },
                      { id: 'image', label: 'Gambar' },
                      { id: 'other', label: 'Lainnya' },
                    ] as const
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSharedCatFilter(cat.id)}
                      className={`py-1 px-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap truncate ${
                        sharedCatFilter === cat.id
                          ? 'bg-[#00A884]/20 text-[#00A884]'
                          : 'text-[#8696A0] hover:text-[#E9EDEF]'
                      }`}
                    >
                      {cat.label} ({sharedCatCounts[cat.id]})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {filteredSharedFiles.length === 0 ? (
              <p className="text-xs text-[#8696A0] py-2">
                {sharedFileEntries.length === 0
                  ? 'Belum ada file atau dokumen yang dibagikan.'
                  : 'Tidak ada file pada kategori atau filter ini.'}
              </p>
            ) : (
              <div className="space-y-2">
                {filteredSharedFiles.map(({ message: msg, category }) => {
                  const IconComp =
                    category === 'image'
                      ? ImageIcon
                      : category === 'document'
                        ? FileText
                        : FileGenericIcon;
                  return (
                    <div
                      key={msg.id}
                      className="p-2.5 rounded-lg bg-[#182229] border border-white/6 flex items-center justify-between gap-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(msg.id)}
                        className="flex items-center gap-2.5 min-w-0 text-left group flex-1"
                      >
                        <IconComp className="w-4 h-4 text-[#00A884] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#E9EDEF] group-hover:text-[#00A884] truncate transition-colors">
                            {msg.fileMeta?.name}
                          </p>
                          <p className="text-[11px] text-[#8696A0] font-mono-tabular">
                            {formatBytes(msg.fileMeta?.size ?? 0)} ·{' '}
                            {category === 'document'
                              ? 'Dokumen'
                              : category === 'image'
                                ? 'Gambar'
                                : 'Lainnya'}{' '}
                            · {formatTime(msg.timestamp)}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDownloadFile(msg)}
                        aria-label={`Unduh ${msg.fileMeta?.name}`}
                        className="p-1.5 rounded-md bg-white/5 hover:bg-white/10 text-[#AEBAC1] hover:text-white shrink-0"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Danger Zone: Clear Room History */}
          <div className="p-4">
            <button
              type="button"
              onClick={onRequestClearRoom}
              className="w-full p-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/15 border border-rose-500/25 flex items-center justify-center gap-2 text-xs font-semibold text-rose-400 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>Hapus Riwayat Obrolan Ini</span>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
