import { useEffect, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  Copy,
  Laptop,
  Network,
  Phone,
  Radio,
  Store,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { LanPeer, NetworkStatusInfo, NotificationMode } from '../types/chat';

export interface ProfileUpdateInput {
  name: string;
  phone?: string;
  shopNote?: string;
}

interface LanNetworkModalProps {
  open: boolean;
  currentUser: LanPeer | null;
  peers: LanPeer[];
  p2pConnectedMap: Record<string, boolean>;
  notificationMode: NotificationMode;
  onChangeNotificationMode: (mode: NotificationMode) => void;
  onTestNotification: () => Promise<{ desktopSent: boolean; message: string }>;
  onUpdateProfile: (profile: ProfileUpdateInput) => void;
  onConnectP2P: (peerId: string) => void;
  onRequestClearAllChats: () => void;
  onClose: () => void;
}

export function LanNetworkModal({
  open,
  currentUser,
  peers,
  p2pConnectedMap,
  notificationMode,
  onChangeNotificationMode,
  onTestNotification,
  onUpdateProfile,
  onConnectP2P,
  onRequestClearAllChats,
  onClose,
}: LanNetworkModalProps) {
  const [netInfo, setNetInfo] = useState<NetworkStatusInfo | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(currentUser?.name ?? '');
  const [phone, setPhone] = useState(currentUser?.phone ?? '');
  const [shopNote, setShopNote] = useState(currentUser?.shopNote ?? '');
  const [nameSaved, setNameSaved] = useState(false);
  const [notifPerm, setNotifPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDisplayName(currentUser?.name ?? '');
    setPhone(currentUser?.phone ?? '');
    setShopNote(currentUser?.shopNote ?? '');
    setNameSaved(false);
    setTestFeedback(null);
    setNotifPerm(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
    fetch('/api/network-info')
      .then((r) => r.json())
      .then((data: NetworkStatusInfo) => setNetInfo(data))
      .catch(() => {});
  }, [open, currentUser?.name, currentUser?.phone, currentUser?.shopNote]);

  if (!open) return null;

  const livePeers = peers.filter((p) => p.isLiveSession && p.id !== currentUser?.id);

  function copyLink(url: string) {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  }

  async function requestDesktopNotification() {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  }

  async function handleRunTestNotification() {
    const res = await onTestNotification();
    if (typeof Notification !== 'undefined') {
      setNotifPerm(Notification.permission);
    }
    setTestFeedback(res.message);
    setTimeout(() => setTestFeedback(null), 4500);
  }

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (displayName.trim()) {
      onUpdateProfile({
        name: displayName.trim(),
        phone: phone.trim(),
        shopNote: shopNote.trim(),
      });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2500);
    }
  }

  const currentOriginUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Radio className="w-5 h-5 text-[#00A884]" />
            <h3 className="font-display font-semibold text-base text-[#E9EDEF]">
              Jaringan Lokal & Profil Perangkat
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

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto">
          {/* Local Identity Profile */}
          <form onSubmit={handleSaveProfile} className="space-y-3 p-3.5 rounded-xl bg-[#182229] border border-white/8">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-[#E9EDEF]">
                Identitas & Info Kontak Anda (Tersimpan Permanen)
              </label>
              {nameSaved && (
                <span className="text-[11px] font-medium text-[#00A884] inline-flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Tersimpan
                </span>
              )}
            </div>

            <div className="space-y-2.5">
              <div>
                <label className="block text-[11px] text-[#8696A0] mb-1">Nama Tampilan</label>
                <input
                  type="text"
                  maxLength={64}
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setNameSaved(false);
                  }}
                  placeholder="Contoh: Rian"
                  className="w-full h-10 px-3.5 rounded-lg bg-[#202C33] border border-white/10 text-sm text-[#E9EDEF] placeholder-[#8696A0]/70 focus:outline-none focus:border-[#00A884]"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-[11px] text-[#8696A0] mb-1">
                  <Phone className="w-3 h-3 text-[#00A884]" />
                  <span>Nomor HP / WhatsApp (Opsional)</span>
                </label>
                <input
                  type="tel"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setNameSaved(false);
                  }}
                  placeholder="Contoh: 0812-3456-7890"
                  className="w-full h-10 px-3.5 rounded-lg bg-[#202C33] border border-white/10 text-sm font-mono-tabular text-[#E9EDEF] placeholder-[#8696A0]/70 focus:outline-none focus:border-[#00A884]"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-[#8696A0]">
                    <Store className="w-3 h-3 text-[#00A884]" />
                    <span>Catatan Toko / Info Bisnis (Opsional)</span>
                  </label>
                  <span className="text-[10px] font-mono-tabular text-[#8696A0]">
                    {shopNote.length}/160
                  </span>
                </div>
                <textarea
                  rows={2}
                  maxLength={160}
                  value={shopNote}
                  onChange={(e) => {
                    setShopNote(e.target.value);
                    setNameSaved(false);
                  }}
                  placeholder="Contoh: COD iPhone Aceh · Terima jual beli & tukar tambah iPhone bergaransi"
                  className="w-full px-3.5 py-2 rounded-lg bg-[#202C33] border border-white/10 text-sm text-[#E9EDEF] placeholder-[#8696A0]/70 focus:outline-none focus:border-[#00A884] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-[#8696A0] leading-snug">
                Info ini terlihat oleh pengguna lain di panel Info Kontak & tetap tersimpan meski Wi-Fi terputus.
              </p>
              <button
                type="submit"
                className="h-9 px-4 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                {nameSaved ? 'Tersimpan' : 'Simpan Profil'}
              </button>
            </div>
          </form>

          {/* Local LAN Addresses */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#AEBAC1] flex items-center gap-1.5">
                <Network className="w-4 h-4 text-[#00A884]" />
                Alamat LAN Hub Lokal (Tanpa Internet)
              </span>
              {netInfo && (
                <span className="text-[11px] font-mono-tabular text-[#8696A0]">
                  Host: {netInfo.hostname}
                </span>
              )}
            </div>

            <div className="rounded-xl bg-[#182229] border border-white/8 divide-y divide-white/5">
              <div className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#E9EDEF]">Tautan Sesi Saat Ini</p>
                  <p className="text-xs font-mono-tabular text-[#8696A0] truncate">{currentOriginUrl}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyLink(currentOriginUrl)}
                  className="px-2.5 py-1.5 rounded-md bg-white/8 hover:bg-white/12 text-xs text-[#E9EDEF] flex items-center gap-1 shrink-0"
                >
                  {copiedUrl === currentOriginUrl ? (
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
              </div>

              {netInfo?.interfaces.map((iface, idx) => {
                const url = `http://${iface.address}:${netInfo.port}`;
                return (
                  <div
                    key={`${iface.name}-${idx}`}
                    className="px-3.5 py-2.5 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[#E9EDEF]">
                        Antarmuka {iface.name}
                      </p>
                      <p className="text-xs font-mono-tabular text-[#8696A0] truncate">{url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyLink(url)}
                      className="px-2.5 py-1.5 rounded-md bg-white/8 hover:bg-white/12 text-xs text-[#E9EDEF] flex items-center gap-1 shrink-0"
                    >
                      {copiedUrl === url ? (
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
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-[#8696A0] leading-relaxed">
              Buka tautan di atas pada tab browser lain atau perangkat lain di jaringan Wi-Fi / LAN yang sama untuk chat terenkripsi real-time & transfer P2P Wi-Fi Direct.
            </p>
          </div>

          {/* Live Peer Devices */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#AEBAC1] flex items-center gap-1.5">
              <Laptop className="w-4 h-4 text-[#00A884]" />
              Perangkat Aktif Terhubung ({livePeers.length})
            </p>

            {livePeers.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#182229] border border-white/8 text-xs text-[#8696A0] text-center">
                Belum ada perangkat browser lain yang tersambung saat ini. Salin tautan di atas dan buka di tab atau perangkat lain pada jaringan lokal Anda.
              </div>
            ) : (
              <div className="rounded-xl bg-[#182229] border border-white/8 divide-y divide-white/5">
                {livePeers.map((peer) => {
                  const p2p = !!p2pConnectedMap[peer.id];
                  return (
                    <div
                      key={peer.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#E9EDEF] truncate">{peer.name}</p>
                        <p className="text-xs font-mono-tabular text-[#8696A0] truncate">
                          {peer.localIp} · {peer.fingerprint}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onConnectP2P(peer.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 border transition-colors ${
                          p2p
                            ? 'bg-[#00A884]/15 text-[#00A884] border-[#00A884]/35'
                            : 'bg-[#202C33] text-[#E9EDEF] border-white/10 hover:border-[#00A884]'
                        }`}
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        <span>{p2p ? 'Wi-Fi Direct Aktif' : 'Pasangkan P2P'}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Desktop Notification Behavior & Test Settings */}
          <div className="p-3.5 rounded-xl bg-[#182229] border border-white/8 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                {notificationMode === 'muted' ? (
                  <BellOff className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <Bell className="w-4 h-4 text-[#00A884] shrink-0" />
                )}
                <div>
                  <p className="text-xs font-medium text-[#E9EDEF]">Notifikasi Desktop Real-Time</p>
                  <p className="text-[11px] text-[#8696A0]">
                    Status izin:{' '}
                    {notifPerm === 'granted'
                      ? 'Diizinkan'
                      : notifPerm === 'denied'
                        ? 'Ditolak'
                        : notifPerm === 'unsupported'
                          ? 'Tidak didukung browser'
                          : 'Belum diatur'}
                  </p>
                </div>
              </div>

              {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
                <button
                  type="button"
                  onClick={requestDesktopNotification}
                  className="px-3 py-1.5 rounded-lg bg-[#202C33] hover:bg-white/10 text-xs font-medium text-[#E9EDEF] border border-white/10 shrink-0"
                >
                  Aktifkan
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#111B21] border border-white/6">
              {(
                [
                  { id: 'all', label: 'Semua Pesan' },
                  { id: 'mentions', label: 'Hanya Sebutan' },
                  { id: 'muted', label: 'Bisukan' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeNotificationMode(opt.id)}
                  className={`py-1.5 px-2 rounded-md text-[11.5px] font-medium transition-colors whitespace-nowrap truncate ${
                    notificationMode === opt.id
                      ? opt.id === 'muted'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-[#00A884]/20 text-[#00A884]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3 pt-0.5">
              <p className="text-[11px] text-[#8696A0] leading-snug">
                {notificationMode === 'all'
                  ? 'Notifikasi desktop & suara berbunyi untuk setiap pesan masuk.'
                  : notificationMode === 'mentions'
                    ? 'Hanya berbunyi saat nama Anda disebut (@Nama / @semua) atau pesan dibalas.'
                    : 'Seluruh notifikasi desktop dan suara pesan masuk dinonaktifkan.'}
              </p>

              <button
                type="button"
                onClick={handleRunTestNotification}
                className="px-3 py-1.5 rounded-lg bg-[#202C33] hover:bg-white/10 text-xs font-medium text-[#E9EDEF] border border-white/10 flex items-center gap-1.5 shrink-0 transition-colors"
              >
                <BellRing className="w-3.5 h-3.5 text-[#00A884]" />
                <span>Uji Notifikasi</span>
              </button>
            </div>

            {testFeedback && (
              <p className="text-[11px] text-[#00A884] bg-[#00A884]/10 border border-[#00A884]/25 rounded-lg px-3 py-2 leading-snug">
                {testFeedback}
              </p>
            )}
          </div>

          {/* Clear All Chat History */}
          <div className="p-3.5 rounded-xl bg-rose-500/8 border border-rose-500/20 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-[#E9EDEF]">Bersihkan Semua Riwayat Chat</p>
              <p className="text-[11px] text-[#8696A0]">
                Hapus seluruh riwayat pesan di perangkat ini secara permanen.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onClose();
                onRequestClearAllChats();
              }}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Hapus Semua</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
