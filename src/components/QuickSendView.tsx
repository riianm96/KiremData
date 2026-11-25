import { useMemo, useRef } from 'react';
import {
  CheckCircle2,
  File as FileIcon,
  FilePlus2,
  FolderUp,
  Lock,
  MessageSquare,
  Radio,
  Send,
  Trash2,
  Upload,
  Wifi,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import type {
  LanPeer,
  QueuedSendFile,
  TransferBatchSession,
  TransferTransport,
} from '../types/chat';
import type { P2PRouteType } from '../services/webrtc';
import { formatBytes, formatDuration, formatSpeed } from '../utils/format';
import { Avatar } from './Avatar';

interface QuickSendViewProps {
  currentUser: LanPeer | null;
  peers: LanPeer[];
  isOnline: boolean;
  p2pConnectedMap: Record<string, boolean>;
  p2pRouteMap: Record<string, { lanesOpen: number; routeType: P2PRouteType }>;
  queuedFiles: QueuedSendFile[];
  encryptFiles: boolean;
  preferredTransport: TransferTransport;
  activeSendSession: TransferBatchSession | null;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveQueuedFile: (queueId: string) => void;
  onClearQueue: () => void;
  onToggleEncryptFiles: (encrypted: boolean) => void;
  onChangePreferredTransport: (transport: TransferTransport) => void;
  onSendToPeer: (peer: LanPeer) => void;
  onCancelSession: (sessionId: string) => void;
  onClearCompletedSession: () => void;
  onOpenChatWithPeer: (peer: LanPeer) => void;
  onConnectP2P: (peerId: string) => void;
}

export function QuickSendView({
  currentUser,
  peers,
  isOnline,
  p2pConnectedMap,
  p2pRouteMap,
  queuedFiles,
  encryptFiles,
  preferredTransport,
  activeSendSession,
  onAddFiles,
  onRemoveQueuedFile,
  onClearQueue,
  onToggleEncryptFiles,
  onChangePreferredTransport,
  onSendToPeer,
  onCancelSession,
  onClearCompletedSession,
  onOpenChatWithPeer,
  onConnectP2P,
}: QuickSendViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const totalQueueBytes = useMemo(
    () => queuedFiles.reduce((sum, item) => sum + item.file.size, 0),
    [queuedFiles],
  );

  const otherPeers = useMemo(() => {
    return peers
      .filter((p) => p.id !== currentUser?.id)
      .sort((a, b) => {
        const aScore = (a.isLiveSession && a.online ? 4 : 0) + (a.online ? 2 : 0);
        const bScore = (b.isLiveSession && b.online ? 4 : 0) + (b.online ? 2 : 0);
        return bScore - aScore || a.name.localeCompare(b.name);
      });
  }, [peers, currentUser?.id]);

  const sessionStats = useMemo(() => {
    if (!activeSendSession) return null;
    const totalBytes = activeSendSession.files.reduce((sum, f) => sum + f.size, 0);
    const transferredBytes = activeSendSession.files.reduce(
      (sum, f) => sum + Math.min(f.size, f.transferredBytes),
      0,
    );
    const activeSpeed = activeSendSession.files.reduce(
      (sum, f) => (f.status === 'transferring' ? sum + f.speedBytesPerSec : sum),
      0,
    );
    const elapsedSec = Math.max(
      0.05,
      ((activeSendSession.completedAt ?? Date.now()) - activeSendSession.startedAt) / 1000,
    );
    const displaySpeed =
      activeSendSession.status === 'completed'
        ? totalBytes / elapsedSec
        : activeSpeed > 0
          ? activeSpeed
          : transferredBytes / elapsedSec;
    const remainingBytes = Math.max(0, totalBytes - transferredBytes);
    const etaSec = displaySpeed > 0 ? remainingBytes / displaySpeed : 0;
    const pct = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 100;

    return { totalBytes, transferredBytes, displaySpeed, etaSec, pct };
  }, [activeSendSession]);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0B141A] p-4 sm:p-6 pb-24 md:pb-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header section */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-[#E9EDEF] text-balance">
              Kirim File Cepat
            </h1>
            <p className="text-xs sm:text-sm text-[#8696A0] mt-1">
              Pilih file atau media, lalu ketuk perangkat tujuan untuk kirim langsung di browser.
            </p>
          </div>
          {currentUser && (
            <div className="flex items-center gap-2 text-xs text-[#AEBAC1] font-mono-tabular shrink-0">
              <span>Perangkat ini:</span>
              <span className="text-[#E9EDEF] font-medium">{currentUser.name}</span>
              <span aria-hidden="true">·</span>
              <span className={isOnline ? 'text-[#00A884]' : 'text-amber-300'}>
                {isOnline ? currentUser.localIp : 'Mode Offline'}
              </span>
            </div>
          )}
        </div>

        {/* Active Transfer Batch Panel */}
        {activeSendSession && sessionStats && (
          <section className="rounded-xl bg-[#111B21] border border-white/10 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {activeSendSession.status === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#00A884] shrink-0" />
                  ) : activeSendSession.status === 'rejected' ||
                    activeSendSession.status === 'cancelled' ||
                    activeSendSession.status === 'error' ? (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  ) : (
                    <Send className="w-4 h-4 text-[#00A884] shrink-0" />
                  )}
                  <h2 className="font-display font-semibold text-sm sm:text-base text-[#E9EDEF] truncate">
                    {activeSendSession.status === 'waiting_acceptance'
                      ? `Menunggu persetujuan ${activeSendSession.peerName}...`
                      : activeSendSession.status === 'transferring'
                        ? `Mengirim ke ${activeSendSession.peerName}`
                        : activeSendSession.status === 'completed'
                          ? `Selesai dikirim ke ${activeSendSession.peerName}`
                          : activeSendSession.status === 'rejected'
                            ? `Ditolak oleh ${activeSendSession.peerName}`
                            : activeSendSession.status === 'cancelled'
                              ? 'Transfer dibatalkan'
                              : `Gagal mengirim ke ${activeSendSession.peerName}`}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#AEBAC1] font-mono-tabular mt-1">
                  <span>
                    {formatBytes(sessionStats.transferredBytes)} / {formatBytes(sessionStats.totalBytes)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {activeSendSession.transport === 'wifi-direct'
                      ? `Wi-Fi Direct (${p2pRouteMap[activeSendSession.peerId]?.lanesOpen || 1}/6 Soket${p2pRouteMap[activeSendSession.peerId]?.routeType === 'lan-direct' ? ' · LAN Langsung' : ''})`
                      : 'HTTP Stream'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={activeSendSession.encryptFiles ? 'text-[#00A884]' : 'text-amber-300'}>
                    {activeSendSession.encryptFiles ? 'E2EE File' : 'Mode Super'}
                  </span>
                  {sessionStats.displaySpeed > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-[#00A884] font-semibold">
                        {formatSpeed(sessionStats.displaySpeed)}
                      </span>
                    </>
                  )}
                  {activeSendSession.status === 'transferring' && sessionStats.etaSec > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Sisa ~{formatDuration(sessionStats.etaSec)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(activeSendSession.status === 'waiting_acceptance' ||
                  activeSendSession.status === 'transferring' ||
                  activeSendSession.status === 'preparing') && (
                  <button
                    type="button"
                    onClick={() => onCancelSession(activeSendSession.sessionId)}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                  >
                    Batalkan
                  </button>
                )}
                {(activeSendSession.status === 'completed' ||
                  activeSendSession.status === 'rejected' ||
                  activeSendSession.status === 'cancelled' ||
                  activeSendSession.status === 'error') && (
                  <button
                    type="button"
                    onClick={onClearCompletedSession}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-white/8 hover:bg-white/12 text-[#E9EDEF] text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
                  >
                    Tutup Ringkasan
                  </button>
                )}
              </div>
            </div>

            {/* Aggregate progress bar */}
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-150 ${
                    activeSendSession.status === 'rejected' ||
                    activeSendSession.status === 'cancelled' ||
                    activeSendSession.status === 'error'
                      ? 'bg-rose-500'
                      : 'bg-[#00A884]'
                  }`}
                  style={{ width: `${sessionStats.pct}%` }}
                />
              </div>
            </div>

            {activeSendSession.errorMessage && (
              <p className="text-xs text-rose-300">{activeSendSession.errorMessage}</p>
            )}

            {/* Per-file transfer rows */}
            <div className="divide-y divide-white/8 max-h-56 overflow-y-auto">
              {activeSendSession.files.map((item) => {
                const filePct =
                  item.size > 0
                    ? Math.min(100, Math.round((item.transferredBytes / item.size) * 100))
                    : 100;
                return (
                  <div key={item.fileId} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium text-[#E9EDEF] truncate">{item.name}</span>
                        <span className="font-mono-tabular text-[#AEBAC1] shrink-0">
                          {item.speedBytesPerSec > 0 ? `${formatSpeed(item.speedBytesPerSec)} · ` : ''}
                          {filePct}%
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-white/8 overflow-hidden mt-1.5">
                        <div
                          className="h-full bg-[#00A884] transition-all duration-100"
                          style={{ width: `${filePct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Main 2-column workspace: File Selection & Queue (left) + Nearby Devices (right) */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-5 items-start">
          {/* Left Column: File Selection & Speed Controls */}
          <section className="rounded-xl bg-[#111B21] border border-white/10 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-base text-[#E9EDEF]">
                1. Pilih File atau Folder
              </h2>
              {queuedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="text-xs text-[#AEBAC1] hover:text-rose-300 flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Kosongkan</span>
                </button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  onAddFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is supported in modern browsers
              webkitdirectory=""
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  onAddFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />

            {/* Dropzone + Pickers */}
            <div className="rounded-xl border border-dashed border-white/15 bg-[#182229]/60 p-5 text-center space-y-3">
              <div className="w-11 h-11 rounded-xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mx-auto">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#E9EDEF]">
                  Seret dan lepaskan file ke layar ini
                </p>
                <p className="text-xs text-[#8696A0] mt-0.5">
                  Mendukung file besar hingga 4 GB atau kirim banyak file sekaligus
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                >
                  <FilePlus2 className="w-4 h-4" />
                  <span>Pilih File</span>
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] text-[#E9EDEF] border border-white/10 text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                >
                  <FolderUp className="w-4 h-4 text-[#00A884]" />
                  <span>Pilih Folder</span>
                </button>
              </div>
            </div>

            {/* Queued files list */}
            {queuedFiles.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#AEBAC1] font-mono-tabular">
                  <span>{queuedFiles.length} file siap dikirim</span>
                  <span>Total {formatBytes(totalQueueBytes)}</span>
                </div>
                <div className="divide-y divide-white/8 max-h-60 overflow-y-auto rounded-lg bg-[#182229]/60 border border-white/8 px-3">
                  {queuedFiles.map((item) => (
                    <div key={item.queueId} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileIcon className="w-4 h-4 text-[#00A884] shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-[#E9EDEF] truncate">
                            {item.relativePath || item.file.name}
                          </p>
                          <p className="text-[11px] text-[#8696A0] font-mono-tabular">
                            {formatBytes(item.file.size)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveQueuedFile(item.queueId)}
                        aria-label={`Hapus ${item.file.name}`}
                        className="w-8 h-8 rounded-md flex items-center justify-center text-[#8696A0] hover:text-rose-300 hover:bg-white/5 shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Encryption & Transport controls */}
            <div className="pt-2 border-t border-white/8 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-[#E9EDEF] mb-1.5">Kecepatan & Enkripsi</p>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#182229] border border-white/8">
                  <button
                    type="button"
                    onClick={() => onToggleEncryptFiles(false)}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                      !encryptFiles
                        ? 'bg-amber-400 text-[#0B141A]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Mode Super</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleEncryptFiles(true)}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                      encryptFiles
                        ? 'bg-[#00A884] text-[#0B141A]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>E2EE File</span>
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-[#E9EDEF] mb-1.5">Jalur Prioritas</p>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#182229] border border-white/8">
                  <button
                    type="button"
                    onClick={() => onChangePreferredTransport('wifi-direct')}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                      preferredTransport === 'wifi-direct'
                        ? 'bg-[#00A884] text-[#0B141A]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Wi-Fi Direct</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangePreferredTransport('lan-sync')}
                    className={`min-h-[38px] px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                      preferredTransport === 'lan-sync'
                        ? 'bg-[#00A884] text-[#0B141A]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>HTTP Stream</span>
                  </button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-[#8696A0] leading-relaxed">
              {!encryptFiles
                ? preferredTransport === 'wifi-direct'
                  ? 'Mode Super aktif: stream P2P paralel 6 soket (128 KB/frame) langsung antar browser hingga ~12 MB/s.'
                  : 'HTTP Stream aktif: stream biner beruntun lewat server hub sebagai jalur cadangan.'
                : 'Enkripsi E2EE File aktif: tiap blok dilindungi AES-GCM-256 dan verifikasi SHA-256.'}
            </p>
          </section>

          {/* Right Column: Nearby Devices */}
          <section className="rounded-xl bg-[#111B21] border border-white/10 p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-base text-[#E9EDEF]">
                2. Pilih Perangkat Tujuan
              </h2>
              <span className="text-xs text-[#AEBAC1] font-mono-tabular">
                {!isOnline
                  ? 'Offline · menunggu Wi-Fi'
                  : `${otherPeers.filter((p) => p.online && p.isLiveSession).length} aktif langsung`}
              </span>
            </div>

            {!isOnline && (
              <p className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/25 rounded-lg px-3 py-2">
                Browser sedang offline. Antrean file tetap tersimpan—sambungkan ke Wi-Fi untuk mulai mengirim.
              </p>
            )}

            {otherPeers.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-sm text-[#E9EDEF]">Belum ada perangkat lain terdeteksi</p>
                <p className="text-xs text-[#8696A0]">
                  Buka KiremData di perangkat lain pada jaringan Wi-Fi atau URL yang sama.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {otherPeers.map((peer) => {
                  const isLiveOnline = !!peer.isLiveSession && peer.online;
                  const p2pReady = !!p2pConnectedMap[peer.id];
                  const routeInfo = p2pRouteMap[peer.id];
                  const lanesLabel =
                    routeInfo && routeInfo.lanesOpen > 0
                      ? routeInfo.routeType === 'lan-direct'
                        ? `P2P LAN · ${routeInfo.lanesOpen}/6 Soket`
                        : `P2P · ${routeInfo.lanesOpen}/6 Soket`
                      : 'P2P Siap';

                  return (
                    <div
                      key={peer.id}
                      className="rounded-xl bg-[#182229] border border-white/8 p-3.5 flex items-center justify-between gap-3 hover:border-[#00A884]/40 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          src={peer.avatar}
                          name={peer.name}
                          size="md"
                          online={peer.online}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-semibold text-[#E9EDEF] truncate">
                              {peer.name}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#8696A0] font-mono-tabular mt-0.5">
                            <span className="truncate">{peer.deviceName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{peer.localIp}</span>
                            <span aria-hidden="true">·</span>
                            <span className={p2pReady ? 'text-[#00A884]' : ''}>
                              {isLiveOnline
                                ? p2pReady
                                  ? lanesLabel
                                  : 'Stream LAN Siap'
                                : peer.online
                                  ? 'Hub Kantor'
                                  : 'Offline'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {isLiveOnline && !p2pReady && (
                          <button
                            type="button"
                            onClick={() => onConnectP2P(peer.id)}
                            title="Hubungkan jalur langsung Wi-Fi Direct P2P"
                            className="min-h-[40px] w-10 rounded-lg bg-white/5 hover:bg-white/10 text-[#AEBAC1] hover:text-[#00A884] flex items-center justify-center transition-colors shrink-0"
                          >
                            <Wifi className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenChatWithPeer(peer)}
                          title={`Buka pesan dengan ${peer.name}`}
                          className="min-h-[40px] w-10 rounded-lg bg-white/5 hover:bg-white/10 text-[#AEBAC1] hover:text-[#E9EDEF] flex items-center justify-center transition-colors shrink-0"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          disabled={!peer.online}
                          onClick={() => {
                            if (queuedFiles.length === 0) {
                              fileInputRef.current?.click();
                              return;
                            }
                            onSendToPeer(peer);
                          }}
                          className={`min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                            peer.online
                              ? 'bg-[#00A884] hover:bg-[#029676] text-[#0B141A]'
                              : 'bg-white/5 text-[#8696A0] cursor-not-allowed'
                          }`}
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{queuedFiles.length > 0 ? 'Kirim' : 'Pilih'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
