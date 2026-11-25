import { useState } from 'react';
import { Check, Lock, Users, X } from 'lucide-react';
import type { LanPeer } from '../types/chat';
import { Avatar } from './Avatar';

interface CreateGroupModalProps {
  open: boolean;
  peers: LanPeer[];
  currentUserId: string;
  onClose: () => void;
  onCreate: (name: string, description: string, memberIds: string[]) => void;
}

export function CreateGroupModal({
  open,
  peers,
  currentUserId,
  onClose,
  onCreate,
}: CreateGroupModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  if (!open) return null;

  const availablePeers = peers.filter((p) => p.id !== currentUserId);

  function toggleMember(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(name.trim(), description.trim(), selectedIds);
    setName('');
    setDescription('');
    setSelectedIds([]);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Users className="w-5 h-5 text-[#00A884]" />
            <h3 className="font-display font-semibold text-base text-[#E9EDEF]">
              Buat Grup Tim Kantor
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#AEBAC1] mb-1.5">
              Nama Grup
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Tim Keuangan & Audit"
              className="w-full h-10 px-3.5 rounded-lg bg-[#202C33] border border-white/10 text-sm text-[#E9EDEF] placeholder-[#8696A0] focus:outline-none focus:border-[#00A884]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#AEBAC1] mb-1.5">
              Deskripsi Singkat (Opsional)
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Koordinasi harian dan berbagi dokumen lokal"
              className="w-full h-10 px-3.5 rounded-lg bg-[#202C33] border border-white/10 text-sm text-[#E9EDEF] placeholder-[#8696A0] focus:outline-none focus:border-[#00A884]"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-[#AEBAC1]">
                Pilih Anggota Jaringan Lokal ({selectedIds.length} dipilih)
              </label>
              <span className="text-[11px] text-[#00A884] inline-flex items-center gap-1">
                <Lock className="w-3 h-3" /> Kunci E2EE Otomatis
              </span>
            </div>

            <div className="max-h-52 overflow-y-auto rounded-xl border border-white/8 bg-[#182229] divide-y divide-white/5">
              {availablePeers.map((peer) => {
                const selected = selectedIds.includes(peer.id);
                return (
                  <button
                    key={peer.id}
                    type="button"
                    onClick={() => toggleMember(peer.id)}
                    className="w-full px-3 py-2.5 flex items-center justify-between gap-3 hover:bg-white/5 text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={peer.name} src={peer.avatar} online={peer.online} size="sm" />
                      <div className="min-w-0">
                        <p className="text-sm text-[#E9EDEF] truncate">{peer.name}</p>
                        <p className="text-[11px] text-[#8696A0] truncate">
                          {peer.role} · {peer.localIp}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        selected
                          ? 'bg-[#00A884] border-[#00A884] text-[#0B141A]'
                          : 'border-white/20 bg-transparent'
                      }`}
                    >
                      {selected && <Check className="w-3.5 h-3.5 stroke-[2.5]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-[#AEBAC1] hover:text-white hover:bg-white/5 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="px-4 py-2 rounded-lg bg-[#00A884] hover:bg-[#029676] disabled:opacity-50 text-[#0B141A] text-sm font-semibold transition-colors"
            >
              Buat Grup Terenkripsi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
