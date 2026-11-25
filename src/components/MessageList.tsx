import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Clock,
  Download,
  Eye,
  FileArchive,
  FileText,
  Film,
  Image as ImageIcon,
  Lock,
  Pause,
  Play,
  Reply,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Wifi,
  Zap,
} from 'lucide-react';
import type { ChatMessage, FileTransferTask } from '../types/chat';
import {
  formatBytes,
  formatDateDivider,
  formatDuration,
  formatSpeed,
  formatTime,
  getSenderColorClass,
} from '../utils/format';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  transfersByFileId: Record<string, FileTransferTask>;
  highlightedMessageId: string | null;
  searchQuery: string;
  onReply: (message: ChatMessage) => void;
  onRequestDeleteMessage: (message: ChatMessage) => void;
  onDownloadFile: (message: ChatMessage) => void;
  onPreviewFile: (message: ChatMessage) => void;
  onPauseResumeTransfer: (fileId: string) => void;
  onClearHighlight: () => void;
}

function renderHighlightedText(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark
        key={idx}
        className="bg-amber-400/30 text-amber-100 rounded px-0.5 font-medium"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function VoiceMessagePlayer({
  message,
  isOwn,
}: {
  message: ChatMessage;
  isOwn: boolean;
}) {
  const voice = message.voiceMeta!;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSec, setCurrentSec] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);

  const audioSrc = useMemo(() => {
    if (!voice.audioBase64) return null;
    return `data:${voice.mimeType || 'audio/webm'};base64,${voice.audioBase64}`;
  }, [voice.audioBase64, voice.mimeType]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = rate;
  }, [rate]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !audioSrc) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  }

  function cycleRate() {
    setRate((r) => (r === 1 ? 1.5 : r === 1.5 ? 2 : 1));
  }

  function handleSeek(idx: number, total: number) {
    const audio = audioRef.current;
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return;
    const ratio = idx / total;
    audio.currentTime = ratio * audio.duration;
    setProgress(ratio);
  }

  const bars = voice.waveform.length > 0 ? voice.waveform : new Array(24).fill(35);

  return (
    <div className="flex items-center gap-3 min-w-[235px] sm:min-w-[270px] py-1">
      {audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={() => {
            const a = audioRef.current;
            if (!a) return;
            const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : voice.durationSec;
            setCurrentSec(a.currentTime);
            setProgress(Math.min(1, a.currentTime / Math.max(0.1, dur)));
          }}
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
            setCurrentSec(0);
          }}
        />
      )}

      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Jeda pesan suara' : 'Putar pesan suara'}
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
          isOwn
            ? 'bg-[#00A884] text-[#0B141A] hover:bg-[#029676]'
            : 'bg-[#00A884]/20 text-[#00A884] hover:bg-[#00A884]/30'
        }`}
      >
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-[3px] h-7 cursor-pointer">
          {bars.map((heightPct, idx) => {
            const active = idx / bars.length <= progress;
            return (
              <div
                key={idx}
                onClick={() => handleSeek(idx, bars.length)}
                className={`flex-1 rounded-full transition-colors ${
                  active ? 'bg-[#00A884]' : isOwn ? 'bg-white/30' : 'bg-[#8696A0]/45'
                }`}
                style={{ height: `${Math.max(18, Math.min(100, heightPct))}%` }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between mt-1 text-[11px] font-mono-tabular text-[#AEBAC1]">
          <span>{formatDuration(playing ? currentSec : voice.durationSec)}</span>
          <button
            type="button"
            onClick={cycleRate}
            className="px-1.5 py-0.5 rounded bg-black/25 hover:bg-black/40 text-[10px] font-medium text-[#E9EDEF] transition-colors"
          >
            {rate}x
          </button>
        </div>
      </div>
    </div>
  );
}

function getFileIcon(mimeType: string, fileName: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType.startsWith('video/')) return Film;
  if (fileName.match(/\.(zip|rar|7z|tar|gz)$/i)) return FileArchive;
  return FileText;
}

export function MessageList({
  messages,
  currentUserId,
  transfersByFileId,
  highlightedMessageId,
  searchQuery,
  onReply,
  onRequestDeleteMessage,
  onDownloadFile,
  onPreviewFile,
  onPauseResumeTransfer,
  onClearHighlight,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (highlightedMessageId) {
      const el = messageRefs.current[highlightedMessageId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const timer = setTimeout(onClearHighlight, 2600);
        return () => clearTimeout(timer);
      }
    }
  }, [highlightedMessageId, onClearHighlight]);

  useEffect(() => {
    if (!highlightedMessageId) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, highlightedMessageId]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 chat-canvas-pattern flex items-center justify-center p-6">
        <div className="max-w-md text-center px-6 py-5 rounded-xl bg-[#182229]/90 border border-white/8">
          <div className="w-11 h-11 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mx-auto mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="font-display font-semibold text-base text-[#E9EDEF] mb-1.5">
            Saluran Jaringan Lokal Terenkripsi
          </h3>
          <p className="text-xs text-[#8696A0] leading-relaxed">
            Pesan teks, pesan suara, dan transfer dokumen besar melalui Wi-Fi Direct di ruang ini dilindungi enkripsi ujung-ke-ujung (ECDH P-256 + AES-GCM-256) tanpa koneksi internet.
          </p>
        </div>
      </div>
    );
  }

  let lastDateLabel = '';

  return (
    <div className="flex-1 overflow-y-auto chat-canvas-pattern px-4 sm:px-8 py-5 space-y-2">
      {/* E2EE session banner */}
      <div className="flex justify-center mb-4">
        <div className="max-w-lg px-4 py-2 rounded-lg bg-[#182229]/95 border border-white/8 text-center flex items-center gap-2 text-xs text-[#AEBAC1]">
          <Lock className="w-3.5 h-3.5 text-[#00A884] shrink-0" />
          <span>
            Pesan dan dokumen dienkripsi ujung-ke-ujung secara lokal. Tidak ada data yang dikirim ke internet.
          </span>
        </div>
      </div>

      {messages.map((msg) => {
        const isOwn = msg.senderId === currentUserId;
        const dateLabel = formatDateDivider(msg.timestamp);
        const showDateDivider = dateLabel !== lastDateLabel;
        lastDateLabel = dateLabel;

        const transfer = msg.fileMeta ? transfersByFileId[msg.fileMeta.fileId] : undefined;
        const isHighlighted = highlightedMessageId === msg.id;
        const FileIcon = msg.fileMeta ? getFileIcon(msg.fileMeta.mimeType, msg.fileMeta.name) : FileText;

        const progressPct =
          transfer && transfer.fileSize > 0
            ? Math.min(100, Math.round((transfer.transferredBytes / transfer.fileSize) * 100))
            : 100;

        return (
          <div key={msg.id}>
            {showDateDivider && (
              <div className="flex justify-center my-3">
                <span className="px-3 py-1 rounded-md bg-[#182229] border border-white/8 text-[11px] font-medium text-[#8696A0]">
                  {dateLabel}
                </span>
              </div>
            )}

            <div
              ref={(el) => {
                messageRefs.current[msg.id] = el;
              }}
              className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group transition-colors duration-300 ${
                isHighlighted ? 'bg-[#00A884]/15 -mx-3 px-3 py-1 rounded-xl' : ''
              }`}
            >
              <div
                className={`relative max-w-[85%] sm:max-w-[70%] lg:max-w-[60%] rounded-xl px-3.5 py-2.5 border transition-all ${
                  isOwn
                    ? 'bg-[#005C4B] border-[#00A884]/20 text-[#E9EDEF]'
                    : 'bg-[#202C33] border-white/6 text-[#E9EDEF]'
                }`}
              >
                {/* Hover reply & delete buttons */}
                <div
                  className={`opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity absolute top-2 flex items-center gap-1 ${
                    isOwn ? '-left-16' : '-right-16'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onReply(msg)}
                    title="Balas pesan"
                    aria-label="Balas pesan"
                    className="w-7 h-7 rounded-md bg-[#182229] border border-white/10 text-[#AEBAC1] hover:text-white flex items-center justify-center"
                  >
                    <Reply className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onRequestDeleteMessage(msg)}
                    title="Hapus pesan"
                    aria-label="Hapus pesan"
                    className="w-7 h-7 rounded-md bg-[#182229] border border-white/10 text-[#AEBAC1] hover:text-rose-400 flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Group sender header */}
                {!isOwn && msg.roomType === 'group' && (
                  <p className={`text-xs font-semibold mb-1 ${getSenderColorClass(msg.senderId)}`}>
                    {msg.senderName}
                  </p>
                )}

                {/* Quoted reply preview */}
                {msg.replyTo && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-black/25 border border-white/10">
                    <p className="text-[11px] font-semibold text-[#00A884] truncate">
                      {msg.replyTo.senderName}
                    </p>
                    <p className="text-xs text-[#AEBAC1] truncate">{msg.replyTo.snippet}</p>
                  </div>
                )}

                {/* Voice message */}
                {msg.type === 'voice' && msg.voiceMeta && (
                  <VoiceMessagePlayer message={msg} isOwn={isOwn} />
                )}

                {/* File / Large document transfer card */}
                {msg.type === 'file' && msg.fileMeta && (
                  <div className="mb-1.5 rounded-lg bg-black/25 border border-white/10 p-3 min-w-[250px] sm:min-w-[310px]">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
                        <FileIcon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#E9EDEF] truncate">
                          {renderHighlightedText(msg.fileMeta.name, searchQuery)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#AEBAC1] font-mono-tabular mt-0.5">
                          <span>{formatBytes(msg.fileMeta.size)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Wifi className="w-3 h-3 text-[#00A884]" />
                            {msg.fileMeta.transport === 'wifi-direct' ? 'Wi-Fi Direct' : 'LAN Sync'}
                          </span>
                          {transfer &&
                            transfer.speedBytesPerSec > 0 &&
                            (transfer.status === 'transferring' || transfer.status === 'completed') && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-[#00A884]">
                                  {formatSpeed(transfer.speedBytesPerSec)}
                                </span>
                              </>
                            )}
                        </div>
                      </div>
                    </div>

                    {/* Transfer progress bar when transferring/paused */}
                    {transfer && transfer.status !== 'completed' && (
                      <div className="mt-2.5">
                        <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#AEBAC1] mb-1">
                          <span>
                            {transfer.status === 'paused'
                              ? 'Dijeda'
                              : transfer.status === 'verifying'
                                ? 'Verifikasi SHA-256...'
                                : `${transfer.completedChunks}/${transfer.totalChunks} blok`}
                          </span>
                          <span>{progressPct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-[#00A884] transition-all duration-150"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-end gap-2">
                          {(transfer.status === 'transferring' || transfer.status === 'paused') && (
                            <button
                              type="button"
                              onClick={() => onPauseResumeTransfer(msg.fileMeta!.fileId)}
                              className="px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/12 text-xs text-[#E9EDEF] flex items-center gap-1 transition-colors"
                            >
                              {transfer.status === 'paused' ? (
                                <>
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Lanjutkan</span>
                                </>
                              ) : (
                                <>
                                  <Pause className="w-3 h-3" />
                                  <span>Jeda</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Completed actions */}
                    {(!transfer || transfer.status === 'completed') && (
                      <div className="mt-2.5 pt-2 border-t border-white/8 flex items-center justify-between gap-2">
                        {msg.fileMeta.encrypted === false ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-300">
                            <Zap className="w-3.5 h-3.5" />
                            <span>Mode Super · Tanpa Enkripsi</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#00A884]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>SHA-256 Terverifikasi</span>
                          </span>
                        )}

                        <div className="flex items-center gap-1.5">
                          {(msg.fileMeta.mimeType.startsWith('image/') ||
                            msg.fileMeta.mimeType.startsWith('text/')) && (
                            <button
                              type="button"
                              onClick={() => onPreviewFile(msg)}
                              className="px-2.5 py-1 rounded-md bg-white/8 hover:bg-white/15 text-xs font-medium text-[#E9EDEF] flex items-center gap-1 transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Pratinjau</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDownloadFile(msg)}
                            className="px-2.5 py-1 rounded-md bg-[#00A884] hover:bg-[#029676] text-[#0B141A] text-xs font-semibold flex items-center gap-1 transition-colors"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Unduh</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Text body */}
                {msg.text && (
                  <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words tracking-[0.005em]">
                    {renderHighlightedText(msg.text, searchQuery)}
                  </p>
                )}

                {/* Bottom timestamp + E2EE + delivery tick */}
                <div className="flex items-center justify-end gap-1.5 mt-1 select-none">
                  {msg.isEncrypted && (
                    <Lock className="w-2.5 h-2.5 text-[#AEBAC1]/70" aria-label="Terenkripsi E2E" />
                  )}
                  <span className="text-[11px] font-mono-tabular text-[#AEBAC1]">
                    {formatTime(msg.timestamp)}
                  </span>
                  {isOwn && (
                    <span
                      className="ml-0.5"
                      title={
                        msg.status === 'sending'
                          ? 'Menunggu koneksi (Antrean BackgroundSync)'
                          : `Status: ${msg.status}`
                      }
                    >
                      {msg.status === 'read' ? (
                        <CheckCheck className="w-3.5 h-3.5 text-[#53BDEB]" />
                      ) : msg.status === 'delivered' ? (
                        <CheckCheck className="w-3.5 h-3.5 text-[#AEBAC1]" />
                      ) : msg.status === 'sending' ? (
                        <Clock className="w-3.5 h-3.5 text-amber-300" />
                      ) : (
                        <Check className="w-3.5 h-3.5 text-[#AEBAC1]" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div ref={bottomRef} />
    </div>
  );
}
