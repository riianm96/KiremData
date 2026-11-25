import { FileText, Mic, MessageSquare, X } from 'lucide-react';
import type { ToastNotificationItem } from '../types/chat';

interface ToastNotificationsProps {
  toasts: ToastNotificationItem[];
  onOpenRoom: (roomId: string) => void;
  onDismiss: (id: string) => void;
}

export function ToastNotifications({
  toasts,
  onOpenRoom,
  onDismiss,
}: ToastNotificationsProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none">
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'file' ? FileText : toast.type === 'voice' ? Mic : MessageSquare;

        return (
          <div
            key={toast.id}
            className="pointer-events-auto rounded-xl bg-[#202C33] border border-[#00A884]/35 shadow-2xl p-3.5 flex items-start gap-3 transition-all"
          >
            <div className="w-9 h-9 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
              <Icon className="w-4 h-4" />
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenRoom(toast.roomId);
                onDismiss(toast.id);
              }}
              className="flex-1 min-w-0 text-left"
            >
              <p className="text-xs font-semibold text-[#00A884] truncate">{toast.roomName}</p>
              <p className="text-xs font-medium text-[#E9EDEF] truncate mt-0.5">
                {toast.senderName}
              </p>
              <p className="text-xs text-[#AEBAC1] line-clamp-2 mt-0.5">{toast.preview}</p>
            </button>

            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Tutup notifikasi"
              className="text-[#8696A0] hover:text-white p-0.5 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
