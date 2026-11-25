import { useEffect, useState } from 'react';
import { Check, Download, Laptop, Monitor, Share, Smartphone, Terminal, X } from 'lucide-react';
import type { ClientPlatform } from '../hooks/usePWAInstall';

interface InstallAppModalProps {
  open: boolean;
  isInstallable: boolean;
  isInstalled: boolean;
  detectedPlatform: ClientPlatform;
  onInstallNative: () => Promise<boolean>;
  onClose: () => void;
}

type GuideTab = 'ios' | 'android' | 'windows' | 'linux';

function toGuideTab(p: ClientPlatform): GuideTab {
  if (p === 'ios' || p === 'android' || p === 'windows' || p === 'linux') return p;
  return 'windows';
}

export function InstallAppModal({
  open,
  isInstallable,
  isInstalled,
  detectedPlatform,
  onInstallNative,
  onClose,
}: InstallAppModalProps) {
  const [activeTab, setActiveTab] = useState<GuideTab>(() => toGuideTab(detectedPlatform));
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (open) {
      setActiveTab(toGuideTab(detectedPlatform));
    }
  }, [open, detectedPlatform]);

  if (!open) return null;

  async function handleOneClickInstall() {
    setInstalling(true);
    try {
      const accepted = await onInstallNative();
      if (accepted) onClose();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Download className="w-5 h-5 text-[#00A884]" />
            <h3 className="font-display font-semibold text-base text-[#E9EDEF]">
              Pasang Aplikasi KiremData
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

        <div className="p-5 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* App summary + One-click native prompt when supported */}
          <div className="p-4 rounded-xl bg-[#182229] border border-white/8 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0">
              <img
                src="/pwa-192x192.png"
                alt="Ikon KiremData"
                className="w-12 h-12 rounded-xl border border-white/10 shrink-0"
              />
              <div className="min-w-0">
                <h4 className="font-display font-semibold text-sm text-[#E9EDEF]">
                  KiremData (PWA Mandiri)
                </h4>
                <p className="text-xs text-[#8696A0] mt-0.5 leading-snug">
                  Berjalan di jendela terpisah tanpa bilah browser, siap pakai offline di jaringan lokal.
                </p>
              </div>
            </div>

            {isInstalled ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#00A884] shrink-0">
                <Check className="w-4 h-4" />
                <span>Terpasang</span>
              </span>
            ) : isInstallable ? (
              <button
                type="button"
                disabled={installing}
                onClick={handleOneClickInstall}
                className="px-4 py-2 rounded-lg bg-[#00A884] hover:bg-[#029676] disabled:opacity-60 text-[#0B141A] text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
              >
                {installing ? 'Memasang...' : 'Pasang Sekarang'}
              </button>
            ) : null}
          </div>

          {/* Platform tabs: iOS, Android, Windows, Linux */}
          <div>
            <p className="text-xs font-semibold text-[#AEBAC1] mb-2">
              Panduan Pemasangan per Sistem Operasi
            </p>
            <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-[#202C33] border border-white/5">
              {(
                [
                  { id: 'ios', label: 'iOS', icon: Smartphone },
                  { id: 'android', label: 'Android', icon: Smartphone },
                  { id: 'windows', label: 'Windows', icon: Monitor },
                  { id: 'linux', label: 'Linux', icon: Terminal },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`py-2 px-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#00A884]/20 text-[#00A884]'
                        : 'text-[#8696A0] hover:text-[#E9EDEF]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Platform-specific instructions */}
          <div className="p-4 rounded-xl bg-[#0B141A] border border-white/8 space-y-3 text-xs text-[#E9EDEF] leading-relaxed">
            {activeTab === 'ios' && (
              <>
                <p className="font-display font-semibold text-sm text-[#00A884]">
                  Pemasangan di iPhone & iPad (iOS Safari)
                </p>
                <ol className="list-decimal list-inside space-y-2 text-[#AEBAC1]">
                  <li>
                    Buka KiremData menggunakan browser <strong className="text-[#E9EDEF]">Safari</strong> di iPhone atau iPad.
                  </li>
                  <li>
                    Ketuk tombol <strong className="text-[#E9EDEF] inline-flex items-center gap-1"><Share className="w-3.5 h-3.5 text-[#00A884]" /> Bagikan (Share)</strong> pada bilah navigasi Safari.
                  </li>
                  <li>
                    Gulir ke bawah lalu pilih <strong className="text-[#E9EDEF]">Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
                  </li>
                  <li>
                    Ketuk <strong className="text-[#E9EDEF]">Tambah</strong>. Ikon KiremData akan muncul di layar utama dan berjalan penuh tanpa bilah Safari.
                  </li>
                </ol>
              </>
            )}

            {activeTab === 'android' && (
              <>
                <p className="font-display font-semibold text-sm text-[#00A884]">
                  Pemasangan di Android (Chrome / Edge / Brave)
                </p>
                <ol className="list-decimal list-inside space-y-2 text-[#AEBAC1]">
                  <li>
                    Jika tombol <strong className="text-[#E9EDEF]">Pasang Sekarang</strong> muncul di atas, cukup ketuk untuk menginstal langsung ke layar utama.
                  </li>
                  <li>
                    Atau ketuk menu <strong className="text-[#E9EDEF]">⋮ (Titik Tiga)</strong> di pojok kanan atas browser Chrome Android.
                  </li>
                  <li>
                    Pilih <strong className="text-[#E9EDEF]">Instal aplikasi</strong> atau <strong className="text-[#E9EDEF]">Tambahkan ke layar utama</strong>.
                  </li>
                  <li>
                    Aplikasi akan terdaftar di App Drawer Android dengan ikon adaptif maskable dan notifikasi lokal.
                  </li>
                </ol>
              </>
            )}

            {activeTab === 'windows' && (
              <>
                <p className="font-display font-semibold text-sm text-[#00A884]">
                  Pemasangan di Windows 10 / 11 (Chrome / Microsoft Edge)
                </p>
                <ol className="list-decimal list-inside space-y-2 text-[#AEBAC1]">
                  <li>
                    Klik tombol <strong className="text-[#E9EDEF]">Pasang Sekarang</strong> di atas (jika tersedia), atau klik ikon <strong className="text-[#E9EDEF]">Instal (Monitor + Panah)</strong> di sisi kanan address bar Chrome/Edge.
                  </li>
                  <li>
                    Di Microsoft Edge: buka menu <strong className="text-[#E9EDEF]">⋯ → Aplikasi → Instal situs ini sebagai aplikasi</strong>.
                  </li>
                  <li>
                    KiremData dapat disematkan ke <strong className="text-[#E9EDEF]">Taskbar</strong> & <strong className="text-[#E9EDEF]">Start Menu</strong> seperti aplikasi desktop Windows asli.
                  </li>
                </ol>
              </>
            )}

            {activeTab === 'linux' && (
              <>
                <p className="font-display font-semibold text-sm text-[#00A884]">
                  Pemasangan di Linux (Ubuntu, Debian, Fedora, Arch)
                </p>
                <ol className="list-decimal list-inside space-y-2 text-[#AEBAC1]">
                  <li>
                    Buka KiremData menggunakan <strong className="text-[#E9EDEF]">Google Chrome</strong>, <strong className="text-[#E9EDEF]">Chromium</strong>, atau <strong className="text-[#E9EDEF]">Brave</strong>.
                  </li>
                  <li>
                    Klik tombol <strong className="text-[#E9EDEF]">Pasang Sekarang</strong> di atas atau buka menu browser → <strong className="text-[#E9EDEF]">Simpan & Bagikan → Instal KiremData...</strong>
                  </li>
                  <li>
                    File <code className="font-mono-tabular text-[#00A884]">.desktop</code> akan dibuat otomatis sehingga KiremData muncul di Application Launcher (GNOME / KDE) dan dapat berjalan mandiri dengan jendela aplikasi khusus.
                  </li>
                </ol>
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-[11px] text-[#8696A0] flex items-center gap-1.5">
              <Laptop className="w-3.5 h-3.5 text-[#00A884]" />
              <span>Didukung Service Worker offline-ready</span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#202C33] hover:bg-white/10 text-xs font-medium text-[#E9EDEF] transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
