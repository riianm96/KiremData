import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { AccessGate } from './components/AccessGate';
import {
  notifyPwaNeedRefresh,
  notifyPwaOfflineReady,
} from './hooks/useOnlineStatus';
import './index.css';

if (import.meta.env.DEV && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then(async (registrations) => {
      const devRegs = registrations.filter(
        (reg) =>
          reg.active?.scriptURL.includes('dev-sw.js') ||
          reg.installing?.scriptURL.includes('dev-sw.js') ||
          reg.waiting?.scriptURL.includes('dev-sw.js'),
      );
      if (devRegs.length === 0) return;
      await Promise.all(devRegs.map((reg) => reg.unregister()));
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if (navigator.serviceWorker.controller && !sessionStorage.getItem('kd_sw_dev_cleaned')) {
        sessionStorage.setItem('kd_sw_dev_cleaned', '1');
        window.location.reload();
      }
    })
    .catch(() => {});
} else {
  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      notifyPwaOfflineReady();
    },
    onNeedRefresh() {
      notifyPwaNeedRefresh(updateSW);
    },
  });
}

createRoot(document.getElementById('root')!).render(
  <AccessGate>
    <App />
  </AccessGate>,
);
