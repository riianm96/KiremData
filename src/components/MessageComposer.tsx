import { useEffect, useRef, useState } from 'react';
import {
  FileUp,
  Image as ImageIcon,
  Lock,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import type { ReplyPreview, TransferTransport } from '../types/chat';
import { formatDuration } from '../utils/format';
import { playRecordTone } from '../services/sound';

interface MessageComposerProps {
  disabled?: boolean;
  muted: boolean;
  p2pConnected: boolean;
  encryptFiles: boolean;
  onToggleEncryptFiles: (encrypted: boolean) => void;
  replyTo: ReplyPreview | null;
  onCancelReply: () => void;
  onTyping: (isTyping: boolean) => void;
  onSendText: (text: string) => void;
  onSendFile: (file: File, preferredTransport: TransferTransport, encryptFiles: boolean) => void;
  onSendVoice: (blob: Blob, durationSec: number, waveform: number[]) => void;
}

const QUICK_EMOJIS = ['👍', '✅', '🚀', '📄', '🔒', '⚡', '👏', '🙏', '🔥', '💡', '📊', '🎉'];

export function MessageComposer({
  disabled,
  muted,
  p2pConnected,
  encryptFiles,
  onToggleEncryptFiles,
  replyTo,
  onCancelReply,
  onTyping,
  onSendText,
  onSendFile,
  onSendVoice,
}: MessageComposerProps) {
  const [text, setText] = useState('');
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showEmojiMenu, setShowEmojiMenu] = useState(false);
  const [preferredTransport, setPreferredTransport] = useState<TransferTransport>('wifi-direct');

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [liveBars, setLiveBars] = useState<number[]>(new Array(24).fill(15));
  const [micError, setMicError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const waveformHistoryRef = useRef<number[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recordStartTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      cleanupRecording();
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
  }, []);

  function cleanupRecording() {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current);
      recordIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }

  function handleTextChange(val: string) {
    setText(val);
    onTyping(val.trim().length > 0);
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      onTyping(false);
    }, 2000);
  }

  function submitText() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSendText(trimmed);
    setText('');
    onTyping(false);
    setShowEmojiMenu(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitText();
    }
  }

  async function startVoiceRecording() {
    setMicError(null);
    setShowAttachMenu(false);
    setShowEmojiMenu(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('Peramban tidak mendukung perekaman mikrofon di konteks ini.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      waveformHistoryRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };

      // Live audio analyser for real waveform visualization
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const sampleWaveform = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
        const avg = Math.min(100, Math.max(12, Math.round((sum / dataArray.length / 255) * 140)));
        waveformHistoryRef.current.push(avg);
        setLiveBars((prev) => [...prev.slice(1), avg]);
        animFrameRef.current = requestAnimationFrame(sampleWaveform);
      };
      animFrameRef.current = requestAnimationFrame(sampleWaveform);

      recordStartTimeRef.current = Date.now();
      setRecordSeconds(0);
      setIsRecording(true);
      playRecordTone(true, muted);

      recordIntervalRef.current = setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - recordStartTimeRef.current) / 1000));
      }, 250);

      recorder.start(200);
    } catch {
      setMicError('Izin mikrofon ditolak. Anda tetap dapat melampirkan file audio melalui tombol lampiran.');
      cleanupRecording();
    }
  }

  function cancelVoiceRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    cleanupRecording();
    setIsRecording(false);
    setRecordSeconds(0);
  }

  function finishAndSendVoice() {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;

    const durationSec = Math.max(1, Math.round((Date.now() - recordStartTimeRef.current) / 1000));
    const samples = waveformHistoryRef.current;
    // Downsample waveform to 28 clean bars
    const normalizedWaveform: number[] = [];
    const bucketSize = Math.max(1, Math.floor(samples.length / 28));
    for (let i = 0; i < 28; i++) {
      const slice = samples.slice(i * bucketSize, (i + 1) * bucketSize);
      const val = slice.length > 0 ? Math.round(slice.reduce((a, b) => a + b, 0) / slice.length) : 24;
      normalizedWaveform.push(Math.min(100, Math.max(15, val)));
    }

    recorder.onstop = () => {
      const blob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || 'audio/webm',
      });
      cleanupRecording();
      setIsRecording(false);
      setRecordSeconds(0);
      playRecordTone(false, muted);
      if (blob.size > 0) {
        onSendVoice(blob, durationSec, normalizedWaveform);
      }
    };

    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      onSendFile(file, preferredTransport, encryptFiles);
    });
    e.target.value = '';
    setShowAttachMenu(false);
  }

  return (
    <div className="bg-[#202C33] border-t border-white/8 px-4 py-3 shrink-0 relative">
      {micError && (
        <div className="mb-2.5 px-3 py-2 rounded-lg bg-[#182229] border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-3">
          <span>{micError}</span>
          <button
            type="button"
            onClick={() => setMicError(null)}
            className="text-[#8696A0] hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {replyTo && (
        <div className="mb-2.5 px-3 py-2 rounded-lg bg-[#182229] border border-white/10 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[#00A884] truncate">{replyTo.senderName}</p>
            <p className="text-xs text-[#AEBAC1] truncate">{replyTo.snippet}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Batalkan balasan"
            className="w-7 h-7 rounded-md flex items-center justify-center text-[#8696A0] hover:text-white hover:bg-white/5 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Attachment menu popover */}
      {showAttachMenu && (
        <div className="absolute bottom-18 left-4 z-30 w-76 rounded-xl bg-[#233138] border border-white/10 shadow-xl p-2">
          <div className="px-2.5 py-2 border-b border-white/8 mb-1.5">
            <p className="text-xs font-medium text-[#E9EDEF] mb-1.5">Protokol Transfer Lokal</p>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#111B21]">
              <button
                type="button"
                onClick={() => setPreferredTransport('wifi-direct')}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  preferredTransport === 'wifi-direct'
                    ? 'bg-[#00A884] text-[#0B141A]'
                    : 'text-[#8696A0] hover:text-[#E9EDEF]'
                }`}
              >
                Wi-Fi Direct
              </button>
              <button
                type="button"
                onClick={() => setPreferredTransport('lan-sync')}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                  preferredTransport === 'lan-sync'
                    ? 'bg-[#00A884] text-[#0B141A]'
                    : 'text-[#8696A0] hover:text-[#E9EDEF]'
                }`}
              >
                LAN Hub Sync
              </button>
            </div>
            <p className="text-[11px] text-[#8696A0] mt-1.5">
              {preferredTransport === 'wifi-direct'
                ? p2pConnected
                  ? '6 jalur P2P paralel · blok 8MB kecepatan tinggi'
                  : 'Otomatis P2P langsung, atau multi-stream LAN 8 jalur'
                : 'Multi-stream paralel (8 jalur × hingga 8MB) via server LAN'}
            </p>
          </div>

          <div className="px-2.5 py-2 border-b border-white/8 mb-1.5">
            <p className="text-xs font-medium text-[#E9EDEF] mb-1.5">Kecepatan & Enkripsi File</p>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#111B21]">
              <button
                type="button"
                onClick={() => onToggleEncryptFiles(false)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
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
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center justify-center gap-1 ${
                  encryptFiles
                    ? 'bg-[#00A884] text-[#0B141A]'
                    : 'text-[#8696A0] hover:text-[#E9EDEF]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>E2EE File</span>
              </button>
            </div>
            <p className="text-[11px] text-[#8696A0] mt-1.5">
              {!encryptFiles
                ? 'Tanpa enkripsi JS tambahan (hanya transport DTLS/TLS) · kecepatan maksimal'
                : 'Enkripsi AES-GCM-256 per blok untuk privasi file maksimal'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full px-3 py-2.5 rounded-lg flex items-center gap-3 text-left text-sm text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-[#00A884]/15 text-[#00A884] flex items-center justify-center shrink-0">
              <FileUp className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">Dokumen & Arsip Besar</p>
              <p className="text-xs text-[#8696A0]">PDF, ZIP, DOCX, atau file proyek</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="w-full px-3 py-2.5 rounded-lg flex items-center gap-3 text-left text-sm text-[#E9EDEF] hover:bg-white/5 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">Gambar & Media</p>
              <p className="text-xs text-[#8696A0]">Resolusi penuh tanpa kompresi</p>
            </div>
          </button>
        </div>
      )}

      {/* Quick emoji popover */}
      {showEmojiMenu && (
        <div className="absolute bottom-18 left-14 z-30 rounded-xl bg-[#233138] border border-white/10 shadow-xl p-2 grid grid-cols-6 gap-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => setText((prev) => prev + emoji)}
              className="w-9 h-9 rounded-lg hover:bg-white/10 text-lg flex items-center justify-center transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFilePicked}
      />
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,audio/*,video/*"
        multiple
        className="hidden"
        onChange={handleFilePicked}
      />

      {isRecording ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cancelVoiceRecording}
            title="Batalkan rekaman suara"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
          >
            <Trash2 className="w-5 h-5" />
          </button>

          <div className="flex-1 h-11 px-4 rounded-xl bg-[#111B21] border border-white/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-mono-tabular text-sm font-medium text-[#E9EDEF]">
                {formatDuration(recordSeconds)}
              </span>
            </div>

            <div className="flex-1 flex items-center justify-center gap-1 h-6 overflow-hidden">
              {liveBars.map((val, idx) => (
                <div
                  key={idx}
                  className="w-1 rounded-full bg-[#00A884] transition-all duration-75"
                  style={{ height: `${Math.max(18, val)}%` }}
                />
              ))}
            </div>

            <span className="text-xs text-[#8696A0] hidden sm:inline whitespace-nowrap">
              Merekam Pesan Suara
            </span>
          </div>

          <button
            type="button"
            onClick={finishAndSendVoice}
            title="Kirim pesan suara terenkripsi"
            className="h-11 px-4 rounded-xl bg-[#00A884] hover:bg-[#029676] text-[#0B141A] font-medium text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Kirim Suara</span>
          </button>
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => {
              setShowEmojiMenu((s) => !s);
              setShowAttachMenu(false);
            }}
            aria-label="Pilih emoji"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5 transition-colors shrink-0"
          >
            <Smile className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowAttachMenu((s) => !s);
              setShowEmojiMenu(false);
            }}
            aria-label="Lampirkan dokumen atau kirim via Wi-Fi Direct"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              showAttachMenu
                ? 'bg-[#00A884]/15 text-[#00A884]'
                : 'text-[#8696A0] hover:text-[#E9EDEF] hover:bg-white/5'
            }`}
          >
            <Paperclip className="w-5 h-5" />
          </button>

          <div className="flex-1 bg-[#2A3942] border border-white/6 rounded-xl px-3.5 py-2 flex items-center gap-2">
            <textarea
              rows={1}
              value={text}
              disabled={disabled}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ketik pesan terenkripsi di jaringan lokal..."
              className="w-full bg-transparent text-[14.5px] text-[#E9EDEF] placeholder-[#8696A0] resize-none focus:outline-none max-h-28 leading-relaxed"
            />
            <button
              type="button"
              onClick={() => onToggleEncryptFiles(!encryptFiles)}
              title={
                encryptFiles
                  ? 'Enkripsi E2EE file aktif (klik untuk Mode Super tanpa enkripsi)'
                  : 'Mode Super aktif: transfer file tanpa enkripsi tambahan (klik untuk E2EE)'
              }
              className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
                encryptFiles
                  ? 'bg-[#00A884]/15 text-[#00A884] hover:bg-[#00A884]/25'
                  : 'bg-amber-400/15 text-amber-300 hover:bg-amber-400/25'
              }`}
            >
              {encryptFiles ? (
                <>
                  <Lock className="w-3 h-3" />
                  <span className="hidden sm:inline">E2EE</span>
                </>
              ) : (
                <>
                  <Zap className="w-3 h-3" />
                  <span className="hidden sm:inline">Super</span>
                </>
              )}
            </button>
            {p2pConnected && (
              <span
                title="Wi-Fi Direct P2P aktif"
                className="text-[#00A884] shrink-0 hidden sm:flex items-center gap-1 text-[11px]"
              >
                <Wifi className="w-3.5 h-3.5" />
              </span>
            )}
          </div>

          {text.trim().length > 0 ? (
            <button
              type="button"
              onClick={submitText}
              disabled={disabled}
              aria-label="Kirim pesan"
              className="w-11 h-11 rounded-xl bg-[#00A884] hover:bg-[#029676] text-[#0B141A] flex items-center justify-center transition-colors shrink-0"
            >
              <Send className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={startVoiceRecording}
              disabled={disabled}
              aria-label="Rekam pesan suara"
              title="Rekam pesan suara"
              className="w-11 h-11 rounded-xl bg-[#2A3942] hover:bg-[#32444F] text-[#E9EDEF] border border-white/8 flex items-center justify-center transition-colors shrink-0"
            >
              <Mic className="w-5 h-5 text-[#00A884]" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
