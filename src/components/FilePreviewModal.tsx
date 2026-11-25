import { Download, X } from 'lucide-react';

export interface PreviewFileState {
  name: string;
  mimeType: string;
  url: string;
  textContent?: string;
}

interface FilePreviewModalProps {
  file: PreviewFileState | null;
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[88vh] rounded-2xl bg-[#111B21] border border-white/10 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 bg-[#202C33] border-b border-white/8 flex items-center justify-between gap-4 shrink-0">
          <p className="font-display font-semibold text-sm text-[#E9EDEF] truncate">
            {file.name}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={file.url}
              download={file.name}
              className="px-3 py-1.5 rounded-lg bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup pratinjau"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8696A0] hover:text-white hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5 bg-[#0B141A] flex items-center justify-center">
          {file.mimeType.startsWith('image/') ? (
            <img
              src={file.url}
              alt={file.name}
              className="max-w-full max-h-[70vh] rounded-lg object-contain border border-white/10"
            />
          ) : file.textContent !== undefined ? (
            <pre className="w-full p-4 rounded-xl bg-[#182229] border border-white/8 text-xs font-mono-tabular text-[#E9EDEF] whitespace-pre-wrap leading-relaxed overflow-auto max-h-[70vh]">
              {file.textContent}
            </pre>
          ) : (
            <p className="text-sm text-[#8696A0]">
              Pratinjau langsung tidak tersedia untuk format ini. Gunakan tombol Unduh di atas.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
