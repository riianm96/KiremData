export interface LocalSendPrepareResponse {
  sessionId: string;
  files: Record<string, string>;
}

export interface LocalSendFileDescriptor {
  fileId: string;
  file: File;
}

export async function prepareLocalSendUpload(params: {
  files: Array<{
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
  }>;
  pin?: string;
  senderName?: string;
}): Promise<LocalSendPrepareResponse> {
  const fileMap: Record<
    string,
    { id: string; fileName: string; size: number; fileType: string }
  > = {};
  for (const f of params.files) {
    fileMap[f.fileId] = {
      id: f.fileId,
      fileName: f.name,
      size: f.size,
      fileType: f.mimeType || 'application/octet-stream',
    };
  }

  const query = params.pin ? `?pin=${encodeURIComponent(params.pin)}` : '';
  const res = await fetch(`/api/localsend/v2/prepare-upload${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      info: {
        alias: params.senderName || 'KiremData',
        version: '2.1',
        deviceModel: navigator.platform || 'Web',
        deviceType: 'web',
      },
      files: fileMap,
    }),
  });

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('kiremdata:auth-required'));
    }
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Gagal prepare-upload (${res.status})`);
  }

  return (await res.json()) as LocalSendPrepareResponse;
}

export function isLocalLanOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  if (!host) return false;
  if (host.endsWith('.run.app') || host.endsWith('.ai.studio')) return false;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local')
  );
}

const STREAM_READ_SLICE_BYTES = 4 * 1024 * 1024; // 4 MB contiguous disk slice per pull
const STREAM_HIGH_WATER_MARK_BYTES = 16 * 1024 * 1024; // 16 MB buffer watermark for high-throughput LAN TCP

function supportsStreamingFetchUpload(): boolean {
  if (
    typeof Request === 'undefined' ||
    typeof ReadableStream === 'undefined' ||
    typeof TransformStream === 'undefined' ||
    typeof ByteLengthQueuingStrategy === 'undefined'
  ) {
    return false;
  }
  try {
    let duplexAccessed = false;
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      body: new ReadableStream(),
      get duplex() {
        duplexAccessed = true;
        return 'half' as const;
      },
    };
    const req = new Request('http://localhost/probe', init);
    // Browsers without request stream support coerce ReadableStream to string and auto-set text/plain Content-Type
    return duplexAccessed && !req.headers.has('Content-Type');
  } catch {
    return false;
  }
}

function createDiskBackedFileStream(
  file: File,
  sliceBytes = STREAM_READ_SLICE_BYTES,
  highWaterMark = STREAM_HIGH_WATER_MARK_BYTES,
): ReadableStream<Uint8Array> {
  let offset = 0;
  const strategy = new ByteLengthQueuingStrategy({ highWaterMark });

  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        if (offset >= file.size) {
          controller.close();
          return;
        }
        const nextEnd = Math.min(file.size, offset + sliceBytes);
        const buffer = await file.slice(offset, nextEnd).arrayBuffer();
        offset = nextEnd;
        if (buffer.byteLength > 0) {
          controller.enqueue(new Uint8Array(buffer));
        }
        if (offset >= file.size) {
          controller.close();
        }
      },
    },
    strategy,
  );
}

function uploadViaXhrFileStream(params: {
  url: string;
  file: File;
  signal?: AbortSignal;
  onProgress: (loadedBytes: number, totalBytes: number, speedBytesPerSec: number) => void;
}): Promise<{
  ok: boolean;
  bytesWritten: number;
  speedBytesPerSec: number;
  savedToDiskPath?: string;
}> {
  return new Promise((resolve, reject) => {
    const { url, file, signal, onProgress } = params;

    if (signal?.aborted) {
      reject(new DOMException('Transfer dibatalkan', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    const startedAt = performance.now();
    let windowStartAt = startedAt;
    let windowBaseBytes = 0;
    let smoothedSpeed = 0;
    let lastEmitAt = 0;

    const handleAbort = () => {
      try {
        xhr.abort();
      } catch {
        // Ignore
      }
      reject(new DOMException('Transfer dibatalkan', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', handleAbort, { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      const loaded = ev.lengthComputable ? ev.loaded : file.size;
      const total = ev.lengthComputable && ev.total > 0 ? ev.total : file.size;
      const now = performance.now();

      const windowSec = (now - windowStartAt) / 1000;
      if (windowSec >= 0.3) {
        const deltaBytes = Math.max(0, loaded - windowBaseBytes);
        const instantSpeed = deltaBytes / windowSec;
        smoothedSpeed =
          smoothedSpeed > 0 ? smoothedSpeed * 0.4 + instantSpeed * 0.6 : instantSpeed;
        windowStartAt = now;
        windowBaseBytes = loaded;
      }

      if (now - lastEmitAt >= 60 || loaded >= total) {
        lastEmitAt = now;
        const avgSpeed = loaded / Math.max(0.02, (now - startedAt) / 1000);
        onProgress(loaded, total, smoothedSpeed > 0 ? smoothedSpeed : avgSpeed);
      }
    };

    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      if (xhr.status >= 200 && xhr.status < 300) {
        const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
        const finalSpeed = file.size / elapsed;
        let savedToDiskPath: string | undefined;
        try {
          const parsed = JSON.parse(xhr.responseText || '{}') as { savedToDiskPath?: string };
          savedToDiskPath = parsed.savedToDiskPath;
        } catch {
          // Ignore malformed JSON
        }
        onProgress(file.size, file.size, finalSpeed);
        resolve({
          ok: true,
          bytesWritten: file.size,
          speedBytesPerSec: finalSpeed,
          savedToDiskPath,
        });
      } else {
        if (xhr.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('kiremdata:auth-required'));
        }
        reject(new Error(`Upload gagal (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      reject(new Error('Koneksi jaringan terputus saat streaming upload.'));
    };

    xhr.onabort = () => {
      if (signal) signal.removeEventListener('abort', handleAbort);
      reject(new DOMException('Transfer dibatalkan', 'AbortError'));
    };

    // Pass native File object directly so browser streams straight from disk without buffering in JS RAM
    xhr.send(file);
  });
}

export async function streamUploadFileViaHttp(params: {
  sessionId: string;
  fileId: string;
  token: string;
  file: File;
  targetPeerId?: string;
  senderId?: string;
  senderName?: string;
  signal?: AbortSignal;
  onProgress: (loadedBytes: number, totalBytes: number, speedBytesPerSec: number) => void;
}): Promise<{
  ok: boolean;
  bytesWritten: number;
  speedBytesPerSec: number;
  savedToDiskPath?: string;
}> {
  const {
    sessionId,
    fileId,
    token,
    file,
    targetPeerId,
    senderId,
    senderName,
    signal,
    onProgress,
  } = params;

  if (signal?.aborted) {
    throw new DOMException('Transfer dibatalkan', 'AbortError');
  }

  const qs = new URLSearchParams({
    sessionId,
    fileId,
    token,
  });
  if (targetPeerId) qs.set('targetPeerId', targetPeerId);
  if (senderId) qs.set('senderId', senderId);
  if (senderName) qs.set('senderName', senderName);
  const url = `/api/localsend/v2/upload?${qs.toString()}`;

  if (supportsStreamingFetchUpload() && file.size > 0) {
    const internalAbort = new AbortController();
    const forwardAbort = () => internalAbort.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    const startedAt = performance.now();
    let windowStartAt = startedAt;
    let windowBaseBytes = 0;
    let smoothedSpeed = 0;
    let lastEmitAt = 0;
    let bytesPushed = 0;

    try {
      const sourceStream = createDiskBackedFileStream(
        file,
        STREAM_READ_SLICE_BYTES,
        STREAM_HIGH_WATER_MARK_BYTES,
      );

      const streamStrategy = new ByteLengthQueuingStrategy({
        highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
      });

      const progressTransform = new TransformStream<Uint8Array, Uint8Array>(
        {
          transform(chunk, controller) {
            bytesPushed += chunk.byteLength;
            const now = performance.now();
            const windowSec = (now - windowStartAt) / 1000;
            if (windowSec >= 0.3) {
              const deltaBytes = Math.max(0, bytesPushed - windowBaseBytes);
              const instantSpeed = deltaBytes / windowSec;
              smoothedSpeed =
                smoothedSpeed > 0 ? smoothedSpeed * 0.4 + instantSpeed * 0.6 : instantSpeed;
              windowStartAt = now;
              windowBaseBytes = bytesPushed;
            }
            if (now - lastEmitAt >= 60 || bytesPushed >= file.size) {
              lastEmitAt = now;
              const avgSpeed = bytesPushed / Math.max(0.02, (now - startedAt) / 1000);
              onProgress(bytesPushed, file.size, smoothedSpeed > 0 ? smoothedSpeed : avgSpeed);
            }
            controller.enqueue(chunk);
          },
        },
        streamStrategy,
        streamStrategy,
      );

      const pipePromise = sourceStream
        .pipeTo(progressTransform.writable, { signal: internalAbort.signal })
        .catch((err) => {
          if (!internalAbort.signal.aborted) {
            internalAbort.abort();
            throw err;
          }
        });

      const fetchInit: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: progressTransform.readable,
        duplex: 'half',
        signal: internalAbort.signal,
      };

      const [res] = await Promise.all([fetch(url, fetchInit), pipePromise]);

      if (!res.ok) {
        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event('kiremdata:auth-required'));
        }
        const httpErr = new Error(`Upload gagal (HTTP ${res.status})`);
        (httpErr as Error & { isHttpStatus?: boolean }).isHttpStatus = true;
        throw httpErr;
      }

      const elapsed = Math.max(0.02, (performance.now() - startedAt) / 1000);
      const finalSpeed = file.size / elapsed;
      const parsed = (await res.json().catch(() => ({}))) as {
        savedToDiskPath?: string;
        bytesWritten?: number;
      };
      onProgress(file.size, file.size, finalSpeed);
      return {
        ok: true,
        bytesWritten: parsed.bytesWritten ?? file.size,
        speedBytesPerSec: finalSpeed,
        savedToDiskPath: parsed.savedToDiskPath,
      };
    } catch (err) {
      internalAbort.abort();
      if (signal?.aborted || (err as DOMException)?.name === 'AbortError') {
        throw new DOMException('Transfer dibatalkan', 'AbortError');
      }
      if ((err as Error & { isHttpStatus?: boolean })?.isHttpStatus) {
        throw err;
      }
      // Chrome rejects duplex fetch streams on plain HTTP/1.1 LAN origins (ERR_H2_OR_QUIC_REQUIRED):
      // seamlessly fall back to XHR native File streaming which streams from disk over HTTP/1.1 TCP without RAM buffering.
      if (bytesPushed > 0 && !(err instanceof TypeError)) {
        throw err instanceof Error ? err : new Error('Koneksi jaringan terputus saat streaming upload.');
      }
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return uploadViaXhrFileStream({ url, file, signal, onProgress });
}

export async function cancelLocalSendSession(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/localsend/v2/cancel?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
    });
  } catch {
    // Ignore network errors during cancel
  }
}

export async function runConcurrentFileWorkers<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const slots = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: slots }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        await worker(items[idx]);
      }
    }),
  );
}

export async function saveBlobWithPickerOrDownload(
  blob: Blob,
  fileName: string,
): Promise<'picker' | 'download'> {
  const win = window as unknown as {
    showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({ suggestedName: fileName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return 'picker';
      }
      // Fallback smoothly to standard download if picker is blocked in iframe
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'download';
}
