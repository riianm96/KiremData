import { useEffect, useMemo, useState } from 'react';
import { Check, File as FileIcon, KeyRound, Lock, Wifi, X, Zap } from 'lucide-react';
import type { IncomingPrepareOffer } from '../types/chat';
import { formatBytes } from '../utils/format';

interface IncomingTransferModalProps {
  offer: IncomingPrepareOffer | null;
  onAccept: (sessionId: string, selectedFileIds: string[], pinInput?: string) => void;
  onReject: (sessionId: string) => void;
}

export function IncomingTransferModal({
  offer,
  onAccept,
  onReject,
}: IncomingTransferModalProps) {
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [pinInput, setPinInput] = useState('');

  useEffect(() => {
    if (!offer) return;
    const next: Record<string, boolean> = {};
    for (const f of offer.files) {
      next[f.fileId] = true;
    }
    setSelectedIds(next);
    setPinInput('');
  }, [offer]);

  const checkedFileIds = useMemo(() => {
    if (!offer) return [];
    return offer.files.filter((f) => selectedIds[f.fileId] !== false).map((f) => f.fileId);
  }, [offer, selectedIds]);

  const totalSelectedBytes = useMemo(() => {
    if (!offer) return 0;
    return offer.files
      .filter((f) => selectedIds[f.fileId] !== false)
      .reduce((sum, f) => sum + f.size, 0);
  }, [offer, selectedIds]);

  if (!offer) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Permintaan transfer file masuk"
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-[#182229] border border-white/12 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/8 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-base sm:text-lg text-[#E9EDEF] truncate">
              Permintaan Kirim File Masuk
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#AEBAC1] font-mono-tabular mt-1">
              <span className="font-sans font-semibold text-[#00A884]">{offer.senderName}</span>
              <span aria-hidden="true">·</span>
              <span>{offer.senderDeviceName}</span>
              <span aria-hidden="true">·</span>
              <span>{offer.senderIp}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onReject(offer.sessionId)}
            aria-label="Tolak transfer"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[#8696A0] hover:text-white hover:bg-white/8 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#AEBAC1]">
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5 text-[#00A884]" />
              <span>
                {offer.transport === 'wifi-direct' ? 'Wi-Fi Direct P2P' : 'HTTP Stream LAN'}
              </span>
            </span>
            {offer.encryptFiles ? (
              <span className="inline-flex items-center gap-1 text-[#00A884]">
                <Lock className="w-3.5 h-3.5" />
                <span>E2EE File</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <Zap className="w-3.5 h-3.5" />
                <span>Mode Super · Tanpa Enkripsi</span>
              </span>
            )}
          </div>

          {/* Selectable file list */}
          <div className="max-h-64 overflow-y-auto divide-y divide-white/8 rounded-xl bg-[#111B21] border border-white/8 px-3">
            {offer.files.map((file) => {
              const checked = selectedIds[file.fileId] !== false;
              return (
                <label
                  key={file.fileId}
                  className="py-2.5 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedIds((prev) => ({ ...prev, [file.fileId]: e.target.checked }))
                      }
                      className="w-4 h-4 accent-[#00A884] rounded shrink-0"
                    />
                    <FileIcon className="w-4 h-4 text-[#00A884] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-[#E9EDEF] truncate">
                        {file.name}
                      </p>
                      <p className="text-[11px] text-[#8696A0] font-mono-tabular">
                        {formatBytes(file.size)}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          {offer.requiresPin && (
            <div className="space-y-1.5">
              <label
                htmlFor="incoming-transfer-pin"
                className="text-xs font-medium text-[#E9EDEF] flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-amber-300" />
                <span>Masukkan PIN Keamanan Penerima</span>
              </label>
              <input
                id="incoming-transfer-pin"
                type="password"
                inputMode="numeric"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="Masukkan PIN"
                className="w-full min-h-[42px] px-3 rounded-lg bg-[#111B21] border border-white/12 text-sm font-mono-tabular text-[#E9EDEF] focus:outline-none focus:border-[#00A884]"
              />
              {offer.pinError && <p className="text-xs text-rose-300">{offer.pinError}</p>}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => onReject(offer.sessionId)}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-white/8 hover:bg-rose-500/20 text-[#E9EDEF] hover:text-rose-200 text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              Tolak
            </button>
            <button
              type="button"
              disabled={checkedFileIds.length === 0}
              onClick={() => onAccept(offer.sessionId, checkedFileIds, pinInput)}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-[#00A884] hover:bg-[#029676] disabled:opacity-40 text-[#0B141A] text-xs sm:text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>
                Terima ({checkedFileIds.length} · {formatBytes(totalSelectedBytes)})
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
