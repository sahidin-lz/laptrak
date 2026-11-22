import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  BookOpen,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Home,
  Laptop as LaptopIcon,
  RotateCcw,
  Search,
  ShieldAlert,
  Unlock,
} from 'lucide-react';
import {
  DailySessionConfig,
  Laptop,
  MAX_LATE_STRIKES,
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

interface MonitoringViewProps {
  students: Student[];
  laptops: Laptop[];
  dailySessions: DailySessionConfig[];
  transactions: Transaction[];
  onManualReturn: (
    studentId: string,
    laptopId: string,
    simulateLateMinutes?: number
  ) => Promise<void>;
  onSuspendStudent: (
    studentId: string,
    payload: { suspended_until: string; reason: string }
  ) => Promise<void>;
  onResetSanction: (studentId: string) => Promise<void>;
}

type DatabaseSectionTab = 'pemakaian_lengkap' | 'tracking_laptop' | 'suspend_siswa';
type UsageFilterMode = 'all' | 'active' | 'returned' | 'pulang' | 'late';

export function MonitoringView({
  students,
  laptops,
  dailySessions,
  transactions,
  onManualReturn,
  onSuspendStudent,
  onResetSanction,
}: MonitoringViewProps) {
  const [sectionTab, setSectionTab] = useState<DatabaseSectionTab>('pemakaian_lengkap');
  const [usageFilter, setUsageFilter] = useState<UsageFilterMode>('all');
  const [wilayahFilter, setWilayahFilter] = useState<'ALL' | Wilayah>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | TransactionType>('ALL');
  const [laptopTrackFilter, setLaptopTrackFilter] = useState<
    'ALL' | 'available' | 'harian' | 'pulang'
  >('ALL');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suspendModalStudent, setSuspendModalStudent] = useState<Student | null>(null);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const laptopMap = useMemo(() => new Map(laptops.map((l) => [l.id, l])), [laptops]);

  // Scope laptop counters to selected Wilayah
  const scopedLaptops = useMemo(() => {
    if (wilayahFilter === 'ALL') return laptops;
    return laptops.filter((l) => {
      const owner = l.assigned_student_id ? studentMap.get(l.assigned_student_id) : undefined;
      return owner?.wilayah === wilayahFilter;
    });
  }, [laptops, studentMap, wilayahFilter]);

  const activeCount = useMemo(
    () => scopedLaptops.filter((l) => l.status === 'borrowed').length,
    [scopedLaptops]
  );
  const availableCount = useMemo(
    () => scopedLaptops.filter((l) => l.status === 'available').length,
    [scopedLaptops]
  );

  const activeHomeCount = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.status === 'active' &&
          tx.transaction_type === 'pulang' &&
          (wilayahFilter === 'ALL' || tx.wilayah === wilayahFilter)
      ).length,
    [transactions, wilayahFilter]
  );

  const returnedHomeCount = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.status === 'returned' &&
          tx.transaction_type === 'pulang' &&
          (wilayahFilter === 'ALL' || tx.wilayah === wilayahFilter)
      ).length,
    [transactions, wilayahFilter]
  );

  // Live Recap of Active Laptops Grouped by Session (Khusus Admin)
  const activeSessionRecap = useMemo(() => {
    const activeTxs = transactions.filter(
      (t) =>
        t.status === 'active' &&
        (wilayahFilter === 'ALL' || t.wilayah === wilayahFilter)
    );

    const buckets: Array<{
      id: string;
      title: string;
      subtitle: string;
      accentClass: string;
      badgeClass: string;
      items: Array<{
        tx: Transaction;
        student: Student | undefined;
        laptop: Laptop | undefined;
      }>;
    }> = [
      {
        id: 'siang',
        title: 'Sesi Siang',
        subtitle: `Batas ${
          dailySessions.find((s) => s.key === 'siang')?.deadline_time || '14:30'
        }`,
        accentClass: 'border-amber-200 bg-amber-50/40',
        badgeClass: 'bg-amber-600 text-white',
        items: [],
      },
      {
        id: 'sore',
        title: 'Sesi Sore',
        subtitle: `Batas ${
          dailySessions.find((s) => s.key === 'sore')?.deadline_time || '17:30'
        }`,
        accentClass: 'border-emerald-200 bg-emerald-50/40',
        badgeClass: 'bg-emerald-600 text-white',
        items: [],
      },
      {
        id: 'malam',
        title: 'Sesi Malam',
        subtitle: `Batas ${
          dailySessions.find((s) => s.key === 'malam')?.deadline_time || '21:30'
        }`,
        accentClass: 'border-indigo-200 bg-indigo-50/40',
        badgeClass: 'bg-indigo-600 text-white',
        items: [],
      },
      {
        id: 'kegiatan_lainnya',
        title: 'Kegiatan Lainnya',
        subtitle: 'Ditulis Siswa',
        accentClass: 'border-cyan-200 bg-cyan-50/40',
        badgeClass: 'bg-cyan-700 text-white',
        items: [],
      },
      {
        id: 'pulang',
        title: 'Membawa Pulang',
        subtitle: 'Kepulangan Aktif',
        accentClass: 'border-violet-200 bg-violet-50/40',
        badgeClass: 'bg-violet-700 text-white',
        items: [],
      },
    ];

    const bucketMap = new Map(buckets.map((b) => [b.id, b]));

    for (const tx of activeTxs) {
      const student = studentMap.get(tx.student_id);
      const laptop = laptopMap.get(tx.laptop_id);
      if (tx.transaction_type === 'pulang') {
        bucketMap.get('pulang')?.items.push({ tx, student, laptop });
      } else if (tx.daily_session === 'kegiatan_lainnya' || tx.custom_activity) {
        bucketMap.get('kegiatan_lainnya')?.items.push({ tx, student, laptop });
      } else if (tx.daily_session && bucketMap.has(tx.daily_session)) {
        bucketMap.get(tx.daily_session)?.items.push({ tx, student, laptop });
      } else {
        bucketMap.get('sore')?.items.push({ tx, student, laptop });
      }
    }

    return {
      totalActive: activeTxs.length,
      buckets,
    };
  }, [transactions, dailySessions, wilayahFilter, studentMap, laptopMap]);

  // Complete usage transaction list
  const filteredUsageList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...transactions]
      .sort((a, b) => new Date(b.borrow_time).getTime() - new Date(a.borrow_time).getTime())
      .filter((tx) => {
        if (wilayahFilter !== 'ALL' && tx.wilayah !== wilayahFilter) return false;
        if (typeFilter !== 'ALL' && tx.transaction_type !== typeFilter) return false;
        if (usageFilter === 'active' && tx.status !== 'active') return false;
        if (usageFilter === 'returned' && tx.status !== 'returned') return false;
        if (usageFilter === 'pulang' && tx.transaction_type !== 'pulang') return false;
        if (usageFilter === 'late' && !tx.is_late) return false;

        if (!q) return true;
        const st = studentMap.get(tx.student_id);
        const lp = laptopMap.get(tx.laptop_id);
        return (
          (st?.name.toLowerCase().includes(q) ?? false) ||
          (st?.student_code.toLowerCase().includes(q) ?? false) ||
          (st?.class.toLowerCase().includes(q) ?? false) ||
          (lp?.asset_code.toLowerCase().includes(q) ?? false) ||
          (lp?.brand_model.toLowerCase().includes(q) ?? false) ||
          tx.purpose.toLowerCase().includes(q) ||
          (tx.custom_activity?.toLowerCase().includes(q) ?? false) ||
          (tx.home_note?.toLowerCase().includes(q) ?? false) ||
          tx.piket_name.toLowerCase().includes(q) ||
          (tx.return_piket_name?.toLowerCase().includes(q) ?? false)
        );
      });
  }, [
    transactions,
    usageFilter,
    wilayahFilter,
    typeFilter,
    search,
    studentMap,
    laptopMap,
  ]);

  // Complete laptop tracking records (all laptops with active/last transaction, owner, usage count)
  const laptopTrackingRecords = useMemo(() => {
    const q = search.trim().toLowerCase();

    return laptops
      .map((laptop) => {
        const owner = laptop.assigned_student_id
          ? studentMap.get(laptop.assigned_student_id) || null
          : null;
        const laptopTxs = transactions
          .filter((t) => t.laptop_id === laptop.id)
          .sort(
            (a, b) => new Date(b.borrow_time).getTime() - new Date(a.borrow_time).getTime()
          );
        const activeTx = laptopTxs.find((t) => t.status === 'active') || null;
        const lastTx = activeTx || laptopTxs[0] || null;
        const lastBorrower = lastTx ? studentMap.get(lastTx.student_id) || null : null;

        const trackingState: 'available' | 'harian' | 'pulang' =
          laptop.status === 'borrowed' && activeTx
            ? activeTx.transaction_type === 'pulang'
              ? 'pulang'
              : 'harian'
            : laptop.status === 'borrowed'
            ? 'harian'
            : 'available';

        return {
          laptop,
          owner,
          activeTx,
          lastTx,
          lastBorrower,
          totalUsageCount: laptopTxs.length,
          lateReturnCount: laptopTxs.filter((t) => t.is_late).length,
          trackingState,
        };
      })
      .filter((item) => {
        if (wilayahFilter !== 'ALL') {
          const itemWilayah = item.owner?.wilayah || item.lastTx?.wilayah;
          if (itemWilayah !== wilayahFilter) return false;
        }
        if (laptopTrackFilter !== 'ALL' && item.trackingState !== laptopTrackFilter) {
          return false;
        }
        if (!q) return true;
        return (
          item.laptop.asset_code.toLowerCase().includes(q) ||
          item.laptop.brand_model.toLowerCase().includes(q) ||
          (item.owner?.name.toLowerCase().includes(q) ?? false) ||
          (item.owner?.student_code.toLowerCase().includes(q) ?? false) ||
          (item.owner?.class.toLowerCase().includes(q) ?? false) ||
          (item.lastTx?.purpose.toLowerCase().includes(q) ?? false)
        );
      });
  }, [laptops, transactions, studentMap, wilayahFilter, laptopTrackFilter, search]);

  const filteredStudentsForSuspend = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((s) => (wilayahFilter === 'ALL' ? true : s.wilayah === wilayahFilter))
      .filter((s) => {
        if (!q) return true;
        return (
          s.name.toLowerCase().includes(q) ||
          s.student_code.toLowerCase().includes(q) ||
          s.class.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aSusp = isStudentCurrentlySuspended(a) ? 1 : 0;
        const bSusp = isStudentCurrentlySuspended(b) ? 1 : 0;
        if (aSusp !== bSusp) return bSusp - aSusp;
        return b.late_count - a.late_count;
      });
  }, [students, wilayahFilter, search]);

  const handleReturnClick = async (tx: Transaction, lateMinutes = 0) => {
    setBusyId(tx.id);
    try {
      await onManualReturn(tx.student_id, tx.laptop_id, lateMinutes);
    } finally {
      setBusyId(null);
    }
  };

  const handleExportUsageCsv = () => {
    const headers = [
      'ID Transaksi',
      'Wilayah',
      'Jenis Pemakaian',
      'Status Kepulangan / Pemakaian',
      'Sesi / Keperluan',
      'Kegiatan / Catatan Pulang',
      'Kode Siswa',
      'Nama Siswa',
      'Kelas',
      'Kode Laptop',
      'Merk Laptop',
      'Waktu Ambil',
      'Batas Waktu',
      'Waktu Kembali',
      'Status Keterlambatan',
      'Menit Terlambat',
      'Guru Piket Serah',
      'Guru Piket Terima',
    ];
    const rows = filteredUsageList.map((tx) => {
      const st = studentMap.get(tx.student_id);
      const lp = laptopMap.get(tx.laptop_id);
      const statusLabel =
        tx.transaction_type === 'pulang'
          ? tx.status === 'active'
            ? 'SEDANG DIBAWA PULANG'
            : 'SUDAH KEMBALI DARI KEPULANGAN'
          : tx.status === 'active'
          ? 'SEDANG DIPAKAI SESI HARIAN'
          : 'SUDAH DIKEMBALIKAN';
      return [
        tx.id,
        WILAYAH_LABELS[tx.wilayah],
        tx.transaction_type === 'pulang' ? 'Kepulangan (Bawa Pulang)' : 'Penggunaan Harian',
        statusLabel,
        tx.purpose,
        tx.custom_activity || tx.home_note || '-',
        st?.student_code || '-',
        st?.name || '-',
        st?.class || '-',
        lp?.asset_code || '-',
        lp?.brand_model || '-',
        formatDateTimeID(tx.borrow_time),
        formatDateTimeID(tx.due_time),
        tx.return_time ? formatDateTimeID(tx.return_time) : 'Masih Dipinjam',
        tx.status === 'active' ? 'Aktif' : tx.is_late ? 'Terlambat' : 'Tepat Waktu',
        String(tx.late_minutes || 0),
        tx.piket_name,
        tx.return_piket_name || '-',
      ];
    });
    const csv = `\uFEFFsep=;\r\n${[headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `database-pemakaian-laptop-lengkap-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportLaptopTrackingCsv = () => {
    const headers = [
      'Kode Barcode Tas Laptop',
      'Merk & Tipe Laptop',
      'Status Tracking Saat Ini',
      'Kode Siswa Pemilik',
      'Nama Siswa Pemilik',
      'Kelas',
      'Wilayah',
      'Sesi / Keperluan Terakhir',
      'Waktu Ambil Terakhir',
      'Waktu Kembali Terakhir',
      'Guru Piket Terakhir',
      'Total Riwayat Pemakaian',
      'Total Keterlambatan',
    ];
    const rows = laptopTrackingRecords.map((rec) => [
      rec.laptop.asset_code,
      rec.laptop.brand_model,
      rec.trackingState === 'available'
        ? 'Tersedia di Lab'
        : rec.trackingState === 'pulang'
        ? 'Sedang Dibawa Pulang (Kepulangan)'
        : 'Sedang Dipakai Sesi Harian',
      rec.owner?.student_code || 'Belum Dialokasikan',
      rec.owner?.name || '-',
      rec.owner?.class || '-',
      rec.owner ? WILAYAH_LABELS[rec.owner.wilayah] : '-',
      rec.lastTx?.purpose || 'Belum Pernah Dipakai',
      rec.lastTx ? formatDateTimeID(rec.lastTx.borrow_time) : '-',
      rec.lastTx?.return_time
        ? formatDateTimeID(rec.lastTx.return_time)
        : rec.activeTx
        ? 'Sedang Dipakai'
        : '-',
      rec.lastTx?.return_piket_name || rec.lastTx?.piket_name || '-',
      String(rec.totalUsageCount),
      String(rec.lateReturnCount),
    ]);
    const csv = `\uFEFFsep=;\r\n${[headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n')}\r\n`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `database-tracking-semua-laptop-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-900 via-indigo-800 to-violet-800 p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-extrabold tracking-wider text-cyan-300 uppercase">
              <Database className="h-3.5 w-3.5" />
              Menu Database &amp; Tracking Administrator
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">
              Database Pemakaian Lengkap &amp; Tracking Semua Unit Laptop
            </h2>
            <p className="mt-1 text-xs text-blue-100 sm:text-sm">
              Lihat seluruh data pemakaian harian &amp; kepulangan secara lengkap, pantau lokasi/status setiap unit laptop, serta kelola sanksi suspend siswa.
            </p>
          </div>

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
                    ? 'bg-white text-indigo-900 shadow-xs'
                    : 'text-white/85 hover:text-white'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Top 5 Summary Counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 sm:gap-4">
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-indigo-700">Total Unit Laptop</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-indigo-950 tabular-nums">
            {scopedLaptops.length}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-amber-700">Sedang Dipakai</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-amber-700 tabular-nums">
            {activeCount}
          </p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-violet-700">Kepulangan Aktif</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-violet-800 tabular-nums">
            {activeHomeCount}
          </p>
        </div>
        <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-white p-4 shadow-2xs">
          <p className="text-xs font-bold text-cyan-700">Kembali dari Pulang</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-cyan-800 tabular-nums">
            {returnedHomeCount}
          </p>
        </div>
        <div className="col-span-2 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 shadow-2xs sm:col-span-1">
          <p className="text-xs font-bold text-emerald-700">Tersedia di Lab</p>
          <p className="mt-1 font-mono text-2xl font-extrabold text-emerald-700 tabular-nums">
            {availableCount}
          </p>
        </div>
      </div>

      {/* Sub-navigation Tabs inside Database Menu */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSectionTab('pemakaian_lengkap')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all ${
              sectionTab === 'pemakaian_lengkap'
                ? 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <Database className="h-4 w-4" />
            1. Data Pemakaian Lengkap &amp; Rekap Sesi ({transactions.length})
          </button>

          <button
            type="button"
            onClick={() => setSectionTab('tracking_laptop')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all ${
              sectionTab === 'tracking_laptop'
                ? 'bg-gradient-to-r from-blue-700 to-indigo-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <LaptopIcon className="h-4 w-4" />
            2. Data Semua Laptop &amp; Tracking Unit ({laptops.length})
          </button>

          <button
            type="button"
            onClick={() => setSectionTab('suspend_siswa')}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-extrabold transition-all ${
              sectionTab === 'suspend_siswa'
                ? 'bg-gradient-to-r from-rose-600 to-red-700 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <ShieldAlert className="h-4 w-4" />
            3. Status Suspend &amp; Sanksi Siswa ({students.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama siswa, kode SIS/LAP, kelas, guru..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-8 text-xs font-semibold outline-none focus:border-indigo-600 focus:bg-white"
          />
        </div>
      </div>

      {/* =================================================================== */}
      {/* TAB 1: DATA PEMAKAIAN SECARA LENGKAP & REKAP SESI AKTIF             */}
      {/* =================================================================== */}
      {sectionTab === 'pemakaian_lengkap' && (
        <div className="space-y-6">
          {/* REKAP DATA AKTIF LAPTOP DIPAKAI PADA SETIAP SESI */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Rekap Data Aktif Laptop Dipakai pada Setiap Sesi
                </h3>
                <p className="text-xs text-slate-500">
                  Menampilkan laptop yang saat ini sedang dipakai oleh siswa berdasarkan sesi harian maupun izin kepulangan.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 self-start rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-extrabold text-white sm:self-auto">
                <LaptopIcon className="h-4 w-4 text-amber-300" />
                <span>Total Aktif Dipakai: {activeSessionRecap.totalActive} Laptop</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              {activeSessionRecap.buckets.map((bucket) => (
                <div
                  key={bucket.id}
                  className={`flex flex-col rounded-2xl border p-4 ${bucket.accentClass}`}
                >
                  <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
                    <div>
                      <h4 className="text-xs font-extrabold text-slate-900">{bucket.title}</h4>
                      <p className="text-[11px] text-slate-500">{bucket.subtitle}</p>
                    </div>
                    <span
                      className={`rounded-lg px-2.5 py-1 font-mono text-xs font-extrabold tabular-nums ${bucket.badgeClass}`}
                    >
                      {bucket.items.length}
                    </span>
                  </div>

                  <div className="mt-3 flex-1 space-y-2">
                    {bucket.items.length === 0 ? (
                      <p className="py-5 text-center text-xs text-slate-400">
                        Tidak ada laptop aktif.
                      </p>
                    ) : (
                      bucket.items.map(({ tx, student, laptop }) => (
                        <div
                          key={tx.id}
                          className="rounded-xl border border-slate-200/90 bg-white p-2.5 text-xs shadow-2xs"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono font-extrabold text-blue-700">
                              {laptop?.asset_code || 'LAP'}
                            </span>
                            <span className="font-mono text-[10px] font-semibold text-slate-500">
                              {student?.wilayah === 'putra' ? 'Putra' : 'Putri'} ·{' '}
                              {formatTimeOnly(tx.borrow_time)}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate font-bold text-slate-900">
                            {student?.name || 'Siswa'}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {student?.student_code} · Kelas {student?.class}
                          </p>
                          {(tx.custom_activity || tx.home_note) && (
                            <p className="mt-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                              {tx.custom_activity || tx.home_note}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* TABEL / DAFTAR DATA PEMAKAIAN SECARA LENGKAP */}
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: 'all', label: 'Semua Data Pemakaian' },
                    { id: 'active', label: `Sedang Dipakai (${activeCount})` },
                    { id: 'returned', label: 'Sudah Dikembalikan' },
                    { id: 'pulang', label: 'Khusus Kepulangan' },
                    { id: 'late', label: 'Khusus Terlambat' },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setUsageFilter(item.id)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-extrabold whitespace-nowrap transition-colors ${
                      usageFilter === item.id
                        ? 'bg-indigo-700 text-white shadow-2xs'
                        : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'ALL' | TransactionType)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-indigo-600"
                >
                  <option value="ALL">Semua Jenis Scan</option>
                  <option value="harian">Penggunaan Harian &amp; Kegiatan</option>
                  <option value="pulang">Membawa Laptop Pulang (Kepulangan)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleExportUsageCsv}
                className="inline-flex items-center gap-1.5 self-start rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-slate-800 lg:self-auto"
              >
                <Download className="h-3.5 w-3.5" />
                Unduh CSV Pemakaian Lengkap ({filteredUsageList.length})
              </button>
            </div>

            {filteredUsageList.length === 0 ? (
              <div className="px-6 py-12 text-center text-xs text-slate-400">
                Tidak ada data pemakaian laptop yang cocok dengan filter pencarian.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredUsageList.map((tx) => {
                  const st = studentMap.get(tx.student_id);
                  const lp = laptopMap.get(tx.laptop_id);
                  const isOverdue =
                    tx.status === 'active' && new Date(tx.due_time).getTime() < Date.now();
                  const isHomeLeave = tx.transaction_type === 'pulang';
                  const isSuspended = st ? isStudentCurrentlySuspended(st) : false;

                  return (
                    <div
                      key={tx.id}
                      className="flex flex-col gap-3 px-5 py-4 transition-colors hover:bg-indigo-50/30 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          <span className="font-extrabold text-slate-900">
                            {st?.name || 'Siswa Terhapus'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono font-bold text-indigo-700">
                            {st?.student_code || '—'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-medium text-slate-600">
                            Kelas {st?.class || '—'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span
                            className={`font-bold ${
                              tx.wilayah === 'putra' ? 'text-sky-700' : 'text-fuchsia-700'
                            }`}
                          >
                            {WILAYAH_LABELS[tx.wilayah]}
                          </span>

                          {/* Explicit Kepulangan Status Badge */}
                          {isHomeLeave && (
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                                tx.status === 'active'
                                  ? 'bg-violet-700 text-white'
                                  : 'bg-emerald-700 text-white'
                              }`}
                            >
                              {tx.status === 'active'
                                ? 'STATUS KEPULANGAN: SEDANG DIBAWA PULANG'
                                : 'STATUS KEPULANGAN: SUDAH DIKEMBALIKAN KE LAB'}
                            </span>
                          )}

                          {isSuspended && st && (
                            <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold text-rose-800">
                              SUSPEND s/d{' '}
                              {st.suspended_until ? formatDateOnly(st.suspended_until) : 'Admin'}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-600">
                          <span className="font-mono font-extrabold text-slate-900">
                            {lp?.asset_code || '—'}
                          </span>
                          <span>{lp?.brand_model || ''}</span>
                          <span className="text-slate-300">|</span>
                          <span
                            className={`inline-flex items-center gap-1 font-extrabold ${
                              isHomeLeave ? 'text-violet-700' : 'text-blue-700'
                            }`}
                          >
                            {isHomeLeave ? (
                              <Home className="h-3.5 w-3.5" />
                            ) : (
                              <BookOpen className="h-3.5 w-3.5" />
                            )}
                            {isHomeLeave ? 'Kepulangan (Bawa Pulang)' : 'Penggunaan Harian'}
                          </span>
                          <span className="text-slate-400">·</span>
                          <span className="font-bold text-slate-800">{tx.purpose}</span>
                        </div>

                        {tx.custom_activity && (
                          <p className="text-[11px] text-cyan-800">
                            Kegiatan Siswa:{' '}
                            <span className="font-semibold">{tx.custom_activity}</span>
                          </p>
                        )}

                        {tx.home_note && (
                          <p className="text-[11px] text-violet-800">
                            Catatan Kepulangan:{' '}
                            <span className="font-semibold">{tx.home_note}</span>
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          <span className="font-mono tabular-nums">
                            Ambil: {formatDateTimeID(tx.borrow_time)}
                          </span>
                          <span className="font-mono font-bold text-slate-700 tabular-nums">
                            Batas:{' '}
                            {isHomeLeave
                              ? formatDateOnly(tx.due_time)
                              : formatTimeOnly(tx.due_time)}
                          </span>
                          {tx.return_time && (
                            <span className="font-mono font-bold text-emerald-700 tabular-nums">
                              Kembali: {formatDateTimeID(tx.return_time)}
                            </span>
                          )}
                          <span className="font-mono tabular-nums">
                            Durasi: {formatDuration(tx.borrow_time, tx.return_time)}
                          </span>
                          <span>
                            Guru Piket:{' '}
                            <strong className="text-slate-800">{tx.piket_name}</strong>
                            {tx.return_piket_name && ` → Terima: ${tx.return_piket_name}`}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {tx.status === 'active' ? (
                          <>
                            {isOverdue && (
                              <span className="inline-flex items-center gap-1 text-xs font-extrabold text-rose-700">
                                <Clock className="h-3.5 w-3.5" />
                                Melewati Batas!
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={busyId === tx.id}
                              onClick={() => handleReturnClick(tx, 0)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-2xs transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {isHomeLeave ? 'Tandai Kembali dari Pulang' : 'Kembalikan'}
                            </button>
                          </>
                        ) : tx.is_late ? (
                          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-rose-700">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Telat {tx.late_minutes} mnt
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {isHomeLeave ? 'Sudah Kembali ke Lab' : 'Tepat Waktu'}
                          </span>
                        )}

                        {st && (
                          <>
                            <button
                              type="button"
                              onClick={() => setSuspendModalStudent(st)}
                              className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-bold text-rose-700 transition-colors hover:bg-rose-100"
                            >
                              <Ban className="h-3.5 w-3.5" />
                              {isSuspended ? 'Ubah Suspend' : 'Suspend'}
                            </button>
                            {isSuspended && (
                              <button
                                type="button"
                                onClick={() => onResetSanction(st.id)}
                                className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100"
                              >
                                <Unlock className="h-3.5 w-3.5" />
                                Cabut
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: DATA SEMUA LAPTOP & TRACKING LENGKAP                         */}
      {/* =================================================================== */}
      {sectionTab === 'tracking_laptop' && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'ALL', label: `Semua Unit Laptop (${scopedLaptops.length})` },
                  { id: 'available', label: `Tersedia di Lab (${availableCount})` },
                  {
                    id: 'harian',
                    label: `Sedang Dipakai Harian (${Math.max(0, activeCount - activeHomeCount)})`,
                  },
                  { id: 'pulang', label: `Sedang Dibawa Pulang (${activeHomeCount})` },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setLaptopTrackFilter(f.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-extrabold whitespace-nowrap transition-colors ${
                    laptopTrackFilter === f.id
                      ? 'bg-indigo-700 text-white shadow-2xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleExportLaptopTrackingCsv}
              className="inline-flex items-center gap-1.5 self-start rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-extrabold text-white hover:bg-slate-800 lg:self-auto"
            >
              <Download className="h-3.5 w-3.5" />
              Unduh CSV Tracking Laptop ({laptopTrackingRecords.length})
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/90 text-[11px] font-extrabold text-slate-600 uppercase">
                  <th className="px-4 py-3.5">Kode Tas &amp; Merk Laptop</th>
                  <th className="px-4 py-3.5">Siswa Pemilik Alokasi</th>
                  <th className="px-4 py-3.5">Status Tracking Saat Ini</th>
                  <th className="px-4 py-3.5">Pemakaian Terakhir / Aktif</th>
                  <th className="px-4 py-3.5">Guru Piket Terkait</th>
                  <th className="px-4 py-3.5 text-right">Statistik &amp; Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {laptopTrackingRecords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                      Tidak ada unit laptop yang sesuai dengan filter.
                    </td>
                  </tr>
                ) : (
                  laptopTrackingRecords.map((rec) => (
                    <tr key={rec.laptop.id} className="hover:bg-indigo-50/30">
                      <td className="px-4 py-3.5">
                        <p className="font-mono text-sm font-extrabold text-indigo-800">
                          {rec.laptop.asset_code}
                        </p>
                        <p className="font-semibold text-slate-700">{rec.laptop.brand_model}</p>
                      </td>

                      <td className="px-4 py-3.5">
                        {rec.owner ? (
                          <div>
                            <p className="font-extrabold text-slate-900">{rec.owner.name}</p>
                            <p className="text-[11px] text-slate-500">
                              <span className="font-mono font-bold text-indigo-700">
                                {rec.owner.student_code}
                              </span>{' '}
                              · Kelas {rec.owner.class} ·{' '}
                              <span
                                className={`font-bold ${
                                  rec.owner.wilayah === 'putra'
                                    ? 'text-sky-700'
                                    : 'text-fuchsia-700'
                                }`}
                              >
                                {WILAYAH_LABELS[rec.owner.wilayah]}
                              </span>
                            </p>
                          </div>
                        ) : (
                          <span className="font-bold text-amber-700">
                            Belum Dialokasikan ke Siswa
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {rec.trackingState === 'available' ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2.5 py-1 text-[11px] font-extrabold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            TERSEDIA DI LAB
                          </span>
                        ) : rec.trackingState === 'pulang' ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-violet-700 px-2.5 py-1 text-[11px] font-extrabold text-white">
                            <Home className="h-3.5 w-3.5" />
                            SEDANG DIBAWA PULANG
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-extrabold text-white">
                            <Clock className="h-3.5 w-3.5" />
                            DIPAKAI SESI HARIAN
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {rec.lastTx ? (
                          <div className="space-y-0.5">
                            <p className="font-bold text-slate-900">{rec.lastTx.purpose}</p>
                            {(rec.lastTx.custom_activity || rec.lastTx.home_note) && (
                              <p className="text-[11px] font-semibold text-cyan-800">
                                {rec.lastTx.custom_activity || rec.lastTx.home_note}
                              </p>
                            )}
                            <p className="font-mono text-[11px] text-slate-500">
                              Ambil: {formatDateTimeID(rec.lastTx.borrow_time)}
                            </p>
                            {rec.lastTx.return_time ? (
                              <p className="font-mono text-[11px] font-bold text-emerald-700">
                                Kembali: {formatDateTimeID(rec.lastTx.return_time)}
                              </p>
                            ) : (
                              <p className="font-mono text-[11px] font-bold text-rose-700">
                                Batas:{' '}
                                {rec.lastTx.transaction_type === 'pulang'
                                  ? formatDateOnly(rec.lastTx.due_time)
                                  : formatTimeOnly(rec.lastTx.due_time)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">Belum ada riwayat pemakaian</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        {rec.lastTx ? (
                          <div className="text-[11px]">
                            <p className="font-semibold text-slate-800">
                              Serah: {rec.lastTx.piket_name}
                            </p>
                            {rec.lastTx.return_piket_name && (
                              <p className="text-slate-500">
                                Terima: {rec.lastTx.return_piket_name}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-slate-600">
                            {rec.totalUsageCount}× pakai · {rec.lateReturnCount}× telat
                          </span>
                          {rec.activeTx && (
                            <button
                              type="button"
                              disabled={busyId === rec.activeTx.id}
                              onClick={() => handleReturnClick(rec.activeTx!, 0)}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-2.5 py-1.5 text-[11px] font-extrabold text-white hover:bg-blue-800 disabled:opacity-50"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Kembalikan ke Lab
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* TAB 3: DAFTAR SUSPEND SISWA & KONTROL SANKSI                        */}
      {/* =================================================================== */}
      {sectionTab === 'suspend_siswa' && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4">
            <h3 className="text-sm font-extrabold text-slate-900">
              Manajemen Suspend Siswa &amp; Batas Tanggal Sanksi
            </h3>
            <p className="text-xs text-slate-500">
              Pilih siswa mana yang di-suspend dan tentukan batas tanggal berakhirnya suspend.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-extrabold text-slate-600 uppercase">
                  <th className="px-4 py-3">Kode &amp; Nama Siswa</th>
                  <th className="px-4 py-3">Kelas &amp; Wilayah</th>
                  <th className="px-4 py-3">Riwayat Telat</th>
                  <th className="px-4 py-3">Status Suspend &amp; Batas Waktu</th>
                  <th className="px-4 py-3 text-right">Tindakan Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStudentsForSuspend.map((s) => {
                  const isSuspended = isStudentCurrentlySuspended(s);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3">
                        <p className="font-extrabold text-slate-900">{s.name}</p>
                        <p className="font-mono text-[11px] font-bold text-indigo-700">
                          {s.student_code}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-700">{s.class}</span> ·{' '}
                        <span
                          className={`font-bold ${
                            s.wilayah === 'putra' ? 'text-sky-700' : 'text-fuchsia-700'
                          }`}
                        >
                          {WILAYAH_LABELS[s.wilayah]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold">
                        {s.late_count}/{MAX_LATE_STRIKES}× Terlambat
                      </td>
                      <td className="px-4 py-3">
                        {isSuspended ? (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-extrabold text-rose-800">
                              SUSPEND s/d{' '}
                              {s.suspended_until ? formatDateOnly(s.suspended_until) : 'Admin'}
                            </span>
                            {s.suspended_reason && (
                              <p className="mt-0.5 text-[11px] text-slate-500">
                                {s.suspended_reason}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="font-bold text-emerald-700">Aktif (Bebas Pinjam)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSuspendModalStudent(s)}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            {isSuspended ? 'Ubah Waktu Suspend' : 'Suspend Siswa'}
                          </button>
                          {(isSuspended || s.late_count > 0) && (
                            <button
                              type="button"
                              onClick={() => onResetSanction(s.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <Unlock className="h-3.5 w-3.5" />
                              Cabut / Reset
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {suspendModalStudent && (
        <SuspendStudentModal
          student={suspendModalStudent}
          onClose={() => setSuspendModalStudent(null)}
          onConfirmSuspend={onSuspendStudent}
        />
      )}
    </div>
  );
}
