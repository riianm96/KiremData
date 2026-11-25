import { useEffect, useState } from 'react';

type PwaStateListener = () => void;

const listeners = new Set<PwaStateListener>();
let swOfflineReadyState = false;
let swUpdateAvailableState = false;
let swUpdateRunner: ((reloadPage?: boolean) => Promise<void>) | null = null;
let pendingOutboxCountState = 0;

function emitPwaStateChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function notifyPwaOfflineReady() {
  swOfflineReadyState = true;
  emitPwaStateChange();
}

export function notifyPwaNeedRefresh(
  runner: (reloadPage?: boolean) => Promise<void>,
) {
  swUpdateRunner = runner;
  swUpdateAvailableState = true;
  emitPwaStateChange();
}

export function notifyPendingOutboxCount(count: number) {
  pendingOutboxCountState = Math.max(0, count);
  emitPwaStateChange();
}

export async function requestFlushChatOutbox(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FLUSH_CHAT_OUTBOX' });
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage({ type: 'FLUSH_CHAT_OUTBOX' });
  } catch {
    // Ignore when service worker is not ready
  }
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export function usePWAStatus() {
  const isOnline = useOnlineStatus();
  const [swOfflineReady, setSwOfflineReady] = useState<boolean>(() => {
    if (swOfflineReadyState) return true;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      return Boolean(navigator.serviceWorker.controller);
    }
    return false;
  });
  const [swUpdateAvailable, setSwUpdateAvailable] = useState<boolean>(
    () => swUpdateAvailableState,
  );
  const [pendingOutboxCount, setPendingOutboxCount] = useState<number>(
    () => pendingOutboxCountState,
  );

  useEffect(() => {
    const sync = () => {
      setSwOfflineReady(
        swOfflineReadyState ||
          (typeof navigator !== 'undefined' &&
            'serviceWorker' in navigator &&
            Boolean(navigator.serviceWorker.controller)),
      );
      setSwUpdateAvailable(swUpdateAvailableState);
      setPendingOutboxCount(pendingOutboxCountState);
    };

    listeners.add(sync);

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => {
          swOfflineReadyState = true;
          sync();
        })
        .catch(() => {});
    }

    return () => {
      listeners.delete(sync);
    };
  }, []);

  const applySwUpdate = async () => {
    if (swUpdateRunner) {
      await swUpdateRunner(true);
    } else if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  return {
    isOnline,
    swOfflineReady,
    swUpdateAvailable,
    pendingOutboxCount,
    applySwUpdate,
  };
}
