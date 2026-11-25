import { Queue } from 'workbox-background-sync';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';

interface SwClient {
  postMessage: (message: unknown) => void;
}

interface SwMessageEvent {
  data?: { type?: string };
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SwGlobalScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null } | string>;
  skipWaiting: () => Promise<void>;
  clients: {
    matchAll: (options?: {
      type?: 'window' | 'worker' | 'sharedworker' | 'all';
      includeUncontrolled?: boolean;
    }) => Promise<SwClient[]>;
  };
  addEventListener: (
    type: string,
    listener: (event: SwMessageEvent) => void,
  ) => void;
}

const swScope = self as unknown as SwGlobalScope;

void swScope.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// Precache Vite build assets injected by vite-plugin-pwa (empty array in dev mode)
precacheAndRoute((self as unknown as SwGlobalScope).__WB_MANIFEST || []);

if (import.meta.env.PROD) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('/index.html'), {
      denylist: [/^\/api\//, /^\/ws/],
    }),
  );
}

// StaleWhileRevalidate for same-origin static application assets for instant offline re-open
registerRoute(
  ({ sameOrigin, url, request }) =>
    sameOrigin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/ws') &&
    !url.pathname.startsWith('/@') &&
    !url.pathname.startsWith('/src/') &&
    !url.pathname.startsWith('/node_modules/') &&
    (request.destination === 'script' ||
      request.destination === 'style' ||
      request.destination === 'image' ||
      request.destination === 'font' ||
      request.destination === 'manifest' ||
      /\.(?:js|mjs|css|ico|png|svg|jpg|jpeg|webp|woff2?|webmanifest)$/i.test(
        url.pathname,
      )),
  new StaleWhileRevalidate({
    cacheName: 'kiremdata-static-assets',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 120,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
    ],
  }),
);

// CacheFirst for Google Fonts stylesheets and font files
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
    ],
  }),
);

// BackgroundSync queue for offline outgoing chat messages
const CHAT_OUTBOX_QUEUE_NAME = 'kiremdata-chat-outbox';

async function notifyWindowClients(message: unknown): Promise<void> {
  try {
    const clients = await swScope.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    for (const client of clients) {
      client.postMessage(message);
    }
  } catch {
    // Ignore client notification errors
  }
}

const chatOutboxQueue = new Queue(CHAT_OUTBOX_QUEUE_NAME, {
  maxRetentionTime: 24 * 60, // Keep failed chat payloads up to 24 hours
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        const response = await fetch(entry.request.clone());
        if (!response.ok && response.status >= 500) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.clone().json().catch(() => null)) as {
          id?: string;
          status?: string;
        } | null;

        await notifyWindowClients({
          type: 'CHAT_BG_SYNC_DELIVERED',
          payload: {
            id: data?.id,
            status: data?.status || 'delivered',
          },
        });
      } catch (err) {
        await queue.unshiftRequest(entry);
        throw err;
      }
    }
  },
});

registerRoute(
  ({ sameOrigin, url, request }) =>
    sameOrigin &&
    url.pathname === '/api/chat/messages' &&
    request.method === 'POST',
  async ({ request }) => {
    const requestClone = request.clone();
    try {
      const response = await fetch(requestClone);
      if (!response.ok && response.status >= 500) {
        throw new Error(`Server error ${response.status}`);
      }
      return response;
    } catch {
      await chatOutboxQueue.pushRequest({ request });
      const size = await chatOutboxQueue.size().catch(() => 1);
      await notifyWindowClients({
        type: 'CHAT_BG_SYNC_QUEUED',
        payload: { queueSize: size },
      });
      return new Response(
        JSON.stringify({ ok: true, queued: true, offline: true, queueSize: size }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  },
  'POST',
);

// Flush BackgroundSync queue immediately when any window fires the 'online' event
swScope.addEventListener('message', (event) => {
  const msgType = event.data?.type;
  if (msgType === 'SKIP_WAITING') {
    event.waitUntil(swScope.skipWaiting());
    return;
  }
  if (msgType === 'FLUSH_CHAT_OUTBOX') {
    event.waitUntil(chatOutboxQueue.replayRequests());
  }
});
