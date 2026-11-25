import { ArrowLeft, Info, Lock, Search, Trash2, Wifi } from 'lucide-react';
import type { ChatRoom, LanPeer } from '../types/chat';
import { Avatar } from './Avatar';

interface ChatHeaderProps {
  room: ChatRoom;
  peer?: LanPeer;
  p2pConnected: boolean;
  typingNames: string[];
  onBackMobile: () => void;
  onOpenSearch: () => void;
  onOpenSecurity: () => void;
  onOpenInfo: () => void;
  onRequestClearRoom: () => void;
  onConnectWifiDirect: () => void;
}

export function ChatHeader({
  room,
  peer,
  p2pConnected,
  typingNames,
  onBackMobile,
  onOpenSearch,
  onOpenSecurity,
  onOpenInfo,
  onRequestClearRoom,
  onConnectWifiDirect,
}: ChatHeaderProps) {
  const subtitle = (() => {
    if (typingNames.length > 0) {
      return `${typingNames.join(', ')} sedang mengetik...`;
    }
    if (room.type === 'group') {
      return `${room.memberIds.length} anggota · Enkripsi Ujung-ke-Ujung`;
    }
    if (peer) {
      const conn = p2pConnected
        ? 'Wi-Fi Direct Terhubung'
        : peer.online
          ? `Aktif di LAN (${peer.localIp})`
          : 'Tersimpan di Jaringan Lokal';
      return `${conn} · ${peer.role}`;
    }
    return 'Saluran Terenkripsi Lokal';
  })();

  return (
    <header className="h-16 px-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onBackMobile}
          aria-label="Kembali ke daftar obrolan"
          className="md:hidden w-10 h-10 -ml-2 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onOpenInfo}
          className="flex items-center gap-3 min-w-0 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00A884] rounded-lg pr-2 py-1"
        >
          <Avatar
            name={room.name}
            src={room.avatar ?? peer?.avatar}
            isGroup={room.type === 'group'}
            online={peer?.online}
            size="md"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-display font-semibold text-[15px] text-[#E9EDEF] truncate group-hover:text-white transition-colors">
                {room.name}
              </h2>
            </div>
            <p
              className={`text-xs truncate ${
                typingNames.length > 0 ? 'text-[#00A884] font-medium' : 'text-[#8696A0]'
              }`}
            >
              {subtitle}
            </p>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {room.type === 'direct' && peer?.isLiveSession && (
          <button
            type="button"
            onClick={onConnectWifiDirect}
            title="Hubungkan jalur Wi-Fi Direct P2P untuk transfer berkecepatan tinggi"
            className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
              p2pConnected
                ? 'bg-[#00A884]/15 text-[#00A884] border-[#00A884]/35'
                : 'bg-[#182229] text-[#AEBAC1] border-white/10 hover:text-[#E9EDEF] hover:border-white/20'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>{p2pConnected ? 'Wi-Fi Direct Aktif' : 'Hubungkan P2P'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onOpenSecurity}
          title="Verifikasi Enkripsi Ujung-ke-Ujung"
          className="h-10 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-medium text-[#00A884] hover:bg-white/5 transition-colors whitespace-nowrap shrink-0"
        >
          <Lock className="w-4 h-4" />
          <span className="hidden lg:inline">Terenkripsi</span>
        </button>

        <button
          type="button"
          onClick={onOpenSearch}
          title="Cari riwayat pesan di obrolan ini"
          aria-label="Cari riwayat pesan"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors shrink-0"
        >
          <Search className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={onRequestClearRoom}
          title="Hapus riwayat obrolan"
          aria-label="Hapus riwayat obrolan"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-rose-400 hover:bg-white/5 transition-colors shrink-0"
        >
          <Trash2 className="w-4.5 h-4.5" />
        </button>

        <button
          type="button"
          onClick={onOpenInfo}
          title="Informasi & Dokumen Bersama"
          aria-label="Informasi obrolan"
          className="w-10 h-10 rounded-lg flex items-center justify-center text-[#AEBAC1] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors shrink-0"
        >
          <Info className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
