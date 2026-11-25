import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, X } from 'lucide-react';
import type { ChatRoom, LanPeer } from '../types/chat';
import { computeSafetyNumber } from '../services/crypto';

interface SecurityModalProps {
  open: boolean;
  room: ChatRoom | null;
  currentUser: LanPeer | null;
  targetPeer?: LanPeer;
  onClose: () => void;
}

export function SecurityModal({
  open,
  room,
  currentUser,
  targetPeer,
  onClose,
}: SecurityModalProps) {
  const [safetyBlocks, setSafetyBlocks] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !currentUser) return;
    const otherPub = targetPeer?.publicKeyJwk ?? currentUser.publicKeyJwk;
    computeSafetyNumber(currentUser.publicKeyJwk, otherPub)
      .then(setSafetyBlocks)
      .catch(() => setSafetyBlocks([]));
  }, [open, currentUser, targetPeer]);

  if (!open || !room || !currentUser) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#00A884]" />
            <h3 className="font-display font-semibold text-base text-[#E9EDEF]">
              Verifikasi Enkripsi Ujung-ke-Ujung
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8696A0] hover:text-white hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-4 rounded-xl bg-[#182229] border border-white/8 text-center">
            <div className="w-12 h-12 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mx-auto mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h4 className="font-display font-semibold text-sm text-[#E9EDEF]">
              {room.type === 'group' ? `Grup "${room.name}" Terenkripsi` : `Obrolan dengan ${targetPeer?.name}`}
            </h4>
            <p className="text-xs text-[#8696A0] mt-1.5 leading-relaxed">
              Pesan teks dan suara dienkripsi dengan AES-GCM 256-bit dan pertukaran kunci ECDH P-256. File dienkripsi saat dikirim lewat P2P; jika enkripsi aktif dan P2P tidak tersedia, transfer dihentikan. Menonaktifkan enkripsi file mengizinkan transfer melalui hub tanpa enkripsi ujung-ke-ujung.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-[#AEBAC1] mb-2">
              {room.type === 'group' ? 'Sidik Jari Kunci Perangkat Anda' : 'Nomor Keamanan 60-Digit'}
            </p>
            <div className="p-4 rounded-xl bg-[#0B141A] border border-white/8 grid grid-cols-4 gap-2 text-center font-mono-tabular text-sm text-[#E9EDEF] tracking-wider">
              {safetyBlocks.map((block, idx) => (
                <span key={idx} className="py-1 rounded bg-white/4">
                  {block}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-[#8696A0] mt-2 leading-relaxed">
              Bandingkan angka di atas dengan perangkat {targetPeer ? targetPeer.name : 'rekan Anda'} secara langsung untuk memastikan tidak ada intersepsi di jaringan lokal.
            </p>
          </div>

          <div className="pt-2 border-t border-white/8 flex items-center justify-between text-xs text-[#8696A0]">
            <span>Sidik Jari Anda:</span>
            <span className="font-mono-tabular text-[#E9EDEF]">{currentUser.fingerprint}</span>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-sm font-semibold transition-colors"
            >
              Selesai
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
