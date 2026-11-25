import { Clock, RefreshCw, WifiOff } from 'lucide-react';
import { usePWAStatus } from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const {
    isOnline,
    swOfflineReady,
    swUpdateAvailable,
    pendingOutboxCount,
    applySwUpdate,
  } = usePWAStatus();

  if (!isOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 max-w-md rounded-xl bg-[#202C33] border border-amber-400/35 px-3.5 py-2.5 shadow-xl flex items-center gap-2.5 text-xs text-[#E9EDEF]"
      >
        <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
        <span className="leading-snug">
          <strong className="font-semibold text-amber-300">Mode Offline</strong>
          <span aria-hidden="true"> · </span>
          {pendingOutboxCount > 0
            ? `${pendingOutboxCount} pesan di antrean BackgroundSync (otomatis terkirim saat online).`
            : swOfflineReady
              ? 'Cache PWA aktif, pesan baru akan otomatis masuk antrean kirim.'
              : 'Riwayat chat tersimpan di perangkat ini.'}
        </span>
      </div>
    );
  }

  if (pendingOutboxCount > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 max-w-md rounded-xl bg-[#202C33] border border-[#00A884]/40 px-3.5 py-2.5 shadow-xl flex items-center gap-2.5 text-xs text-[#E9EDEF]"
      >
        <Clock className="w-4 h-4 text-[#00A884] shrink-0" />
        <span className="leading-snug">
          Menyinkronkan {pendingOutboxCount} pesan dari antrean BackgroundSync...
        </span>
      </div>
    );
  }

  if (swUpdateAvailable) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 max-w-md rounded-xl bg-[#202C33] border border-[#00A884]/40 px-3.5 py-2.5 shadow-xl flex items-center justify-between gap-3 text-xs text-[#E9EDEF]"
      >
        <span className="leading-snug">Pembaruan KiremData PWA tersedia</span>
        <button
          type="button"
          onClick={() => void applySwUpdate()}
          className="min-h-[34px] px-3 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Perbarui</span>
        </button>
      </div>
    );
  }

  return null;
}
