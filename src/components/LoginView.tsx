import { FormEvent, useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Loader2, Lock, ShieldCheck, User, X } from 'lucide-react';
import { AuthUser } from '../types/models';
import { api, ApiError, AuthStatusResponse, setAuthToken } from '../lib/api';

interface LoginViewProps {
  onAuthenticated: (user: AuthUser) => void;
  onClose?: () => void;
}

export function LoginView({ onAuthenticated, onClose }: LoginViewProps) {
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [username, setUsername] = useState('sahidin');
  const [password, setPassword] = useState('');
  const [piketPassword, setPiketPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getAuthStatus()
      .then((res) => {
        if (!mounted) return;
        setStatus(res);
        if (res.adminUsernames.length > 0) {
          setUsername(res.adminUsernames[0].username);
        }
      })
      .catch(() => {
        if (mounted) {
          setError('Gagal terhubung ke server autentikasi.');
        }
      })
      .finally(() => {
        if (mounted) setLoadingStatus(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleFirstRunClaim = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password Admin minimal 8 karakter.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.claimAdmin({
        username,
        password,
        piketPassword: piketPassword.trim() || undefined,
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Gagal mengaktifkan akun Admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.login(username, password);
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login gagal. Periksa kembali akun Admin Anda.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-indigo-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 z-10 rounded-xl bg-slate-100 p-2 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
            aria-label="Tutup Login Admin"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12">
          {/* Left Colorful Institutional Panel */}
          <div className="flex flex-col justify-between bg-gradient-to-br from-indigo-900 via-blue-900 to-cyan-800 p-7 text-white lg:col-span-5">
            <div>
              <p className="text-xs font-bold tracking-wider text-cyan-300 uppercase">
                Panel Administrator
              </p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight">
                Login Admin LapTrack
              </h2>
              <p className="mt-3 text-xs leading-relaxed text-indigo-100">
                Masuk sebagai Administrator untuk membuka menu Monitoring, Riwayat &amp; Suspend Siswa (dengan batas tanggal suspend), Pengaturan 3 Sesi Harian (Siang/Sore/Malam), Cetak PDF, dan Data Master.
              </p>
            </div>

            <div className="mt-6 space-y-3 border-t border-white/15 pt-5">
              <p className="text-xs font-bold text-cyan-200">
                4 Akun Admin Default
              </p>
              <ul className="space-y-1 text-xs text-indigo-100">
                <li>Sahidin · <span className="font-mono text-white">sahidin</span></li>
                <li>Anis Fahrurozi · <span className="font-mono text-white">anis.fahrurozi</span></li>
                <li>Fadly Muhammad · <span className="font-mono text-white">fadly.muhammad</span></li>
                <li>Yusufa Mardha · <span className="font-mono text-white">yusufa.mardha</span></li>
              </ul>
            </div>
          </div>

          {/* Right Form Panel */}
          <div className="p-6 sm:p-8 lg:col-span-7">
            {loadingStatus ? (
              <div className="flex min-h-[260px] items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-indigo-600" />
                Memeriksa status autentikasi Admin...
              </div>
            ) : status?.needsSetup ? (
              <div>
                <div className="flex items-center gap-2 text-indigo-700">
                  <ShieldCheck className="h-5 w-5" />
                  <h3 className="text-base font-extrabold text-slate-900">
                    Aktivasi Password Awal Admin
                  </h3>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  Tetapkan password awal satu kali untuk mengaktifkan ke-4 akun Admin (Sahidin, Anis Fahrurozi, Fadly Muhammad, Yusufa Mardha).
                </p>

                <form onSubmit={handleFirstRunClaim} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Pilih Akun Admin
                    </label>
                    <select
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-600"
                    >
                      {status.adminUsernames.map((adm) => (
                        <option key={adm.username} value={adm.username}>
                          {adm.name} ({adm.username})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Password Admin (Min. 8 Karakter)
                    </label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        required
                        minLength={8}
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Masukkan password Admin"
                        className="w-full rounded-xl border border-slate-200 py-2.5 pr-10 pl-10 text-sm outline-none focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Password Cadangan Pegawai <span className="font-normal text-slate-400">(opsional)</span>
                    </label>
                    <input
                      type={showPass ? 'text' : 'password'}
                      value={piketPassword}
                      onChange={(e) => setPiketPassword(e.target.value)}
                      placeholder="Kosongkan jika sama dengan Admin"
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-600"
                    />
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1">
                    {onClose && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Kembali ke Scan
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Aktifkan &amp; Masuk Admin
                    </button>
                  </div>
                </form>
              </div>
            ) : (
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Masuk Dashboard Administrator
                </h3>
                <p className="mt-1 text-xs text-slate-500">
                  Pilih cepat akun Admin di bawah dan masukkan password Anda.
                </p>

                <div className="mt-4">
                  <p className="mb-1.5 text-[11px] font-bold text-slate-500">
                    Pilih cepat username Admin:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {['sahidin', 'anis.fahrurozi', 'fadly.muhammad', 'yusufa.mardha'].map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUsername(u)}
                        className={`rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all ${
                          username === u
                            ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                            : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-700'
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleLogin} className="mt-5 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Username Admin
                    </label>
                    <div className="relative">
                      <User className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        required
                        autoComplete="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="contoh: sahidin"
                        className="w-full rounded-xl border border-slate-200 py-2.5 pr-3 pl-10 font-mono text-sm outline-none focus:border-indigo-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        required
                        autoComplete="current-password"
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Masukkan password Admin"
                        className="w-full rounded-xl border border-slate-200 py-2.5 pr-10 pl-10 text-sm outline-none focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((v) => !v)}
                        className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="flex gap-2.5 pt-1">
                    {onClose && (
                      <button
                        type="button"
                        onClick={onClose}
                        className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      >
                        Batal
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:from-indigo-700 hover:to-blue-700 disabled:opacity-60"
                    >
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Masuk sebagai Admin
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
