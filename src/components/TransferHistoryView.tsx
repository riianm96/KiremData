import { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Eye,
  Send,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';
import type { FileTransferTask } from '../types/chat';
import { formatBytes, formatSpeed, formatTime } from '../utils/format';

interface TransferHistoryViewProps {
  transfers: FileTransferTask[];
  onSaveTaskToDisk: (task: FileTransferTask) => void;
  onPreviewTask: (task: FileTransferTask) => void;
  onClearHistory: () => void;
  onGoToSend: () => void;
}

export function TransferHistoryView({
  transfers,
  onSaveTaskToDisk,
  onPreviewTask,
  onClearHistory,
  onGoToSend,
}: TransferHistoryViewProps) {
  const [filter, setFilter] = useState<'all' | 'receive' | 'send'>('all');

  const filtered = useMemo(() => {
    if (filter === 'all') return transfers;
    return transfers.filter((t) => t.direction === filter);
  }, [transfers, filter]);

  return (
    <div className="flex-1 h-full overflow-y-auto bg-[#0B141A] p-4 sm:p-6 pb-24 md:pb-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="font-display font-bold text-xl sm:text-2xl text-[#E9EDEF] text-balance">
              Riwayat Transfer File
            </h1>
            <p className="text-xs sm:text-sm text-[#8696A0] mt-1">
              Catatan transfer keluar-masuk beserta kecepatan, ukuran, dan status unduhan.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-[#111B21] border border-white/10">
              {(['all', 'receive', 'send'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={`min-h-[36px] px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    filter === key
                      ? 'bg-[#00A884] text-[#0B141A]'
                      : 'text-[#8696A0] hover:text-[#E9EDEF]'
                  }`}
                >
                  {key === 'all' ? 'Semua' : key === 'receive' ? 'Diterima' : 'Dikirim'}
                </button>
              ))}
            </div>
            {transfers.length > 0 && (
              <button
                type="button"
                onClick={onClearHistory}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white/6 hover:bg-rose-500/20 text-xs text-[#AEBAC1] hover:text-rose-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Bersihkan</span>
              </button>
            )}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl bg-[#111B21] border border-white/10 p-10 text-center space-y-3">
            <p className="text-sm font-medium text-[#E9EDEF]">Belum ada riwayat transfer</p>
            <p className="text-xs text-[#8696A0]">
              File yang dikirim atau diterima melalui Kirim Cepat maupun obrolan akan tercatat di sini.
            </p>
            <button
              type="button"
              onClick={onGoToSend}
              className="min-h-[42px] px-4 py-2 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold inline-flex items-center gap-2 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Kirim File Sekarang</span>
            </button>
          </div>
        ) : (
          <div className="rounded-xl bg-[#111B21] border border-white/10 divide-y divide-white/8">
            {filtered.map((task) => {
              const pct =
                task.fileSize > 0
                  ? Math.min(100, Math.round((task.transferredBytes / task.fileSize) * 100))
                  : 100;
              return (
                <div
                  key={task.fileId}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        task.direction === 'receive'
                          ? 'bg-[#00A884]/15 text-[#00A884]'
                          : 'bg-sky-500/15 text-sky-400'
                      }`}
                    >
                      {task.direction === 'receive' ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[#E9EDEF] truncate">{task.fileName}</p>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#AEBAC1] font-mono-tabular mt-0.5">
                        <span>{task.direction === 'receive' ? 'Dari' : 'Ke'} {task.peerName}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatBytes(task.fileSize)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <Wifi className="w-3 h-3 text-[#00A884]" />
                          {task.transport === 'wifi-direct' ? 'Wi-Fi Direct' : 'HTTP Stream'}
                        </span>
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
                        <span aria-hidden="true">·</span>
                        <span>{formatTime(task.completedAt ?? task.startedAt)}</span>
                      </div>
                      {task.status === 'transferring' && (
                        <div className="mt-2 h-1.5 w-48 max-w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#00A884] transition-all duration-100"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                      {task.status === 'error' && task.errorMessage && (
                        <p className="text-xs text-rose-300 mt-1">{task.errorMessage}</p>
                      )}
                    </div>
                  </div>

                  {task.status === 'completed' && (
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {(task.mimeType.startsWith('image/') ||
                        task.mimeType.startsWith('text/')) && (
                        <button
                          type="button"
                          onClick={() => onPreviewTask(task)}
                          className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/14 text-xs text-[#E9EDEF] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Pratinjau</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onSaveTaskToDisk(task)}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Simpan</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
