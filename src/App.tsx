import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  CloudUpload,
  Database,
  FileSpreadsheet,
  Laptop,
  Loader2,
  LogOut,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import {
  ActivePage,
  AppStatePayload,
  AuthUser,
  DailySessionConfig,
  KioskPersistedState,
  LaptopPurpose,
  PrintSettings,
  StaffRole,
  StaffWilayah,
  Wilayah,
  WILAYAH_LABELS,
} from './types/models';
import { api, ApiError, BorrowPayload, setAuthToken } from './lib/api';
import {
  connectFirebaseCloudAccount,
  disconnectFirebaseCloudAccount,
  FirebaseQuotaTelemetry,
  flushStateToFirestoreNow,
  getLastCloudLoadStatus,
  loadBundleFromFirestoreOnce,
  loadStateFromLocalQuotaCache,
  saveStateToLocalQuotaCache,
  scheduleQuotaSavingFirestoreSync,
  subscribeFirebaseTelemetry,
  subscribeToCloudKioskBundle,
  syncTransactionAuditToFirestore,
} from './lib/firebase';
import { localBackend } from './lib/localBackend';
import {
  isStudentCurrentlySuspended,
  ParsedLaptopCsvRow,
  ParsedStaffCsvRow,
  ParsedStudentLaptopRow,
} from './lib/store';
import { LoginView } from './components/LoginView';
import { ScanView } from './components/ScanView';
import { MonitoringView } from './components/MonitoringView';
import { PrintStudioView } from './components/PrintStudioView';
import { MasterView } from './components/MasterView';

interface NavConfig {
  id: ActivePage;
  label: string;
  shortLabel: string;
  breadcrumb: string;
  icon: typeof ScanLine;
}

const ADMIN_NAV_ITEMS: NavConfig[] = [
  {
    id: 'scan',
    label: 'Halaman Scan',
    shortLabel: 'Scan',
    breadcrumb: 'Scan Harian (Siang/Sore/Malam) & Kepulangan',
    icon: ScanLine,
  },
  {
    id: 'database',
    label: 'Database & Tracking',
    shortLabel: 'Database',
    breadcrumb: 'Data Pemakaian Lengkap & Tracking Semua Unit Laptop',
    icon: Database,
  },
  {
    id: 'manajemen',
    label: 'Manajemen Data & CSV',
    shortLabel: 'Manajemen',
    breadcrumb: 'CRUD Siswa, Laptop, Pegawai (Token Barcode) & Upload CSV',
    icon: FileSpreadsheet,
  },
  {
    id: 'print',
    label: 'Cetak Kartu & Barcode Tas',
    shortLabel: 'Cetak PDF',
    breadcrumb: 'Studio Cetak Kartu Siswa & Gantungan Tas PDF',
    icon: Printer,
  },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [state, setState] = useState<AppStatePayload | null>(null);
  const [loadingState, setLoadingState] = useState(true);
  const [activePage, setActivePage] = useState<ActivePage>('scan');
  const [fbTelemetry, setFbTelemetry] = useState<FirebaseQuotaTelemetry | null>(null);
  const [fbActionLoading, setFbActionLoading] = useState(false);

  const isAdmin = user?.role === 'admin';

  // Subscribe to Firebase Quota-Saving Telemetry
  useEffect(() => {
    const unsub = subscribeFirebaseTelemetry((snapshot) => {
      setFbTelemetry(snapshot);
    });
    return unsub;
  }, []);

  // Helper to update local React state AND schedule a debounced, quota-saving Firebase sync
  const applyAndSyncState = useCallback((nextState: AppStatePayload, debounceMs = 800) => {
    setState(nextState);
    scheduleQuotaSavingFirestoreSync(nextState, debounceMs);
  }, []);

  // Restore Admin session + Kiosk state (last page & Guru Piket login) + Hydrate from Quota-Saving Cache/Firestore
  const initializeApp = useCallback(async () => {
    setLoadingState(true);
    try {
      const [meRes, serverStateRes, localStorageStateRes, cachedOrFirestoreBundle] =
        await Promise.all([
          api.getMe().catch(() => ({ user: null })),
          api.getState(),
          localBackend.getState().catch(() => null),
          loadBundleFromFirestoreOnce().catch(() => null),
        ]);

      const cloudStatus = getLastCloudLoadStatus();
      const serverTime =
        typeof serverStateRes?.updatedAtMs === 'number' ? serverStateRes.updatedAtMs : 0;
      const localTime =
        typeof localStorageStateRes?.updatedAtMs === 'number'
          ? localStorageStateRes.updatedAtMs
          : 0;
      const cloudTime =
        typeof cachedOrFirestoreBundle?.updatedAtMs === 'number'
          ? cachedOrFirestoreBundle.updatedAtMs
          : 0;

      // Pick the freshest authoritative dataset across Firestore, localStorage, and Express server
      let bestBundle: Partial<AppStatePayload> = serverStateRes;
      let bestTime = serverTime;

      if (
        localStorageStateRes &&
        (localTime > bestTime ||
          (localTime === bestTime &&
            localStorageStateRes.laptops.length > (bestBundle.laptops?.length || 0)))
      ) {
        bestBundle = localStorageStateRes;
        bestTime = localTime;
      }

      if (
        cachedOrFirestoreBundle &&
        Array.isArray(cachedOrFirestoreBundle.students) &&
        cachedOrFirestoreBundle.students.length > 0 &&
        (cloudTime >= bestTime || bestTime === 0)
      ) {
        bestBundle = cachedOrFirestoreBundle;
        bestTime = cloudTime;
      }

      let effectiveState = serverStateRes;
      try {
        effectiveState = await api.hydrateState(bestBundle);
      } catch {
        effectiveState = serverStateRes;
      }

      saveStateToLocalQuotaCache(effectiveState);

      // Push to Firestore ONLY if:
      // 1. The cloud document genuinely does not exist yet on Firestore (`cloudStatus === 'not_found'`), OR
      // 2. This device has newer unsynced changes (`bestTime > cloudTime` and `cloudStatus === 'found'`)
      if (
        cloudStatus === 'not_found' ||
        (cloudStatus === 'found' && bestTime > cloudTime)
      ) {
        flushStateToFirestoreNow(effectiveState);
      }

      setUser(meRes.user);
      setState(effectiveState);

      if (meRes.user?.role === 'admin' && effectiveState.kioskState?.activePage) {
        setActivePage(effectiveState.kioskState.activePage);
      } else {
        setActivePage('scan');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        setUser(null);
      }
      // Guarantee state is never null even on static hosting (Vercel)
      const fallbackState =
        (await api.getState().catch(() => null)) ||
        (await localBackend.getState().catch(() => null));
      if (fallbackState) {
        setState(fallbackState);
      }
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  // Real-time cross-device cloud sync listener (Laptop <-> HP on Vercel & AI Studio)
  useEffect(() => {
    const unsub = subscribeToCloudKioskBundle(async (remoteBundle) => {
      if (
        remoteBundle &&
        Array.isArray(remoteBundle.students) &&
        Array.isArray(remoteBundle.laptops)
      ) {
        try {
          const hydrated = await api.hydrateState(remoteBundle);
          saveStateToLocalQuotaCache(hydrated);
          setState(hydrated);
        } catch {
          // Ignore transient hydration error
        }
      }
    });
    return unsub;
  }, []);

  // Zero-quota instant cross-tab sync within the same browser
  useEffect(() => {
    const onStorageChange = async (e: StorageEvent) => {
      if (
        e.key === 'laptrack_firebase_quota_cache_v1' ||
        e.key === 'laptrack_serverless_db_v1'
      ) {
        const cached = loadStateFromLocalQuotaCache();
        if (cached && Array.isArray(cached.students) && Array.isArray(cached.laptops)) {
          try {
            const hydrated = await api.hydrateState(cached);
            setState(hydrated);
          } catch {
            // Ignore
          }
        }
      }
    };
    window.addEventListener('storage', onStorageChange);
    return () => window.removeEventListener('storage', onStorageChange);
  }, []);

  const handleUpdateKioskState = useCallback(
    (patch: Partial<KioskPersistedState>, syncToCloud = false) => {
      setState((prev) => {
        if (!prev) return prev;
        const next: AppStatePayload = {
          ...prev,
          kioskState: { ...prev.kioskState, ...patch },
          updatedAtMs: syncToCloud ? Date.now() : prev.updatedAtMs,
        };
        if (syncToCloud) {
          scheduleQuotaSavingFirestoreSync(next, 1200);
        } else {
          saveStateToLocalQuotaCache(next);
        }
        return next;
      });
      api.updateKioskState(patch).catch(() => {
        // Ignore transient sync error
      });
    },
    []
  );

  const handleSwitchPage = useCallback(
    (nextPage: ActivePage) => {
      setActivePage(nextPage);
      handleUpdateKioskState({ activePage: nextPage }, false);
    },
    [handleUpdateKioskState]
  );

  // Keep non-admin users on the front Scan page
  useEffect(() => {
    if (!loadingState && !isAdmin && activePage !== 'scan') {
      setActivePage('scan');
    }
  }, [loadingState, isAdmin, activePage]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Ignore network error on logout
    } finally {
      setAuthToken(null);
      setUser(null);
      setActivePage('scan');
    }
  };

  // Manual 1-Click Cloud Connect / Sync for Admin
  const handleConnectFirebaseCloud = async () => {
    if (!state) return;
    setFbActionLoading(true);
    try {
      const res = await connectFirebaseCloudAccount(state);
      if (res.ok) {
        const cloudBundle = await loadBundleFromFirestoreOnce();
        if (cloudBundle && Array.isArray(cloudBundle.students) && cloudBundle.students.length > 0) {
          const hydrated = await api.hydrateState(cloudBundle);
          setState(hydrated);
        } else {
          await flushStateToFirestoreNow(state);
        }
      }
    } finally {
      setFbActionLoading(false);
    }
  };

  const handleForceFlushToFirebase = async () => {
    if (!state) return;
    setFbActionLoading(true);
    try {
      await flushStateToFirestoreNow(state);
    } finally {
      setFbActionLoading(false);
    }
  };

  const handlePullFromFirebaseOnce = async () => {
    setFbActionLoading(true);
    try {
      const bundle = await loadBundleFromFirestoreOnce();
      if (bundle && Array.isArray(bundle.students) && bundle.students.length > 0) {
        const hydrated = await api.hydrateState(bundle);
        setState(hydrated);
      }
    } finally {
      setFbActionLoading(false);
    }
  };

  if (loadingState && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-950 via-blue-900 to-violet-950 text-sm font-semibold text-white">
        <Loader2 className="mr-2.5 h-5 w-5 animate-spin text-amber-400" />
        Memuat Sistem Manajemen &amp; Peminjaman Laptop Siswa...
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-br from-indigo-950 via-blue-900 to-violet-950 p-6 text-center text-white">
        <p className="text-sm font-bold">Menyiapkan Database Lokal &amp; Firebase...</p>
        <button
          type="button"
          onClick={() => initializeApp()}
          className="rounded-xl bg-amber-400 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-300"
        >
          Muat Ulang Aplikasi
        </button>
      </div>
    );
  }

  const activeBorrowedCount = state.laptops.filter((l) => l.status === 'borrowed').length;
  const suspendedCount = state.students.filter((s) => isStudentCurrentlySuspended(s)).length;

  const currentNav =
    ADMIN_NAV_ITEMS.find((item) => item.id === activePage) || ADMIN_NAV_ITEMS[0];

  // Handlers backed by server API + Quota-Saving Firebase Sync
  const handleBorrow = async (payload: BorrowPayload) => {
    try {
      const res = await api.borrowLaptop(payload);
      setState(res.state);
      syncTransactionAuditToFirestore(res.transaction, res.state, true);
      return { ok: true, transaction: res.transaction };
    } catch (err) {
      if (err instanceof ApiError) {
        return {
          ok: false,
          code: err.code,
          error: err.message,
          correctedSession: err.correctedSession,
          correctedLabel: err.correctedLabel,
        };
      }
      return { ok: false, error: 'Gagal memproses peminjaman.' };
    }
  };

  const handleReturn = async (
    studentId: string,
    laptopId: string,
    simulateLateMinutes = 0,
    piketId?: string,
    piketToken?: string
  ) => {
    try {
      const res = await api.returnLaptop(
        studentId,
        laptopId,
        simulateLateMinutes,
        piketId,
        piketToken
      );
      setState(res.state);
      if (res.transaction) {
        syncTransactionAuditToFirestore(res.transaction, res.state, false);
      } else {
        scheduleQuotaSavingFirestoreSync(res.state, 1200);
      }
      return {
        ok: true,
        transaction: res.transaction,
        isLate: res.isLate,
        lateMinutes: res.lateMinutes,
        studentLateCount: res.studentLateCount,
        newlySuspended: res.newlySuspended,
        returnedType: res.returnedType,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memproses pengembalian.',
      };
    }
  };

  const handleManualReturn = async (
    studentId: string,
    laptopId: string,
    simulateLateMinutes = 0
  ) => {
    await handleReturn(studentId, laptopId, simulateLateMinutes);
  };

  const handleSuspendStudent = async (
    studentId: string,
    payload: { suspended_until: string; reason: string }
  ) => {
    const res = await api.suspendStudent(studentId, payload);
    applyAndSyncState(res.state, 1500);
  };

  const handleResetSanction = async (studentId: string) => {
    const res = await api.resetStudentSanction(studentId);
    applyAndSyncState(res.state, 1500);
  };

  const handleUpdateDailySessions = async (sessions: DailySessionConfig[]) => {
    const res = await api.updateDailySessions(sessions);
    applyAndSyncState(res.state, 1800);
  };

  const handleAddStudent = async (payload: {
    name: string;
    class: string;
    wilayah: Wilayah;
    photo_url: string | null;
  }) => {
    try {
      const res = await api.addStudent(payload);
      applyAndSyncState(res.state);
      return { ok: true, studentCode: res.student.student_code };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal menambah siswa.' };
    }
  };

  const handleUpdateStudent = async (
    studentId: string,
    payload: {
      name: string;
      class: string;
      wilayah: Wilayah;
      photo_url?: string | null;
    }
  ) => {
    try {
      const res = await api.updateStudent(studentId, payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memperbarui siswa.',
      };
    }
  };

  const handleBulkAddStudents = async (rows: ParsedStudentLaptopRow[]) => {
    try {
      const res = await api.bulkAddStudents(rows);
      setState(res.state);
      // Immediately flush bulk import to Firebase Firestore in 1 write so HP & other devices get it right away
      await flushStateToFirestoreNow(res.state);
      return {
        ok: true,
        createdStudents: res.createdStudents,
        createdLaptops: res.createdLaptops,
      };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal impor CSV.' };
    }
  };

  const handleDeleteStudent = async (studentId: string) => {
    const res = await api.deleteStudent(studentId);
    applyAndSyncState(res.state);
  };

  const handleAddLaptop = async (payload: {
    asset_code: string;
    brand_model: string;
    assigned_student_id: string | null;
  }) => {
    try {
      const res = await api.addLaptop(payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal menambah laptop.' };
    }
  };

  const handleUpdateLaptop = async (
    laptopId: string,
    payload: {
      asset_code: string;
      brand_model: string;
      assigned_student_id: string | null;
    }
  ) => {
    try {
      const res = await api.updateLaptop(laptopId, payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memperbarui laptop.',
      };
    }
  };

  const handleBulkAddLaptops = async (rows: ParsedLaptopCsvRow[]) => {
    try {
      const res = await api.bulkAddLaptops(rows);
      setState(res.state);
      await flushStateToFirestoreNow(res.state);
      return {
        ok: true,
        createdLaptops: res.createdLaptops,
        updatedLaptops: res.updatedLaptops,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal impor CSV laptop.',
      };
    }
  };

  const handleAssignLaptop = async (laptopId: string, studentId: string | null) => {
    const res = await api.assignLaptop(laptopId, studentId);
    applyAndSyncState(res.state);
  };

  const handleDeleteLaptop = async (laptopId: string) => {
    const res = await api.deleteLaptop(laptopId);
    applyAndSyncState(res.state);
  };

  const handleAddSchedule = async (payload: {
    purpose: LaptopPurpose;
    target_class: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }) => {
    const res = await api.addSchedule(payload);
    applyAndSyncState(res.state);
  };

  const handleUpdateSchedule = async (
    scheduleId: string,
    payload: {
      purpose: LaptopPurpose;
      target_class: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }
  ) => {
    try {
      const res = await api.updateSchedule(scheduleId, payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memperbarui jadwal.',
      };
    }
  };

  const handleToggleSchedule = async (scheduleId: string) => {
    const res = await api.toggleSchedule(scheduleId);
    applyAndSyncState(res.state);
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    const res = await api.deleteSchedule(scheduleId);
    applyAndSyncState(res.state);
  };

  const handleAddStaff = async (payload: {
    name: string;
    username: string;
    password: string;
    role: StaffRole;
    wilayah: StaffWilayah;
    piket_token?: string;
  }) => {
    try {
      const res = await api.addStaff(payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal menambah akun.' };
    }
  };

  const handleUpdateStaff = async (
    staffId: string,
    payload: {
      name: string;
      username: string;
      piket_token: string;
      role: StaffRole;
      wilayah: StaffWilayah;
      password?: string;
    }
  ) => {
    try {
      const res = await api.updateStaff(staffId, payload);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memperbarui pegawai.',
      };
    }
  };

  const handleBulkAddStaff = async (rows: ParsedStaffCsvRow[]) => {
    try {
      const res = await api.bulkAddStaff(rows);
      setState(res.state);
      await flushStateToFirestoreNow(res.state);
      return {
        ok: true,
        createdStaff: res.createdStaff,
        updatedStaff: res.updatedStaff,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal impor CSV pegawai.',
      };
    }
  };

  const handleUpdateStaffToken = async (staffId: string, piket_token?: string) => {
    try {
      const res = await api.updateStaffToken(staffId, piket_token);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof ApiError ? err.message : 'Gagal memperbarui token piket.',
      };
    }
  };

  const handleToggleStaff = async (staffId: string) => {
    try {
      const res = await api.toggleStaff(staffId);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal mengubah status.' };
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    try {
      const res = await api.deleteStaff(staffId);
      applyAndSyncState(res.state);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof ApiError ? err.message : 'Gagal menghapus akun.' };
    }
  };

  const handleUpdatePrintSettings = async (patch: Partial<PrintSettings>) => {
    setState((prev) =>
      prev ? { ...prev, printSettings: { ...prev.printSettings, ...patch } } : prev
    );
    try {
      const res = await api.updatePrintSettings(patch);
      applyAndSyncState(res.state, 3000);
    } catch {
      // Keep optimistic state if minor error
    }
  };

  const handleResetDemo = async () => {
    const res = await api.resetDemo();
    applyAndSyncState(res.state, 1500);
  };

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-sky-50/40 text-slate-900">
      {/* Desktop Left Sidebar — Shown ONLY when Admin is logged in */}
      {isAdmin && user && (
        <aside className="hidden w-72 shrink-0 border-r border-indigo-100 bg-white shadow-xs lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="flex h-16 items-center gap-2.5 bg-gradient-to-r from-indigo-700 via-blue-700 to-violet-700 px-5 text-white">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur-xs">
                <Laptop className="h-5 w-5 text-amber-300" />
              </div>
              <div>
                <span className="block text-sm font-extrabold tracking-tight whitespace-nowrap">
                  LapTrack Sekolah
                </span>
                <span className="block text-[10px] font-semibold text-blue-100">
                  Sistem Manajemen Laptop Murid
                </span>
              </div>
            </div>

            <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-4">
              {ADMIN_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSwitchPage(item.id)}
                    className={`flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-indigo-50/70 hover:text-indigo-900'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.id === 'database' && activeBorrowedCount > 0 && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-extrabold tabular-nums ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {activeBorrowedCount}
                      </span>
                    )}
                    {item.id === 'manajemen' && suspendedCount > 0 && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] font-extrabold tabular-nums ${
                          isActive ? 'bg-white/20 text-white' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {suspendedCount}
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Panel Hemat Kuota Harian Firebase (laptoptrak) */}
              {fbTelemetry && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/90 via-teal-50/70 to-white p-3 shadow-2xs">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-extrabold text-emerald-950">
                      <Zap className="h-3.5 w-3.5 text-emerald-600" />
                      Firebase ({fbTelemetry.projectId})
                    </span>
                    <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 font-mono text-[9px] font-extrabold text-emerald-800">
                      HEMAT KUOTA
                    </span>
                  </div>

                  <p className="mt-1 text-[10px] leading-relaxed font-medium text-slate-600">
                    Sistem Single-Bundle &amp; Write-Batching menghemat kuota harian Firestore.
                  </p>

                  <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-emerald-200/80 bg-white/90 p-1.5 text-center">
                    <div>
                      <span className="block font-mono text-xs font-extrabold text-slate-900">
                        {fbTelemetry.readsUsed}
                      </span>
                      <span className="block text-[9px] font-bold text-slate-500">Read</span>
                    </div>
                    <div className="border-x border-slate-100">
                      <span className="block font-mono text-xs font-extrabold text-indigo-700">
                        {fbTelemetry.writesUsed}
                      </span>
                      <span className="block text-[9px] font-bold text-slate-500">Write</span>
                    </div>
                    <div>
                      <span className="block font-mono text-xs font-extrabold text-emerald-700">
                        +{fbTelemetry.savedOperations}
                      </span>
                      <span className="block text-[9px] font-bold text-emerald-700">Dihemat</span>
                    </div>
                  </div>

                  {fbTelemetry.firebaseUserEmail ? (
                    <div className="mt-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="inline-flex items-center gap-1 font-bold text-emerald-800 truncate">
                          <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600" />
                          <span className="truncate">{fbTelemetry.firebaseUserEmail}</span>
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={fbActionLoading}
                          onClick={handleForceFlushToFirebase}
                          className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-[10px] font-extrabold text-white shadow-2xs hover:bg-emerald-700 disabled:opacity-50"
                          title="Simpan seluruh database ke Firestore dalam 1 Write"
                        >
                          <CloudUpload className="h-3 w-3" />
                          Sync (1 Write)
                        </button>
                        <button
                          type="button"
                          disabled={fbActionLoading}
                          onClick={handlePullFromFirebaseOnce}
                          className="inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-300 bg-white px-2 py-1.5 text-[10px] font-extrabold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                          title="Muat ulang dari Cloud dalam 1 Read"
                        >
                          <RefreshCw className="h-3 w-3" />
                          1 Read
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => disconnectFirebaseCloudAccount()}
                        className="w-full text-center text-[10px] font-semibold text-slate-400 hover:text-rose-600"
                      >
                        Putuskan Akun Cloud
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2.5">
                      <button
                        type="button"
                        disabled={fbActionLoading}
                        onClick={handleConnectFirebaseCloud}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 py-2 text-[11px] font-extrabold text-white shadow-2xs hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50"
                      >
                        <Cloud className="h-3.5 w-3.5" />
                        {fbActionLoading ? 'Menghubungkan...' : 'Aktifkan Cloud Sync (Google)'}
                      </button>
                      <p className="mt-1 text-center text-[9px] font-semibold text-emerald-800">
                        Cache Lokal Hemat Kuota Aktif (0 Read/Write)
                      </p>
                    </div>
                  )}
                </div>
              )}
            </nav>

            <div className="border-t border-slate-200 bg-slate-50/70 p-4">
              <div className="text-xs">
                <p className="truncate font-extrabold text-slate-900">{user.name}</p>
                <p className="text-[11px] font-semibold text-indigo-700">
                  Administrator · {WILAYAH_LABELS[user.wilayah]}
                </p>
                <p className="font-mono text-[10px] text-slate-400">{user.username}</p>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-bold text-slate-600 hover:bg-slate-100"
                  title="Reset data contoh"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Reset Data
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-2 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Keluar
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Main Content Area */}
      <div className={`flex min-w-0 flex-1 flex-col ${isAdmin ? 'pb-20 lg:pb-0' : ''}`}>
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-15 items-center justify-between gap-4 border-b border-indigo-100 bg-white/95 px-4 shadow-2xs backdrop-blur-md lg:h-16 lg:px-8">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 text-white shadow-xs">
              <Laptop className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-extrabold tracking-tight text-slate-900">
                  Sistem manajemen pemakaian laptop siswa
                </span>
                {isAdmin && (
                  <span className="hidden rounded-md bg-indigo-100 px-2 py-0.5 text-[10px] font-extrabold text-indigo-800 sm:inline-block">
                    MODE ADMIN
                  </span>
                )}
              </div>
              {isAdmin && (
                <p className="truncate text-[11px] font-medium text-slate-500">
                  {currentNav.breadcrumb}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {fbTelemetry && (
              <div
                className="hidden items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/90 px-2.5 py-1.5 text-[11px] font-bold text-emerald-900 md:inline-flex"
                title="Mode Hemat Kuota Harian Firebase (Single-Bundle & Write-Batching)"
              >
                <Zap className="h-3.5 w-3.5 text-emerald-600" />
                <span>Firebase {fbTelemetry.projectId}</span>
                <span className="rounded bg-emerald-200/70 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-emerald-950">
                  Hemat +{fbTelemetry.savedOperations} Kuota
                </span>
              </div>
            )}

            {isAdmin && user ? (
              <>
                <div className="hidden text-right sm:block">
                  <p className="text-xs font-extrabold text-slate-900">{user.name}</p>
                  <p className="text-[11px] font-semibold text-indigo-600">
                    Admin · {WILAYAH_LABELS[user.wilayah]}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-extrabold whitespace-nowrap text-rose-700 transition-colors hover:bg-rose-100"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout Admin</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 px-4 py-2 text-xs font-extrabold whitespace-nowrap text-white shadow-sm transition-all hover:from-indigo-700 hover:to-violet-700"
              >
                <ShieldCheck className="h-4 w-4 text-amber-300" />
                Login Admin
              </button>
            )}
          </div>
        </header>

        {/* Active Workspace Viewport */}
        <main className="mx-auto w-full max-w-[1360px] flex-1 p-4 sm:p-5 lg:p-8">
          {activePage === 'scan' && (
            <ScanView
              currentUser={user}
              students={state.students}
              laptops={state.laptops}
              dailySessions={state.dailySessions}
              transactions={state.transactions}
              kioskState={state.kioskState}
              onUpdateKioskState={handleUpdateKioskState}
              onOpenAdminLogin={() => setShowLoginModal(true)}
              onBorrow={handleBorrow}
              onReturn={handleReturn}
            />
          )}

          {activePage === 'database' && isAdmin && (
            <MonitoringView
              students={state.students}
              laptops={state.laptops}
              dailySessions={state.dailySessions}
              transactions={state.transactions}
              onManualReturn={handleManualReturn}
              onSuspendStudent={handleSuspendStudent}
              onResetSanction={handleResetSanction}
            />
          )}

          {activePage === 'manajemen' && isAdmin && user && (
            <MasterView
              currentUser={user}
              students={state.students}
              laptops={state.laptops}
              schedules={state.schedules}
              dailySessions={state.dailySessions}
              staff={state.staff}
              printSettings={state.printSettings}
              onAddStudent={handleAddStudent}
              onUpdateStudent={handleUpdateStudent}
              onBulkAddStudents={handleBulkAddStudents}
              onSuspendStudent={handleSuspendStudent}
              onResetSanction={handleResetSanction}
              onDeleteStudent={handleDeleteStudent}
              onAddLaptop={handleAddLaptop}
              onUpdateLaptop={handleUpdateLaptop}
              onBulkAddLaptops={handleBulkAddLaptops}
              onAssignLaptop={handleAssignLaptop}
              onDeleteLaptop={handleDeleteLaptop}
              onUpdateDailySessions={handleUpdateDailySessions}
              onAddSchedule={handleAddSchedule}
              onUpdateSchedule={handleUpdateSchedule}
              onToggleSchedule={handleToggleSchedule}
              onDeleteSchedule={handleDeleteSchedule}
              onAddStaff={handleAddStaff}
              onUpdateStaff={handleUpdateStaff}
              onBulkAddStaff={handleBulkAddStaff}
              onUpdateStaffToken={handleUpdateStaffToken}
              onToggleStaff={handleToggleStaff}
              onDeleteStaff={handleDeleteStaff}
            />
          )}

          {activePage === 'print' && isAdmin && (
            <PrintStudioView
              students={state.students}
              laptops={state.laptops}
              settings={state.printSettings}
              onUpdateSettings={handleUpdatePrintSettings}
            />
          )}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar — Shown when Admin is logged in */}
      {isAdmin && (
        <nav
          aria-label="Navigasi Utama Admin Mobile"
          className="fixed right-0 bottom-0 left-0 z-40 border-t border-indigo-100 bg-white/95 backdrop-blur-md lg:hidden"
        >
          <div
            className="grid h-16 items-center"
            style={{ gridTemplateColumns: `repeat(${ADMIN_NAV_ITEMS.length}, minmax(0, 1fr))` }}
          >
            {ADMIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSwitchPage(item.id)}
                  className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                    isActive ? 'text-indigo-700 font-extrabold' : 'text-slate-500'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="truncate text-[10px] font-bold tracking-tight">
                    {item.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Admin Login Modal */}
      {showLoginModal && (
        <LoginView
          onAuthenticated={async (authUser) => {
            setUser(authUser);
            setShowLoginModal(false);
            const freshState = await api.getState();
            setState(freshState);
            handleSwitchPage('database');
          }}
          onClose={() => setShowLoginModal(false)}
        />
      )}
    </div>
  );
}
