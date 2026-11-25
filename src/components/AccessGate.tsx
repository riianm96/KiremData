import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LockKeyhole } from 'lucide-react';

interface AccessGateProps {
  children: ReactNode;
}

export function AccessGate({ children }: AccessGateProps) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isEmbeddedFrame = () => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  };

  const checkSession = async (expiredNotice = false) => {
    setError('');
    try {
      const embeddedQuery = isEmbeddedFrame() ? '?embedded=1' : '';
      const response = await fetch(`/api/auth/session${embeddedQuery}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Server tidak dapat memeriksa sesi.');
      const result = (await response.json()) as {
        authenticated?: boolean;
        requireAccessCode?: boolean;
        configError?: string;
      };
      const isAuthed = Boolean(result.authenticated) && !result.configError;
      setAuthenticated(isAuthed);
      if (result.configError) {
        setError(result.configError);
      } else if (!isAuthed && expiredNotice) {
        setError('Sesi berakhir atau server dimulai ulang. Silakan masuk kembali.');
      }
    } catch {
      setAuthenticated(false);
      setError('Tidak dapat terhubung ke KiremData Hub. Pastikan server aktif lalu coba lagi.');
    }
  };

  useEffect(() => {
    void checkSession();
    const handleAuthRequired = () => {
      setAccessCode('');
      void checkSession(true);
    };
    window.addEventListener('kiremdata:auth-required', handleAuthRequired);
    return () => {
      window.removeEventListener('kiremdata:auth-required', handleAuthRequired);
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const embedded = isEmbeddedFrame();
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode, embedded }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Gagal masuk ke KiremData.');
      setAccessCode('');
      setAuthenticated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Gagal masuk ke KiremData.');
    } finally {
      setBusy(false);
    }
  };

  if (authenticated === null) {
    return <div className="min-h-screen bg-[#0B141A]" aria-label="Memeriksa sesi KiremData" />;
  }
  if (authenticated) return <>{children}</>;
  if (
    typeof window !== 'undefined' &&
    (!window.isSecureContext || !window.crypto?.subtle || !window.indexedDB)
  ) {
    return (
      <main className="min-h-screen bg-[#0B141A] text-[#E9EDEF] flex items-center justify-center p-5">
        <section className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111B21] p-6 text-center">
          <LockKeyhole className="mx-auto mb-4 h-8 w-8 text-[#00A884]" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Koneksi aman diperlukan</h1>
          <p className="mt-2 text-sm leading-relaxed text-[#AEBAC1]">
            Enkripsi dan penyimpanan kunci KiremData memerlukan Web Crypto dan IndexedDB. Buka localhost atau gunakan HTTPS yang sertifikatnya dipercaya pada jaringan LAN/VPN.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0B141A] text-[#E9EDEF] flex items-center justify-center p-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111B21] p-6 shadow-2xl"
      >
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#00A884]/15 text-[#00A884]">
          <LockKeyhole aria-hidden="true" />
        </div>
        <h1 className="text-center text-xl font-semibold">Masuk ke jaringan KiremData</h1>
        <p className="mt-2 text-center text-sm text-[#AEBAC1]">
          Masukkan kode akses yang diberikan pengelola hub.
        </p>
        <label htmlFor="kiremdata-access-code" className="mt-5 block text-sm font-medium">
          Kode akses
        </label>
        <input
          id="kiremdata-access-code"
          type="password"
          autoComplete="current-password"
          required
          value={accessCode}
          onChange={(event) => setAccessCode(event.target.value)}
          className="mt-2 w-full rounded-lg border border-white/15 bg-[#0B141A] px-3 py-2.5 outline-none focus:border-[#00A884]"
        />
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy || !accessCode}
          className="mt-5 w-full rounded-lg bg-[#00A884] px-4 py-2.5 font-semibold text-[#0B141A] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
        {error && (
          <button type="button" onClick={() => void checkSession()} className="mt-3 w-full text-sm text-[#AEBAC1] hover:text-white">
            Coba hubungkan kembali
          </button>
        )}
      </form>
    </main>
  );
}
