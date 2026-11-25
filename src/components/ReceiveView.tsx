import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  FolderCheck,
  HardDriveDownload,
  KeyRound,
  MonitorDown,
  Radio,
  Settings2,
  Shield,
  ShieldCheck,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import type {
  FileTransferTask,
  LanPeer,
  NetworkStatusInfo,
  QuickSaveMode,
} from '../types/chat';
import { formatBytes, formatSpeed } from '../utils/format';

interface ReceiveViewProps {
  currentUser: LanPeer | null;
  wsConnected: boolean;
  isOnline: boolean;
  swOfflineReady: boolean;
  isInstalled: boolean;
  isInstallable: boolean;
  networkInfo: NetworkStatusInfo | null;
  quickSave: QuickSaveMode;
  receivePin: string;
  receivedTransfers: FileTransferTask[];
  onChangeQuickSave: (mode: QuickSaveMode) => void;
  onChangeReceivePin: (pin: string) => void;
  onOpenProfileModal: () => void;
  onInstallPWA: () => void;
  onSaveTaskToDisk: (task: FileTransferTask) => void;
  onPreviewTask: (task: FileTransferTask) => void;
}

export function ReceiveView({
  currentUser,
  wsConnected,
  isOnline,
  swOfflineReady,
  isInstalled,
  isInstallable,
  networkInfo,
  quickSave,
  receivePin,
  receivedTransfers,
  onChangeQuickSave,
  onChangeReceivePin,
  onOpenProfileModal,
  onInstallPWA,
  onSaveTaskToDisk,
  onPreviewTask,
}: ReceiveViewProps) {
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const lanAddresses =
    networkInfo?.interfaces
      .filter((i) => i.address !== '127.0.0.1' && !i.address.startsWith('169.254.'))
      .slice(0, 4) ?? [];

  const isCloudHost =
    typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('.run.app') ||
      window.location.hostname.endsWith('.ai.studio'));

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedText(text);
      setTimeout(() => setCopiedText((cur) => (cur === text ? null : cur)), 1800);
    } catch {
      // Ignore clipboard permission denials
    }
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0B141A] p-4 sm:p-6 pb-24 md:pb-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-[#E9EDEF] text-balance">
              Terima File & Status PWA
            </h1>
            <p className="text-xs sm:text-sm text-[#8696A0] mt-1">
              Atur Simpan Cepat, PIN keamanan, serta pantau status koneksi dan cache offline PWA.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenProfileModal}
            className="min-h-[40px] px-4 py-2 rounded-lg bg-[#202C33] hover:bg-[#2A3942] border border-white/10 text-xs font-medium text-[#E9EDEF] flex items-center gap-2 self-start sm:self-auto whitespace-nowrap shrink-0 transition-colors"
          >
            <Settings2 className="w-4 h-4 text-[#00A884]" />
            <span>Ubah Nama Perangkat</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Device Reception Status & PWA Offline Status */}
          <section className="rounded-xl bg-[#111B21] border border-white/10 p-5 space-y-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
                <Radio className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[#8696A0]">Identitas Perangkat Siap Terima</p>
                <h2 className="font-display font-bold text-lg text-[#E9EDEF] truncate">
                  {currentUser?.name || 'Memuat perangkat...'}
                </h2>
                <p className="text-xs text-[#AEBAC1] font-mono-tabular mt-0.5">
                  {currentUser?.localIp || '127.0.0.1'}
                  <span aria-hidden="true"> · </span>
                  {!isOnline
                    ? 'Mode Offline (Cache Lokal)'
                    : wsConnected
                      ? 'Hub Aktif'
                      : 'Menghubungkan ulang...'}
                </p>
              </div>
            </div>

            {/* Status Offline PWA & Instalasi */}
            <div className="pt-3 border-t border-white/8 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#E9EDEF]">Status Offline & PWA</p>
                {!isInstalled && (
                  <button
                    type="button"
                    onClick={onInstallPWA}
                    className="min-h-[34px] px-3 py-1 rounded-lg bg-[#00A884]/15 hover:bg-[#00A884]/25 text-[#00A884] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <MonitorDown className="w-3.5 h-3.5" />
                    <span>{isInstallable ? 'Pasang Aplikasi' : 'Panduan Pasang'}</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-[#182229] border border-white/8 px-3 py-2.5 flex items-center gap-2.5">
                  {isOnline ? (
                    <Wifi className="w-4 h-4 text-[#00A884] shrink-0" />
                  ) : (
                    <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Koneksi Jaringan</p>
                    <p className="font-medium text-[#E9EDEF] truncate">
                      {isOnline ? 'Online' : 'Offline · Mode Cache'}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg bg-[#182229] border border-white/8 px-3 py-2.5 flex items-center gap-2.5">
                  <HardDriveDownload
                    className={`w-4 h-4 shrink-0 ${
                      swOfflineReady ? 'text-[#00A884]' : 'text-[#8696A0]'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Cache Offline PWA</p>
                    <p className="font-medium text-[#E9EDEF] truncate">
                      {swOfflineReady ? 'Siap Offline' : 'Menyiapkan Cache...'}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg bg-[#182229] border border-white/8 px-3 py-2.5 flex items-center gap-2.5">
                  <Radio
                    className={`w-4 h-4 shrink-0 ${
                      wsConnected ? 'text-[#00A884]' : 'text-amber-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Sinkronisasi Chat & Sinyal</p>
                    <p className="font-medium text-[#E9EDEF] truncate">
                      {wsConnected ? 'Terhubung Real-Time' : 'Terputus · Riwayat Lokal'}
                    </p>
                  </div>
                </div>

                <div className="rounded-lg bg-[#182229] border border-white/8 px-3 py-2.5 flex items-center gap-2.5">
                  <ShieldCheck
                    className={`w-4 h-4 shrink-0 ${
                      isInstalled ? 'text-[#00A884]' : 'text-[#AEBAC1]'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#8696A0]">Mode Aplikasi</p>
                    <p className="font-medium text-[#E9EDEF] truncate">
                      {isInstalled ? 'Terpasang (Standalone)' : 'Browser Web'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {lanAddresses.length > 0 && !isCloudHost && !networkInfo?.isCloudContainer && (
              <div className="pt-3 border-t border-white/8 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[#00A884]">
                    Alamat Akses Jaringan Wi-Fi
                  </p>
                  <span className="text-[11px] text-[#8696A0]">Buka URL di HP/PC lain</span>
                </div>
                <div className="space-y-1.5">
                  {lanAddresses.map((iface) => {
                    const lanUrl = `http://${iface.address}:${networkInfo?.port ?? 3000}`;
                    const isCopied = copiedText === lanUrl;
                    return (
                      <div
                        key={`${iface.name}-${iface.address}`}
                        className="flex items-center justify-between gap-2 rounded-lg bg-[#182229] border border-white/8 px-3 py-2"
                      >
                        <span className="text-xs font-mono-tabular text-[#E9EDEF] truncate">
                          {iface.name}: {lanUrl}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopy(lanUrl)}
                          className="min-h-[30px] px-2.5 rounded-md bg-white/8 hover:bg-white/15 text-[11px] text-[#E9EDEF] flex items-center gap-1 shrink-0 whitespace-nowrap"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-[#00A884]" />
                              <span>Disalin</span>
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
                {networkInfo?.saveDir && (
                  <p className="text-[11px] text-[#AEBAC1] font-mono-tabular flex items-center gap-1.5">
                    <FolderCheck className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
                    <span className="truncate">Simpan otomatis: {networkInfo.saveDir}</span>
                  </p>
                )}
              </div>
            )}

            {/* Quick Save setting */}
            <div className="pt-3 border-t border-white/8 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#E9EDEF]">Simpan Cepat (Quick Save)</p>
                <span className="text-[11px] text-[#8696A0]">
                  {quickSave === 'off'
                    ? 'Selalu konfirmasi dulu'
                    : quickSave === 'contacts'
                      ? 'Otomatis untuk kontak tersimpan'
                      : 'Otomatis terima semua'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#182229] border border-white/8">
                <button
                  type="button"
                  onClick={() => onChangeQuickSave('off')}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    quickSave === 'off'
                      ? 'bg-[#00A884] text-[#0B141A]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  Mati
                </button>
                <button
                  type="button"
                  onClick={() => onChangeQuickSave('contacts')}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    quickSave === 'contacts'
                      ? 'bg-[#00A884] text-[#0B141A]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  Kontak
                </button>
                <button
                  type="button"
                  onClick={() => onChangeQuickSave('all')}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    quickSave === 'all'
                      ? 'bg-[#00A884] text-[#0B141A]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  Semua
                </button>
              </div>
            </div>

            {/* Optional PIN */}
            <div className="pt-3 border-t border-white/8 space-y-2">
              <label htmlFor="receive-pin-input" className="text-xs font-semibold text-[#E9EDEF] flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-[#00A884]" />
                <span>PIN Keamanan Opsional</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="receive-pin-input"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  value={receivePin}
                  onChange={(e) => onChangeReceivePin(e.target.value.replace(/\s/g, ''))}
                  placeholder="Kosongkan jika tanpa PIN (cth: 1234)"
                  className="flex-1 min-h-[42px] px-3 rounded-lg bg-[#182229] border border-white/10 text-xs font-mono-tabular text-[#E9EDEF] placeholder-[#8696A0] focus:outline-none focus:border-[#00A884]"
                />
                {receivePin && (
                  <button
                    type="button"
                    onClick={() => onChangeReceivePin('')}
                    className="min-h-[42px] px-3 rounded-lg bg-white/8 hover:bg-white/12 text-xs text-[#E9EDEF] whitespace-nowrap shrink-0"
                  >
                    Hapus PIN
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Recently Received Files */}
          <section className="rounded-xl bg-[#111B21] border border-white/10 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display font-semibold text-base text-[#E9EDEF]">
                File Diterima ({receivedTransfers.length})
              </h2>
              <span className="text-xs text-[#8696A0]">Siap disimpan ke disk</span>
            </div>

            {receivedTransfers.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <Shield className="w-8 h-8 text-[#8696A0]/60 mx-auto" />
                <p className="text-sm text-[#E9EDEF]">Belum ada file masuk di sesi ini</p>
                <p className="text-xs text-[#8696A0]">
                  Minta pengirim mengetuk nama perangkat Anda dari tab Kirim.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/8 max-h-[420px] overflow-y-auto">
                {receivedTransfers.map((task) => {
                  const pct =
                    task.fileSize > 0
                      ? Math.min(100, Math.round((task.transferredBytes / task.fileSize) * 100))
                      : 100;
                  return (
                    <div key={task.fileId} className="py-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#E9EDEF] truncate">
                            {task.fileName}
                          </p>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#AEBAC1] font-mono-tabular mt-0.5">
                            <span>{task.peerName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatBytes(task.fileSize)}</span>
                            {task.speedBytesPerSec > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[#00A884]">
                                  {formatSpeed(task.speedBytesPerSec)}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            {task.encrypted === false ? (
                              <span className="inline-flex items-center gap-1 text-amber-300">
                                <Zap className="w-3 h-3" />
                                <span>Mode Super</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[#00A884]">
                                <ShieldCheck className="w-3 h-3" />
                                <span>E2EE</span>
                              </span>
                            )}
                          </div>
                          {task.savedToDiskPath && (
                            <p className="text-[11px] text-[#00A884] font-mono-tabular truncate mt-0.5">
                              Tersimpan langsung: {task.savedToDiskPath}
                            </p>
                          )}
                        </div>

                        {task.status === 'completed' && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {(task.mimeType.startsWith('image/') ||
                              task.mimeType.startsWith('text/')) && (
                              <button
                                type="button"
                                onClick={() => onPreviewTask(task)}
                                aria-label={`Pratinjau ${task.fileName}`}
                                className="min-h-[38px] px-2.5 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-xs text-[#E9EDEF] flex items-center gap-1 whitespace-nowrap shrink-0"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Lihat</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onSaveTaskToDisk(task)}
                              className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold flex items-center gap-1 whitespace-nowrap shrink-0"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Simpan</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {task.status === 'transferring' && (
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#00A884] transition-all duration-100"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
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
