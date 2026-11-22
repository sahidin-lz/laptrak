import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Home,
  Search,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import {
  LAPTOP_PURPOSES,
  Laptop,
  MAX_LATE_STRIKES,
  StaffRole,
  Student,
  Transaction,
  TransactionType,
  Wilayah,
  WILAYAH_LABELS,
} from '../types/models';
import {
  formatDateOnly,
  formatDateTimeID,
  formatDuration,
  formatTimeOnly,
  isStudentCurrentlySuspended,
} from '../lib/store';
import { SuspendStudentModal } from './SuspendStudentModal';

interface HistoryDashboardViewProps {
  students: Student[];
  laptops: Laptop[];
  transactions: Transaction[];
  userRole: StaffRole;
  onSuspendStudent: (
    studentId: string,
    payload: { suspended_until: string; reason: string }
  ) => Promise<void>;
  onResetSanction: (studentId: string) => Promise<void>;
}

export function HistoryDashboardView({
  students,
  laptops,
  transactions,
  userRole,
  onSuspendStudent,
  onResetSanction,
}: HistoryDashboardViewProps) {
  const [wilayahFilter, setWilayahFilter] = useState<'ALL' | Wilayah>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | TransactionType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'ontime' | 'late'>('all');
  const [purposeFilter, setPurposeFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [suspendTargetStudent, setSuspendTargetStudent] = useState<Student | null>(null);
  const [quickPickStudentId, setQuickPickStudentId] = useState<string>('');

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const laptopMap = useMemo(() => new Map(laptops.map((l) => [l.id, l])), [laptops]);

  // Scope students & transactions by selected Wilayah
  const scopedStudents = useMemo(
    () =>
      wilayahFilter === 'ALL'
        ? students
        : students.filter((s) => s.wilayah === wilayahFilter),
    [students, wilayahFilter]
  );

  const scopedTransactions = useMemo(
    () =>
      wilayahFilter === 'ALL'
        ? transactions
        : transactions.filter((tx) => tx.wilayah === wilayahFilter),
    [transactions, wilayahFilter]
  );

  // Usage & punctuality KPIs
  const metrics = useMemo(() => {
    const total = scopedTransactions.length;
    const active = scopedTransactions.filter((t) => t.status === 'active').length;
    const returned = scopedTransactions.filter((t) => t.status === 'returned');
    const lateReturned = returned.filter((t) => t.is_late).length;
    const onTimeReturned = returned.length - lateReturned;
    const onTimeRate =
      returned.length > 0 ? Math.round((onTimeReturned / returned.length) * 100) : 100;
    const suspendedStudents = scopedStudents.filter((s) =>
      isStudentCurrentlySuspended(s)
    ).length;
    const homeLeaveTotal = scopedTransactions.filter(
      (t) => t.transaction_type === 'pulang'
    ).length;

    return { total, active, lateReturned, onTimeRate, suspendedStudents, homeLeaveTotal };
  }, [scopedTransactions, scopedStudents]);

  // Session & Purpose breakdown (Sesi Siang, Sesi Sore, Sesi Malam, Bawa Pulang)
  const sessionStats = useMemo(() => {
    const categories = [
      { key: 'siang', label: 'Sesi Siang', color: 'bg-amber-500' },
      { key: 'sore', label: 'Sesi Sore', color: 'bg-emerald-600' },
      { key: 'malam', label: 'Sesi Malam', color: 'bg-indigo-600' },
      { key: 'pulang', label: 'Membawa Laptop Pulang', color: 'bg-violet-600' },
    ];
    const counts = new Map<string, number>();
    categories.forEach((c) => counts.set(c.key, 0));
    scopedTransactions.forEach((t) => {
      if (t.transaction_type === 'pulang') {
        counts.set('pulang', (counts.get('pulang') || 0) + 1);
      } else if (t.daily_session) {
        counts.set(t.daily_session, (counts.get(t.daily_session) || 0) + 1);
      } else {
        counts.set('sore', (counts.get('sore') || 0) + 1);
      }
    });
    const maxCount = Math.max(1, ...Array.from(counts.values()));
    return categories.map((c) => ({
      ...c,
      count: counts.get(c.key) || 0,
      pct: Math.round(((counts.get(c.key) || 0) / maxCount) * 100),
    }));
  }, [scopedTransactions]);

  // Students with >= 1 late strike or suspended
  const flaggedStudents = useMemo(() => {
    return [...scopedStudents]
      .filter((s) => s.late_count > 0 || isStudentCurrentlySuspended(s))
      .sort((a, b) => {
        const aSusp = isStudentCurrentlySuspended(a);
        const bSusp = isStudentCurrentlySuspended(b);
        if (aSusp !== bSusp) return aSusp ? -1 : 1;
        return b.late_count - a.late_count;
      });
  }, [scopedStudents]);

  const filteredHistory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nowMs = Date.now();

    return [...scopedTransactions]
      .sort((a, b) => new Date(b.borrow_time).getTime() - new Date(a.borrow_time).getTime())
      .filter((tx) => {
        if (typeFilter !== 'ALL' && tx.transaction_type !== typeFilter) return false;

        const isOverdueNow =
          tx.status === 'active' && new Date(tx.due_time).getTime() < nowMs;
        const isLateRecord = tx.is_late || isOverdueNow;

        if (statusFilter === 'active' && tx.status !== 'active') return false;
        if (statusFilter === 'late' && !isLateRecord) return false;
        if (statusFilter === 'ontime' && (tx.status !== 'returned' || tx.is_late)) return false;

        if (purposeFilter !== 'ALL' && !tx.purpose.includes(purposeFilter)) return false;

        if (!q) return true;
        const st = studentMap.get(tx.student_id);
        const lp = laptopMap.get(tx.laptop_id);
        return (
          (st?.name.toLowerCase().includes(q) ?? false) ||
          (st?.student_code.toLowerCase().includes(q) ?? false) ||
          (st?.class.toLowerCase().includes(q) ?? false) ||
          (lp?.asset_code.toLowerCase().includes(q) ?? false) ||
          tx.purpose.toLowerCase().includes(q) ||
          (tx.home_note?.toLowerCase().includes(q) ?? false) ||
          tx.piket_name.toLowerCase().includes(q) ||
          (tx.return_piket_name?.toLowerCase().includes(q) ?? false)
        );
      });
  }, [
    scopedTransactions,
    typeFilter,
    statusFilter,
    purposeFilter,
    search,
    studentMap,
    laptopMap,
  ]);

  const handleResetClick = async (studentId: string) => {
    setResettingId(studentId);
    try {
      await onResetSanction(studentId);
    } finally {
      setResettingId(null);
    }
  };

  const handleExportCsv = () => {
    const header =
      'Kode Siswa,Nama Siswa,Kelas,Wilayah,Kode Laptop,Jenis Transaksi,Sesi / Peruntukan,Catatan Pulang,Waktu Ambil,Batas Jam Telat,Waktu Kembali,Durasi,Ketepatan,Guru Piket Ambil,Guru Piket Kembali\n';
    const rows = filteredHistory
      .map((tx) => {
        const st = studentMap.get(tx.student_id);
        const lp = laptopMap.get(tx.laptop_id);
        const punctuality =
          tx.status === 'active'
            ? 'Sedang Dipinjam'
            : tx.is_late
            ? `Terlambat ${tx.late_minutes} menit`
            : 'Tepat Waktu';
        return [
          st?.student_code || '-',
          `"${st?.name || '-'}"`,
          `"${st?.class || '-'}"`,
          `"${WILAYAH_LABELS[tx.wilayah]}"`,
          lp?.asset_code || '-',
          `"${tx.transaction_type === 'pulang' ? 'Membawa Laptop Pulang' : 'Penggunaan Harian'}"`,
          `"${tx.purpose}"`,
          `"${(tx.home_note || '-').replace(/"/g, '""')}"`,
          `"${formatDateTimeID(tx.borrow_time)}"`,
          `"${tx.transaction_type === 'pulang' ? formatDateOnly(tx.due_time) : formatTimeOnly(tx.due_time)}"`,
          `"${formatDateTimeID(tx.return_time)}"`,
          `"${formatDuration(tx.borrow_time, tx.return_time)}"`,
          `"${punctuality}"`,
          `"${tx.piket_name}"`,
          `"${tx.return_piket_name || '-'}"`,
        ].join(',');
      })
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dashboard-riwayat-laptop-${wilayahFilter.toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Colorful Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-purple-800 to-rose-700 p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-extrabold tracking-wider text-rose-200 uppercase">
              Audit &amp; Penegakan Disiplin
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              Dashboard Riwayat &amp; Manajemen Suspend Siswa
            </h2>
            <p className="mt-1 text-xs text-indigo-100 sm:text-sm">
              Berikan sanksi suspend kepada siswa yang melanggar dan pilih batas waktu suspend sampai kapan, atau cabut suspend kapan saja.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center rounded-xl bg-white/15 p-1 backdrop-blur-xs">
              {(
                [
                  { id: 'ALL', label: 'Semua Wilayah' },
                  { id: 'putra', label: 'Wilayah Putra' },
                  { id: 'putri', label: 'Wilayah Putri' },
                ] as const
              ).map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setWilayahFilter(w.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-extrabold whitespace-nowrap transition-all ${
                    wilayahFilter === w.id
                      ? 'bg-white text-indigo-950 shadow-xs'
                      : 'text-white/85 hover:text-white'
                  }`}
                >
                  {w.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-extrabold text-indigo-900 shadow-sm transition-colors hover:bg-indigo-50"
            >
              <Download className="h-3.5 w-3.5" />
              Unduh CSV
            </button>
          </div>
        </div>
      </div>

      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-slate-500">Total Sesi</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-slate-900 tabular-nums">
            {metrics.total}
          </p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-blue-700">Sedang Dipinjam</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-blue-700 tabular-nums">
            {metrics.active}
          </p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-violet-700">Bawa Pulang</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-violet-700 tabular-nums">
            {metrics.homeLeaveTotal}
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-emerald-700">Tepat Waktu</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-emerald-700 tabular-nums">
            {metrics.onTimeRate}%
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-amber-700">Kasus Telat</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-amber-600 tabular-nums">
            {metrics.lateReturned}
          </p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-extrabold text-rose-700">Siswa Di-Suspend</p>
          <p className="mt-1.5 font-mono text-2xl font-extrabold text-rose-700 tabular-nums">
            {metrics.suspendedStudents}
          </p>
        </div>
      </div>

      {/* Middle Analytical Row: Sanction & Suspend Manager + 3 Daily Sessions Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Suspend & Sanction Manager */}
        <section className="rounded-2xl border border-rose-100 bg-white p-5 shadow-xs lg:col-span-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Daftar Siswa Di-Suspend &amp; Catatan Terlambat
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Admin dapat memberikan suspend ke siswa mana pun dan menentukan batas waktu suspend sampai kapan.
              </p>
            </div>
          </div>

          {/* Quick Suspend Picker for Any Student */}
          {userRole === 'admin' && (
            <div className="mt-4 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 sm:flex-row sm:items-center">
              <select
                value={quickPickStudentId}
                onChange={(e) => setQuickPickStudentId(e.target.value)}
                className="flex-1 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-rose-600"
              >
                <option value="">-- Pilih Siswa untuk Diberikan Suspend --</option>
                {scopedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.student_code} · {s.name} ({s.class} ·{' '}
                    {s.wilayah === 'putra' ? 'Putra' : 'Putri'})
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!quickPickStudentId}
                onClick={() => {
                  const found = students.find((s) => s.id === quickPickStudentId);
                  if (found) setSuspendTargetStudent(found);
                }}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2 text-xs font-extrabold text-white shadow-xs transition-all hover:from-rose-700 hover:to-red-700 disabled:opacity-40"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Atur Waktu Suspend
              </button>
            </div>
          )}

          {flaggedStudents.length === 0 ? (
            <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-xs font-bold text-emerald-800">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <span>Semua siswa pada filter wilayah ini tertib. Belum ada siswa yang di-suspend.</span>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {flaggedStudents.map((st) => {
                const blocked = isStudentCurrentlySuspended(st);
                const warningLast = !blocked && st.late_count === MAX_LATE_STRIKES - 1;
                return (
                  <div
                    key={st.id}
                    className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {blocked ? (
                          <Ban className="h-4 w-4 shrink-0 text-rose-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                        )}
                        <span className="truncate text-xs font-extrabold text-slate-900">
                          {st.name}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-slate-500">
                          {st.student_code} · {st.class} ·{' '}
                          {st.wilayah === 'putra' ? 'Putra' : 'Putri'}
                        </span>
                      </div>
                      <p
                        className={`mt-1 text-xs font-bold ${
                          blocked
                            ? 'text-rose-700'
                            : warningLast
                            ? 'text-amber-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {blocked
                          ? `DI-SUSPEND s/d ${
                              st.suspended_until
                                ? formatDateOnly(st.suspended_until)
                                : 'Dibuka Admin'
                            } · ${st.suspended_reason || `Terlambat ${st.late_count}×`}`
                          : warningLast
                          ? `Peringatan Terakhir (${st.late_count}/${MAX_LATE_STRIKES} telat) — 1× telat lagi otomatis di-suspend.`
                          : `Catatan Terlambat: ${st.late_count}/${MAX_LATE_STRIKES} kali.`}
                      </p>
                    </div>

                    {userRole === 'admin' && (
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSuspendTargetStudent(st)}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-extrabold text-rose-700 transition-colors hover:bg-rose-100"
                        >
                          <CalendarClock className="h-3.5 w-3.5" />
                          {blocked ? 'Ubah Batas Suspend' : 'Suspend'}
                        </button>
                        <button
                          type="button"
                          disabled={resettingId === st.id}
                          onClick={() => handleResetClick(st.id)}
                          className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white transition-colors hover:bg-emerald-700"
                        >
                          <Unlock className="h-3.5 w-3.5" />
                          {blocked ? 'Cabut Suspend' : 'Reset Telat'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Usage Distribution by 3 Daily Sessions + Bawa Pulang */}
        <section className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-xs lg:col-span-5">
          <h3 className="text-sm font-extrabold text-slate-900">
            Statistik 3 Sesi Harian &amp; Bawa Pulang
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Distribusi penggunaan laptop berdasarkan Sesi Siang, Sore, Malam, dan Bawa Pulang.
          </p>

          <div className="mt-4 space-y-3.5">
            {sessionStats.map((item) => (
              <div key={item.key}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">{item.label}</span>
                  <span className="font-mono font-extrabold text-slate-900 tabular-nums">
                    {item.count} sesi
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all ${item.color}`}
                    style={{ width: `${item.count === 0 ? 0 : Math.max(8, item.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Full Searchable Audit Trail History Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'active', label: 'Aktif' },
                  { id: 'ontime', label: 'Tepat Waktu' },
                  { id: 'late', label: 'Terlambat' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-extrabold whitespace-nowrap transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'ALL' | TransactionType)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-600"
            >
              <option value="ALL">Semua Jenis</option>
              <option value="harian">Penggunaan Harian</option>
              <option value="pulang">Bawa Pulang</option>
            </select>

            <select
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-indigo-600"
            >
              <option value="ALL">Semua Sesi / Peruntukan</option>
              {LAPTOP_PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
              <option value="Bawa Pulang">Bawa Pulang ke Rumah</option>
            </select>
          </div>

          <div className="relative w-full xl:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari siswa, laptop, catatan, piket..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-8 text-xs outline-none focus:border-indigo-600"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-5 py-3 font-extrabold">Siswa &amp; Wilayah</th>
                <th className="px-4 py-3 font-extrabold">Laptop</th>
                <th className="px-4 py-3 font-extrabold">Jenis &amp; Sesi</th>
                <th className="px-4 py-3 font-extrabold">Ambil / Batas Jam Telat</th>
                <th className="px-4 py-3 font-extrabold">Kembali &amp; Durasi</th>
                <th className="px-4 py-3 font-extrabold">Guru Piket (Audit)</th>
                <th className="px-5 py-3 font-extrabold">Ketepatan &amp; Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    Tidak ada catatan riwayat penggunaan sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredHistory.map((tx) => {
                  const st = studentMap.get(tx.student_id);
                  const lp = laptopMap.get(tx.laptop_id);
                  const isOverdueNow =
                    tx.status === 'active' &&
                    new Date(tx.due_time).getTime() < Date.now();
                  const isHomeLeave = tx.transaction_type === 'pulang';

                  return (
                    <tr key={tx.id} className="transition-colors hover:bg-indigo-50/30">
                      <td className="px-5 py-3">
                        <p className="font-extrabold text-slate-900">
                          {st?.name || 'Siswa Terhapus'}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          <span className="font-mono font-bold text-indigo-700">
                            {st?.student_code || '—'}
                          </span>{' '}
                          · {st?.class || '—'} ·{' '}
                          <span
                            className={`font-bold ${
                              tx.wilayah === 'putra' ? 'text-sky-700' : 'text-fuchsia-700'
                            }`}
                          >
                            {tx.wilayah === 'putra' ? 'Putra' : 'Putri'}
                          </span>
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-mono font-extrabold text-slate-900">
                          {lp?.asset_code || '—'}
                        </p>
                        <p className="text-[11px] text-slate-500">{lp?.brand_model || '—'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className={`inline-flex items-center gap-1 font-extrabold ${
                            isHomeLeave ? 'text-violet-700' : 'text-blue-700'
                          }`}
                        >
                          {isHomeLeave ? (
                            <Home className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <BookOpen className="h-3.5 w-3.5 shrink-0" />
                          )}
                          <span>{isHomeLeave ? 'Bawa Pulang' : 'Harian'}</span>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-700">{tx.purpose}</p>
                        {tx.home_note && (
                          <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-violet-700">
                            {tx.home_note}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        <div>{formatDateTimeID(tx.borrow_time)}</div>
                        <div className="font-bold text-slate-700">
                          Batas:{' '}
                          {isHomeLeave
                            ? formatDateOnly(tx.due_time)
                            : formatTimeOnly(tx.due_time)}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-600 tabular-nums">
                        <div>{formatDateTimeID(tx.return_time)}</div>
                        <div className="text-slate-400">
                          Durasi: {formatDuration(tx.borrow_time, tx.return_time)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-600">
                        <div>
                          Serah:{' '}
                          <span className="font-bold text-slate-800">{tx.piket_name}</span>
                        </div>
                        {tx.return_piket_name && (
                          <div>
                            Terima:{' '}
                            <span className="font-bold text-slate-800">
                              {tx.return_piket_name}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {tx.status === 'active' ? (
                            isOverdueNow ? (
                              <span className="inline-flex items-center gap-1 font-extrabold text-rose-700">
                                <Clock className="h-3.5 w-3.5" />
                                Lewat Batas
                              </span>
                            ) : (
                              <span className="font-extrabold text-blue-700">Dipinjam</span>
                            )
                          ) : tx.is_late ? (
                            <span className="inline-flex items-center gap-1 font-extrabold text-rose-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Telat {tx.late_minutes} mnt
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-extrabold text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Tepat Waktu
                            </span>
                          )}

                          {userRole === 'admin' && st && (
                            <button
                              type="button"
                              onClick={() => setSuspendTargetStudent(st)}
                              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                            >
                              Suspend
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {suspendTargetStudent && (
        <SuspendStudentModal
          student={suspendTargetStudent}
          onClose={() => setSuspendTargetStudent(null)}
          onConfirmSuspend={onSuspendStudent}
        />
      )}
    </div>
  );
}
