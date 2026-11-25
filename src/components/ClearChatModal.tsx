import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { ChatMessage } from '../types/chat';

export type DeleteDialogState =
  | { kind: 'room'; roomId: string; roomName: string; messageCount: number }
  | { kind: 'all'; totalMessages: number }
  | { kind: 'message'; message: ChatMessage; isOwn: boolean }
  | null;

interface ClearChatModalProps {
  state: DeleteDialogState;
  onClose: () => void;
  onConfirmRoomClear: (roomId: string, scope: 'me' | 'everyone') => void;
  onConfirmDeleteMessage: (message: ChatMessage, scope: 'me' | 'everyone') => void;
  onConfirmClearAll: () => void;
}

export function ClearChatModal({
  state,
  onClose,
  onConfirmRoomClear,
  onConfirmDeleteMessage,
  onConfirmClearAll,
}: ClearChatModalProps) {
  if (!state) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 bg-[#202C33] border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-500/15 text-rose-400 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
            <h3 className="font-display font-semibold text-base text-[#E9EDEF]">
              {state.kind === 'message'
                ? 'Hapus Pesan'
                : state.kind === 'all'
                  ? 'Hapus Semua Riwayat Chat'
                  : 'Hapus Riwayat Obrolan'}
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
          {state.kind === 'room' && (
            <>
              <div className="p-3.5 rounded-xl bg-[#182229] border border-white/8 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-[#AEBAC1] leading-relaxed">
                  <p className="font-medium text-[#E9EDEF] mb-1">
                    Bersihkan riwayat pesan di &ldquo;{state.roomName}&rdquo;?
                  </p>
                  <p>
                    {state.messageCount} pesan di ruangan ini akan dihapus secara permanen dari riwayat yang dipilih dan tidak akan dimuat ulang saat tersambung kembali.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onConfirmRoomClear(state.roomId, 'me');
                    onClose();
                  }}
                  className="w-full h-10 px-4 rounded-lg bg-[#202C33] hover:bg-white/10 border border-white/10 text-sm font-medium text-[#E9EDEF] transition-colors"
                >
                  Hapus untuk Perangkat Saya
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onConfirmRoomClear(state.roomId, 'everyone');
                    onClose();
                  }}
                  className="w-full h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-semibold text-white transition-colors"
                >
                  Hapus untuk Semua Perangkat di Ruangan
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-9 px-4 rounded-lg text-xs font-medium text-[#8696A0] hover:text-[#E9EDEF] transition-colors"
                >
                  Batal
                </button>
              </div>
            </>
          )}

          {state.kind === 'message' && (
            <>
              <div className="p-3.5 rounded-xl bg-[#182229] border border-white/8 space-y-1.5">
                <p className="text-xs font-semibold text-[#00A884]">{state.message.senderName}</p>
                <p className="text-xs text-[#AEBAC1] line-clamp-3">
                  {state.message.fileMeta
                    ? `Dokumen: ${state.message.fileMeta.name}`
                    : state.message.type === 'voice'
                      ? `Pesan Suara (${state.message.voiceMeta?.durationSec ?? 0} detik)`
                      : state.message.text}
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => {
                    onConfirmDeleteMessage(state.message, 'me');
                    onClose();
                  }}
                  className="w-full h-10 px-4 rounded-lg bg-[#202C33] hover:bg-white/10 border border-white/10 text-sm font-medium text-[#E9EDEF] transition-colors"
                >
                  Hapus untuk Saya
                </button>
                {state.isOwn && (
                  <button
                    type="button"
                    onClick={() => {
                      onConfirmDeleteMessage(state.message, 'everyone');
                      onClose();
                    }}
                    className="w-full h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-semibold text-white transition-colors"
                  >
                    Hapus untuk Semua Orang
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full h-9 px-4 rounded-lg text-xs font-medium text-[#8696A0] hover:text-[#E9EDEF] transition-colors"
                >
                  Batal
                </button>
              </div>
            </>
          )}

          {state.kind === 'all' && (
            <>
              <div className="p-3.5 rounded-xl bg-[#182229] border border-white/8 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="text-xs text-[#AEBAC1] leading-relaxed">
                  <p className="font-medium text-[#E9EDEF] mb-1">
                    Hapus semua riwayat chat di perangkat ini?
                  </p>
                  <p>
                    Seluruh {state.totalMessages} pesan di semua obrolan pribadi dan grup akan dibersihkan dari perangkat ini secara permanen.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 px-4 rounded-lg bg-[#202C33] hover:bg-white/10 text-xs font-medium text-[#E9EDEF] transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onConfirmClearAll();
                    onClose();
                  }}
                  className="h-10 px-4 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white transition-colors"
                >
                  Hapus Semua Riwayat
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
