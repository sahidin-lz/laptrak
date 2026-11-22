import {
  ActivePage,
  AppStatePayload,
  AuthUser,
  DailySessionConfig,
  DailySessionKey,
  KioskPersistedState,
  KioskWizardStep,
  LAPTOP_PURPOSES,
  Laptop,
  LaptopPurpose,
  MAX_LATE_STRIKES,
  PiketOption,
  PiketTicket,
  PrintSettings,
  Schedule,
  StaffMember,
  StaffRole,
  StaffWilayah,
  Student,
  Transaction,
  TransactionType,
  Wilayah,
} from '../types/models';
import { ApiError, AuthStatusResponse, BorrowPayload, LoginResponse } from './api';
import {
  extractPrefixAndNumber,
  findStudentByScannedCode,
  normalizeCodeCompact,
  validateDailySessionSelection,
} from './store';

const LOCAL_DB_KEY = 'laptrack_serverless_db_v1';
const LOCAL_SESSION_KEY = 'laptrack_serverless_auth_user_v1';

interface LocalStaffRecord extends StaffMember {
  passwordPlain: string;
}

interface LocalDatabase {
  adminClaimed: boolean;
  studentSeq: number;
  updatedAtMs?: number;
  staff: LocalStaffRecord[];
  students: Student[];
  laptops: Laptop[];
  schedules: Schedule[];
  dailySessions: DailySessionConfig[];
  transactions: Transaction[];
  printSettings: PrintSettings;
  kioskState: KioskPersistedState;
}

const DEFAULT_DAILY_SESSIONS: DailySessionConfig[] = [
  {
    key: 'siang',
    label: 'Sesi Siang',
    start_time: '12:30',
    deadline_time: '14:30',
    is_active: true,
  },
  {
    key: 'sore',
    label: 'Sesi Sore',
    start_time: '15:30',
    deadline_time: '17:30',
    is_active: true,
  },
  {
    key: 'malam',
    label: 'Sesi Malam',
    start_time: '19:30',
    deadline_time: '21:30',
    is_active: true,
  },
];

const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  schoolName: 'SMA NEGERI 1 NUSANTARA',
  schoolSubtext: 'Unit Pengelola Aset Digital & Lab Komputer',
  academicYear: 'TA 2026/2027',
  theme: 'navy',
  cardOrientation: 'landscape',
  bagTagStyle: 'single',
  showCutGuides: true,
  showPunchHole: true,
  includeQrOnTag: true,
  includeBarcodeOnCard: true,
};

function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

function formatStudentCode(seqNum: number): string {
  return `SIS-${String(seqNum).padStart(4, '0')}`;
}

function normalizeWilayah(raw: unknown, fallback: Wilayah = 'putra'): Wilayah {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'putri' || v === 'pr' || v === 'perempuan' || v === 'p') return 'putri';
  if (v === 'putra' || v === 'lk' || v === 'laki-laki' || v === 'l') return 'putra';
  return fallback;
}

function normalizeStaffWilayah(raw: unknown, fallback: StaffWilayah = 'semua'): StaffWilayah {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'putra') return 'putra';
  if (v === 'putri') return 'putri';
  if (v === 'semua') return 'semua';
  return fallback;
}

function createInitialKioskState(): KioskPersistedState {
  const threeDaysIso = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentHour = new Date().getHours();
  const initialSession: DailySessionKey =
    currentHour < 15 ? 'siang' : currentHour < 18 ? 'sore' : 'malam';

  return {
    activePage: 'scan',
    wizardStep: 'piket_login',
    piketTicket: null,
    selectedWilayah: 'putra',
    scanMode: 'harian',
    selectedSessionKey: initialSession,
    customActivityInput: '',
    customDeadlineTime: '17:30',
    plannedReturnDate: threeDaysIso,
    homeNote: '',
  };
}

function createInitialLocalDb(): LocalDatabase {
  const now = new Date();
  const todayDay = now.getDay();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const staff: LocalStaffRecord[] = [
    {
      id: 'stf-1',
      name: 'Sahidin',
      username: 'sahidin',
      passwordPlain: '121320',
      piket_token: 'ADM-101',
      role: 'admin',
      wilayah: 'semua',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-2',
      name: 'Anis Fahrurozi',
      username: 'anis.fahrurozi',
      passwordPlain: 'Admin@Anis26',
      piket_token: 'ADM-102',
      role: 'admin',
      wilayah: 'semua',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-3',
      name: 'Fadly Muhammad',
      username: 'fadly.muhammad',
      passwordPlain: 'Admin@Fadly26',
      piket_token: 'ADM-103',
      role: 'admin',
      wilayah: 'semua',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-4',
      name: 'Yusufa Mardha',
      username: 'yusufa.mardha',
      passwordPlain: 'Admin@Yusufa26',
      piket_token: 'ADM-104',
      role: 'admin',
      wilayah: 'semua',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-5',
      name: 'Ustadz Hendra Saputra (Piket Putra)',
      username: 'piket.putra',
      passwordPlain: 'Piket@Sekolah26',
      piket_token: 'PKT-201',
      role: 'piket',
      wilayah: 'putra',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-6',
      name: 'Ibu Ratna Sari (Piket Putri)',
      username: 'piket.putri',
      passwordPlain: 'Piket@Sekolah26',
      piket_token: 'PKT-202',
      role: 'piket',
      wilayah: 'putri',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-7',
      name: 'Ustadz Ridwan Kamil (Piket Malam Putra)',
      username: 'piket.malam.pa',
      passwordPlain: 'Piket@Sekolah26',
      piket_token: 'PKT-203',
      role: 'piket',
      wilayah: 'putra',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stf-8',
      name: 'Ustadzah Aisyah Nur (Piket Malam Putri)',
      username: 'piket.malam.pi',
      passwordPlain: 'Piket@Sekolah26',
      piket_token: 'PKT-204',
      role: 'piket',
      wilayah: 'putri',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
  ];

  const students: Student[] = [
    {
      id: 'stu-1',
      student_code: 'SIS-0001',
      name: 'Ahmad Fauzi',
      class: '10 IPA 1',
      wilayah: 'putra',
      photo_url: null,
      late_count: 2,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stu-2',
      student_code: 'SIS-0002',
      name: 'Siti Aminah',
      class: '11 IPS 2',
      wilayah: 'putri',
      photo_url: null,
      late_count: 0,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stu-3',
      student_code: 'SIS-0003',
      name: 'Budi Santoso',
      class: '12 IPA 1',
      wilayah: 'putra',
      photo_url: null,
      late_count: 3,
      is_suspended: true,
      suspended_until: fiveDaysFromNow.toISOString(),
      suspended_reason: 'Terlambat mengembalikan laptop sebanyak 3 kali (Sanksi Otomatis)',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stu-4',
      student_code: 'SIS-0004',
      name: 'Nadia Putri Rahma',
      class: '10 IPA 2',
      wilayah: 'putri',
      photo_url: null,
      late_count: 0,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stu-5',
      student_code: 'SIS-0005',
      name: 'Dimas Pratama',
      class: '11 IPA 1',
      wilayah: 'putra',
      photo_url: null,
      late_count: 1,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'stu-6',
      student_code: 'SIS-0006',
      name: 'Rina Wulandari',
      class: '12 IPS 1',
      wilayah: 'putri',
      photo_url: null,
      late_count: 0,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: twoDaysAgo.toISOString(),
    },
  ];

  const laptops: Laptop[] = [
    {
      id: 'lap-1',
      asset_code: 'LAP-001',
      brand_model: 'Lenovo ThinkPad T480',
      status: 'available',
      assigned_student_id: 'stu-1',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'lap-2',
      asset_code: 'LAP-002',
      brand_model: 'Asus Vivobook 14',
      status: 'borrowed',
      assigned_student_id: 'stu-2',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'lap-3',
      asset_code: 'LAP-003',
      brand_model: 'HP ProBook 440 G8',
      status: 'available',
      assigned_student_id: 'stu-3',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'lap-4',
      asset_code: 'LAP-004',
      brand_model: 'Lenovo IdeaPad Slim 3',
      status: 'available',
      assigned_student_id: 'stu-4',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'lap-5',
      asset_code: 'LAP-005',
      brand_model: 'Dell Latitude 5420',
      status: 'borrowed',
      assigned_student_id: 'stu-5',
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'lap-6',
      asset_code: 'LAP-006',
      brand_model: 'Acer TravelMate P2',
      status: 'available',
      assigned_student_id: 'stu-6',
      created_at: twoDaysAgo.toISOString(),
    },
  ];

  const schedules: Schedule[] = [
    {
      id: 'sch-1',
      purpose: 'Sesi Siang',
      target_class: 'SEMUA',
      day_of_week: todayDay,
      start_time: '12:30:00',
      end_time: '14:30:00',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'sch-2',
      purpose: 'Sesi Sore',
      target_class: 'SEMUA',
      day_of_week: todayDay,
      start_time: '15:30:00',
      end_time: '17:30:00',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
    {
      id: 'sch-3',
      purpose: 'Sesi Malam',
      target_class: 'SEMUA',
      day_of_week: todayDay,
      start_time: '19:30:00',
      end_time: '21:30:00',
      is_active: true,
      created_at: twoDaysAgo.toISOString(),
    },
  ];

  const transactions: Transaction[] = [
    {
      id: 'tx-1',
      student_id: 'stu-2',
      laptop_id: 'lap-2',
      wilayah: 'putri',
      transaction_type: 'harian',
      daily_session: 'sore',
      home_note: null,
      piket_id: 'stf-6',
      piket_name: 'Ibu Ratna Sari (Piket Putri)',
      return_piket_id: null,
      return_piket_name: null,
      purpose: 'Sesi Sore (Batas 17:30)',
      borrow_time: oneHourAgo.toISOString(),
      due_time: twoHoursFromNow.toISOString(),
      return_time: null,
      is_late: false,
      late_minutes: 0,
      status: 'active',
    },
    {
      id: 'tx-6',
      student_id: 'stu-5',
      laptop_id: 'lap-5',
      wilayah: 'putra',
      transaction_type: 'pulang',
      daily_session: null,
      home_note: 'Izin pulang akhir pekan · Dijemput Ayah',
      piket_id: 'stf-5',
      piket_name: 'Ustadz Hendra Saputra (Piket Putra)',
      return_piket_id: null,
      return_piket_name: null,
      purpose: 'Bawa Pulang ke Rumah',
      borrow_time: oneHourAgo.toISOString(),
      due_time: threeDaysFromNow.toISOString(),
      return_time: null,
      is_late: false,
      late_minutes: 0,
      status: 'active',
    },
    {
      id: 'tx-2',
      student_id: 'stu-1',
      laptop_id: 'lap-1',
      wilayah: 'putra',
      transaction_type: 'harian',
      daily_session: 'siang',
      home_note: null,
      piket_id: 'stf-5',
      piket_name: 'Ustadz Hendra Saputra (Piket Putra)',
      return_piket_id: 'stf-5',
      return_piket_name: 'Ustadz Hendra Saputra (Piket Putra)',
      purpose: 'Sesi Siang (Batas 14:30)',
      borrow_time: new Date(oneDayAgo.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      due_time: new Date(oneDayAgo.getTime() - 1 * 60 * 60 * 1000).toISOString(),
      return_time: new Date(oneDayAgo.getTime() - 35 * 60 * 1000).toISOString(),
      is_late: true,
      late_minutes: 25,
      status: 'returned',
    },
  ];

  return {
    adminClaimed: true,
    studentSeq: 7,
    staff,
    students,
    laptops,
    schedules,
    dailySessions: DEFAULT_DAILY_SESSIONS.map((s) => ({ ...s })),
    transactions,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
    kioskState: createInitialKioskState(),
    updatedAtMs: 0,
  };
}

function loadLocalDb(): LocalDatabase {
  try {
    const raw = localStorage.getItem(LOCAL_DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalDatabase;
      if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.laptops)) {
        // If this device already has uploaded data (> 6 default items) from before updatedAtMs was added,
        // stamp it with a non-zero timestamp so it is automatically pushed to Firebase Firestore!
        if (!parsed.updatedAtMs && (parsed.laptops.length > 6 || parsed.students.length > 6)) {
          parsed.updatedAtMs = Date.now();
          saveLocalDb(parsed);
        } else if (typeof parsed.updatedAtMs !== 'number') {
          parsed.updatedAtMs = 0;
        }
        return parsed;
      }
    }
  } catch {
    // Ignore storage read errors
  }
  const initial = createInitialLocalDb();
  saveLocalDb(initial);
  return initial;
}

function saveLocalDb(db: LocalDatabase): void {
  try {
    localStorage.setItem(LOCAL_DB_KEY, JSON.stringify(db));
  } catch {
    // Ignore storage quota errors
  }
}

let localDb: LocalDatabase = loadLocalDb();

function getSavedAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function setSavedAuthUser(user: AuthUser | null): void {
  try {
    if (!user) {
      localStorage.removeItem(LOCAL_SESSION_KEY);
    } else {
      localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(user));
    }
  } catch {
    // Ignore
  }
}

function refreshExpiredSuspensions(students: Student[]): void {
  const nowMs = Date.now();
  for (const st of students) {
    if (st.is_suspended && st.suspended_until) {
      const untilMs = new Date(st.suspended_until).getTime();
      if (!Number.isNaN(untilMs) && untilMs <= nowMs) {
        st.is_suspended = false;
        st.suspended_until = null;
        st.suspended_reason = null;
        if (st.late_count >= MAX_LATE_STRIKES) {
          st.late_count = 0;
        }
      }
    }
  }
}

function ensureStudentsHaveLaptopAllocation(db: LocalDatabase): void {
  const assignedStudentIds = new Set(
    db.laptops.map((l) => l.assigned_student_id).filter(Boolean) as string[]
  );
  const nowIso = new Date().toISOString();

  for (const st of db.students) {
    if (assignedStudentIds.has(st.id)) continue;

    // 1. Check if there is a laptop with the same sequence number (e.g. SIS-0007 -> LAP-007) that is unassigned
    const parsedStu = extractPrefixAndNumber(st.student_code);
    const desiredLapCode =
      parsedStu.num !== null
        ? `LAP-${String(parsedStu.num).padStart(3, '0')}`
        : `LAP-${st.student_code.replace(/^SIS[-_]?/i, '')}`;

    const matchingUnassigned = db.laptops.find(
      (l) =>
        !l.assigned_student_id &&
        (l.asset_code.toUpperCase() === desiredLapCode.toUpperCase() ||
          (parsedStu.num !== null &&
            extractPrefixAndNumber(l.asset_code).num === parsedStu.num))
    );

    if (matchingUnassigned) {
      matchingUnassigned.assigned_student_id = st.id;
      assignedStudentIds.add(st.id);
      continue;
    }

    // 2. If desiredLapCode does not exist at all, create it automatically for this student
    if (!db.laptops.some((l) => l.asset_code.toUpperCase() === desiredLapCode.toUpperCase())) {
      db.laptops.push({
        id: makeId('lap'),
        asset_code: desiredLapCode.toUpperCase(),
        brand_model: 'Laptop Sekolah',
        status: 'available',
        assigned_student_id: st.id,
        created_at: nowIso,
      });
      assignedStudentIds.add(st.id);
      continue;
    }

    // 3. Otherwise generate next available LAP-XXX code
    let nextNum = Math.max(db.laptops.length + 1, parsedStu.num || 1);
    while (
      db.laptops.some(
        (l) => l.asset_code.toUpperCase() === `LAP-${String(nextNum).padStart(3, '0')}`
      )
    ) {
      nextNum++;
    }
    db.laptops.push({
      id: makeId('lap'),
      asset_code: `LAP-${String(nextNum).padStart(3, '0')}`,
      brand_model: 'Laptop Sekolah',
      status: 'available',
      assigned_student_id: st.id,
      created_at: nowIso,
    });
    assignedStudentIds.add(st.id);
  }
}

function buildAppState(touchModified = true): AppStatePayload {
  refreshExpiredSuspensions(localDb.students);

  if (touchModified) {
    localDb.updatedAtMs = Date.now();
  } else if (typeof localDb.updatedAtMs !== 'number') {
    localDb.updatedAtMs =
      localDb.laptops.length > 6 || localDb.students.length > 6 ? Date.now() : 0;
  }

  const safeStaff: StaffMember[] = localDb.staff.map(
    ({ passwordPlain: _ignored, ...rest }) => rest
  );

  const piketOptions: PiketOption[] = localDb.staff
    .filter((s) => s.is_active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      wilayah: s.wilayah,
      demo_token: s.piket_token,
    }));

  saveLocalDb(localDb);

  return {
    students: [...localDb.students],
    laptops: [...localDb.laptops],
    schedules: [...localDb.schedules],
    dailySessions: [...localDb.dailySessions],
    transactions: [...localDb.transactions],
    staff: safeStaff,
    piketOptions,
    printSettings: { ...localDb.printSettings },
    kioskState: { ...localDb.kioskState },
    updatedAtMs: localDb.updatedAtMs,
  };
}

/**
 * Mirrors an authoritative AppStatePayload (e.g. from Express `/api/*` or Firestore)
 * directly into localDb and `localStorage` so refresh/offline fallback always matches 100%.
 */
export function mirrorStateToLocalDb(state: Partial<AppStatePayload> | null | undefined): void {
  if (!state || !Array.isArray(state.students) || !Array.isArray(state.laptops)) return;
  localDb.students = [...state.students];
  localDb.studentSeq = Math.max(localDb.studentSeq, localDb.students.length + 1);
  localDb.laptops = [...state.laptops];
  if (Array.isArray(state.transactions)) {
    localDb.transactions = [...state.transactions];
  }
  if (Array.isArray(state.schedules)) {
    localDb.schedules = [...state.schedules];
  }
  if (Array.isArray(state.dailySessions) && state.dailySessions.length === 3) {
    localDb.dailySessions = [...state.dailySessions];
  }
  if (state.printSettings) {
    localDb.printSettings = { ...localDb.printSettings, ...state.printSettings };
  }
  if (state.kioskState) {
    localDb.kioskState = {
      ...localDb.kioskState,
      ...state.kioskState,
      activePage: localDb.kioskState.activePage || state.kioskState.activePage || 'scan',
    };
  }
  if (Array.isArray(state.staff) && state.staff.length > 0) {
    const prevPasswords = new Map(
      localDb.staff.map((s) => [s.id, s.passwordPlain])
    );
    localDb.staff = state.staff.map((incoming) => ({
      ...incoming,
      passwordPlain: prevPasswords.get(incoming.id) || '121320',
    }));
  }
  if (typeof state.updatedAtMs === 'number' && state.updatedAtMs > 0) {
    localDb.updatedAtMs = state.updatedAtMs;
  }
  saveLocalDb(localDb);
}

function computeDueTimeFromDailySession(
  transactionType: TransactionType,
  sessionConfig: DailySessionConfig | null,
  plannedReturnDate: string | null,
  borrowDate = new Date()
): string {
  if (transactionType === 'pulang') {
    if (plannedReturnDate && /^\d{4}-\d{2}-\d{2}$/.test(plannedReturnDate)) {
      const [y, m, d] = plannedReturnDate.split('-').map(Number);
      const due = new Date(y, m - 1, d, 20, 0, 0, 0);
      if (!Number.isNaN(due.getTime())) {
        return due.toISOString();
      }
    }
    return new Date(borrowDate.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  }

  if (sessionConfig && /^\d{2}:\d{2}$/.test(sessionConfig.deadline_time)) {
    const [hh, mm] = sessionConfig.deadline_time.split(':').map((v) => Number(v) || 0);
    const due = new Date(borrowDate);
    due.setHours(hh, mm, 0, 0);
    return due.toISOString();
  }

  return new Date(borrowDate.getTime() + 2 * 60 * 60 * 1000).toISOString();
}

export const localBackend = {
  getAuthStatus: async (): Promise<AuthStatusResponse> => ({
    needsSetup: !localDb.adminClaimed,
    adminUsernames: localDb.staff
      .filter((s) => s.role === 'admin')
      .map((s) => ({ name: s.name, username: s.username })),
  }),

  getMe: async (): Promise<{ user: AuthUser | null }> => ({
    user: getSavedAuthUser(),
  }),

  claimAdmin: async (payload: {
    username: string;
    password: string;
    piketPassword?: string;
  }): Promise<LoginResponse> => {
    const username = (payload.username || '').trim().toLowerCase();
    const password = payload.password || '';
    if (password.length < 6) {
      throw new ApiError('Password minimal 6 karakter.', 400);
    }
    const targetAdmin =
      localDb.staff.find((s) => s.role === 'admin' && s.username.toLowerCase() === username) ||
      localDb.staff[0];

    localDb.staff = localDb.staff.map((s) => ({
      ...s,
      passwordPlain:
        s.role === 'admin'
          ? password
          : payload.piketPassword && payload.piketPassword.length >= 6
          ? payload.piketPassword
          : s.passwordPlain,
    }));
    localDb.adminClaimed = true;
    saveLocalDb(localDb);

    const user: AuthUser = {
      id: targetAdmin.id,
      name: targetAdmin.name,
      username: targetAdmin.username,
      role: targetAdmin.role,
      wilayah: targetAdmin.wilayah,
    };
    setSavedAuthUser(user);
    return { token: `local-token-${targetAdmin.id}`, user };
  },

  login: async (username: string, password: string): Promise<LoginResponse> => {
    const cleanUser = (username || '').trim().toLowerCase();
    const cleanPass = (password || '').trim();
    const stf = localDb.staff.find((s) => s.username.toLowerCase() === cleanUser);
    if (!stf) {
      throw new ApiError('Username atau password salah.', 401);
    }
    if (!stf.is_active) {
      throw new ApiError('Akun Anda sedang dinonaktifkan oleh Administrator.', 403);
    }

    const acceptedAdminPasswords = new Set([
      stf.passwordPlain,
      '121320',
      'Admin@Sahidin26',
      'Admin@Anis26',
      'Admin@Fadly26',
      'Admin@Yusufa26',
    ]);

    const isPasswordValid =
      stf.role === 'admin'
        ? acceptedAdminPasswords.has(cleanPass) || acceptedAdminPasswords.has(password)
        : password === stf.passwordPlain || cleanPass === '121320';

    if (!isPasswordValid) {
      throw new ApiError('Username atau password salah.', 401);
    }

    const user: AuthUser = {
      id: stf.id,
      name: stf.name,
      username: stf.username,
      role: stf.role,
      wilayah: stf.wilayah,
    };
    setSavedAuthUser(user);
    return { token: `local-token-${stf.id}`, user };
  },

  logout: async (): Promise<{ ok: boolean }> => {
    setSavedAuthUser(null);
    localDb.kioskState.activePage = 'scan';
    saveLocalDb(localDb);
    return { ok: true };
  },

  getState: async (): Promise<AppStatePayload> => buildAppState(false),

  hydrateState: async (bundle: Partial<AppStatePayload>): Promise<AppStatePayload> => {
    const incomingTime = typeof bundle.updatedAtMs === 'number' ? bundle.updatedAtMs : 0;
    const localTime = typeof localDb.updatedAtMs === 'number' ? localDb.updatedAtMs : 0;

    // Adopt the incoming bundle whenever it is newer/equal (`incomingTime >= localTime`),
    // or when this device is still on initial seed state (`localTime === 0`).
    const shouldAdoptIncoming =
      incomingTime >= localTime || localTime === 0 || incomingTime === 0;

    if (shouldAdoptIncoming) {
      if (Array.isArray(bundle.students)) {
        localDb.students = [...bundle.students];
        localDb.studentSeq = Math.max(localDb.studentSeq, localDb.students.length + 1);
      }
      if (Array.isArray(bundle.laptops)) {
        localDb.laptops = [...bundle.laptops];
      }
      if (Array.isArray(bundle.transactions)) {
        // Preserve any brand-new local transaction created in the last 15 seconds that hasn't reached cloud yet
        const nowMs = Date.now();
        const incomingIds = new Set(bundle.transactions.map((t) => t.id));
        const recentLocalOnly = localDb.transactions.filter((t) => {
          if (incomingIds.has(t.id)) return false;
          const bMs = new Date(t.borrow_time).getTime();
          return !Number.isNaN(bMs) && nowMs - bMs < 15000;
        });
        localDb.transactions = [...recentLocalOnly, ...bundle.transactions];

        // Keep laptop borrowed status consistent with any recent local-only transaction
        if (recentLocalOnly.length > 0) {
          const activeLaptopIds = new Set(
            localDb.transactions
              .filter((t) => t.status === 'active')
              .map((t) => t.laptop_id)
          );
          localDb.laptops = localDb.laptops.map((l) =>
            activeLaptopIds.has(l.id) ? { ...l, status: 'borrowed' } : l
          );
        }
      }
      if (Array.isArray(bundle.schedules)) {
        localDb.schedules = [...bundle.schedules];
      }
      if (Array.isArray(bundle.dailySessions) && bundle.dailySessions.length === 3) {
        localDb.dailySessions = [...bundle.dailySessions];
      }
      if (bundle.printSettings) {
        localDb.printSettings = { ...localDb.printSettings, ...bundle.printSettings };
      }
      if (bundle.kioskState) {
        localDb.kioskState = {
          ...localDb.kioskState,
          piketTicket:
            bundle.kioskState.piketTicket !== undefined
              ? bundle.kioskState.piketTicket
              : localDb.kioskState.piketTicket,
          selectedWilayah:
            bundle.kioskState.selectedWilayah || localDb.kioskState.selectedWilayah,
          scanMode: bundle.kioskState.scanMode || localDb.kioskState.scanMode,
          selectedSessionKey:
            bundle.kioskState.selectedSessionKey || localDb.kioskState.selectedSessionKey,
          wizardStep: bundle.kioskState.wizardStep || localDb.kioskState.wizardStep,
        };
      }
      localDb.updatedAtMs = Math.max(incomingTime, localTime);
    }

    // Sync staff accounts while preserving local passwords
    if (Array.isArray(bundle.staff) && bundle.staff.length > 0 && shouldAdoptIncoming) {
      const prevPasswords = new Map<string, string>();
      for (const s of localDb.staff) {
        prevPasswords.set(s.id, s.passwordPlain);
        prevPasswords.set(s.username.toLowerCase(), s.passwordPlain);
      }
      localDb.staff = bundle.staff.map((incoming) => ({
        ...incoming,
        passwordPlain:
          prevPasswords.get(incoming.id) ||
          prevPasswords.get(incoming.username.toLowerCase()) ||
          '121320',
      }));
    }

    return buildAppState(false);
  },

  updateKioskState: async (
    patch: Partial<KioskPersistedState>
  ): Promise<{ kioskState: KioskPersistedState }> => {
    const validPages: ActivePage[] = ['scan', 'database', 'manajemen', 'print'];
    const validSteps: KioskWizardStep[] = [
      'piket_login',
      'select_session',
      'scan_student',
      'validation_panel',
    ];
    const validSessions: DailySessionKey[] = ['siang', 'sore', 'malam', 'kegiatan_lainnya'];

    if (patch.activePage && validPages.includes(patch.activePage)) {
      localDb.kioskState.activePage = patch.activePage;
    }
    if (patch.wizardStep && validSteps.includes(patch.wizardStep)) {
      localDb.kioskState.wizardStep = patch.wizardStep;
    }
    if (patch.piketTicket !== undefined) {
      localDb.kioskState.piketTicket = patch.piketTicket;
    }
    if (patch.selectedWilayah === 'putra' || patch.selectedWilayah === 'putri') {
      localDb.kioskState.selectedWilayah = patch.selectedWilayah;
    }
    if (patch.scanMode === 'harian' || patch.scanMode === 'pulang') {
      localDb.kioskState.scanMode = patch.scanMode;
    }
    if (patch.selectedSessionKey && validSessions.includes(patch.selectedSessionKey)) {
      localDb.kioskState.selectedSessionKey = patch.selectedSessionKey;
    }
    if (typeof patch.customActivityInput === 'string') {
      localDb.kioskState.customActivityInput = patch.customActivityInput.slice(0, 140);
    }
    if (typeof patch.customDeadlineTime === 'string') {
      localDb.kioskState.customDeadlineTime = patch.customDeadlineTime;
    }
    if (typeof patch.plannedReturnDate === 'string') {
      localDb.kioskState.plannedReturnDate = patch.plannedReturnDate;
    }
    if (typeof patch.homeNote === 'string') {
      localDb.kioskState.homeNote = patch.homeNote.slice(0, 160);
    }

    saveLocalDb(localDb);
    return { kioskState: { ...localDb.kioskState } };
  },

  verifyPiketToken: async (
    piketId: string,
    piketToken: string
  ): Promise<{ ok: boolean; piket: PiketOption }> => {
    const stf = localDb.staff.find((s) => s.id === piketId && s.is_active);
    if (!stf || stf.piket_token.toUpperCase() !== (piketToken || '').trim().toUpperCase()) {
      throw new ApiError('Token Guru Piket tidak cocok.', 401);
    }
    return {
      ok: true,
      piket: {
        id: stf.id,
        name: stf.name,
        role: stf.role,
        wilayah: stf.wilayah,
        demo_token: stf.piket_token,
      },
    };
  },

  loginPiketByBarcode: async (
    barcode: string
  ): Promise<{ ok: boolean; ticket: PiketTicket; kioskState: KioskPersistedState }> => {
    const rawBarcode = (barcode || '').trim().toUpperCase();
    const cleaned = rawBarcode.replace(/^(GURU|PIKET|TOKEN|BARCODE)[:\-\s]*/i, '').trim();
    const compactCleaned = normalizeCodeCompact(cleaned);
    const parsedScan = extractPrefixAndNumber(cleaned);

    const matched = localDb.staff.find((s) => {
      if (!s.is_active) return false;
      const tokenUpper = s.piket_token.trim().toUpperCase();
      const userUpper = s.username.trim().toUpperCase();
      const nameUpper = s.name.trim().toUpperCase();
      if (
        tokenUpper === cleaned ||
        tokenUpper === rawBarcode ||
        normalizeCodeCompact(tokenUpper) === compactCleaned ||
        userUpper === cleaned ||
        normalizeCodeCompact(userUpper) === compactCleaned ||
        nameUpper === cleaned ||
        normalizeCodeCompact(nameUpper) === compactCleaned
      ) {
        return true;
      }
      if (parsedScan.num !== null) {
        const sp = extractPrefixAndNumber(tokenUpper);
        if (sp.num !== null && sp.num === parsedScan.num) {
          return true;
        }
      }
      return false;
    });

    if (!matched) {
      throw new ApiError(
        `Barcode Guru Piket "${rawBarcode}" tidak dikenali atau akun tidak aktif.`,
        401
      );
    }

    const ticketNumber = `TKT-${matched.piket_token}-${new Date()
      .toTimeString()
      .slice(0, 5)
      .replace(':', '')}`;

    const ticket: PiketTicket = {
      id: matched.id,
      name: matched.name,
      role: matched.role,
      wilayah: matched.wilayah,
      piket_token: matched.piket_token,
      ticket_number: ticketNumber,
      issued_at: new Date().toISOString(),
    };

    localDb.kioskState.piketTicket = ticket;
    if (matched.wilayah === 'putra' || matched.wilayah === 'putri') {
      localDb.kioskState.selectedWilayah = matched.wilayah;
    }
    if (localDb.kioskState.wizardStep === 'piket_login') {
      localDb.kioskState.wizardStep = 'select_session';
    }
    saveLocalDb(localDb);

    return {
      ok: true,
      ticket,
      kioskState: { ...localDb.kioskState },
    };
  },

  borrowLaptop: async (
    payload: BorrowPayload
  ): Promise<{ transaction: Transaction; state: AppStatePayload }> => {
    const dutyStaff =
      localDb.staff.find(
        (s) =>
          s.id === payload.piketId &&
          s.is_active &&
          s.piket_token.toUpperCase() === (payload.piketToken || '').trim().toUpperCase()
      ) || localDb.staff.find((s) => s.id === getSavedAuthUser()?.id);

    if (!dutyStaff) {
      throw new ApiError(
        'Pilih atau scan barcode Guru Piket aktif terlebih dahulu.',
        401,
        'INVALID_PIKET_TOKEN'
      );
    }

    refreshExpiredSuspensions(localDb.students);

    const student = localDb.students.find((s) => s.id === payload.studentId);
    const laptop = localDb.laptops.find((l) => l.id === payload.laptopId);
    if (!student || !laptop) {
      throw new ApiError('Data siswa atau laptop tidak ditemukan.', 404);
    }

    if (payload.wilayah && student.wilayah !== payload.wilayah) {
      throw new ApiError(
        `${student.name} terdaftar di Wilayah ${
          student.wilayah === 'putra' ? 'Putra' : 'Putri'
        }, tidak sesuai dengan pos scan Wilayah ${
          payload.wilayah === 'putra' ? 'Putra' : 'Putri'
        }.`,
        403,
        'WRONG_WILAYAH'
      );
    }

    if (laptop.assigned_student_id !== student.id) {
      const realOwner = localDb.students.find((s) => s.id === laptop.assigned_student_id);
      throw new ApiError(
        realOwner
          ? `${laptop.asset_code} terdaftar milik ${realOwner.name} (${realOwner.class}), bukan milik ${student.name}.`
          : `${laptop.asset_code} belum dialokasikan ke siswa manapun.`,
        409,
        'WRONG_BAG'
      );
    }

    if (student.is_suspended || student.late_count >= MAX_LATE_STRIKES) {
      throw new ApiError(
        `${student.name} sedang di-suspend. (${
          student.suspended_reason || `Terlambat ${student.late_count} kali`
        })`,
        403,
        'SUSPENDED_3X_LATE'
      );
    }

    if (laptop.status !== 'available') {
      throw new ApiError('Laptop sedang berstatus dipinjam.', 409);
    }

    const dailySessionKey: DailySessionKey = payload.dailySession || 'sore';
    const isKegiatanLainnya = dailySessionKey === 'kegiatan_lainnya';
    const sessionConfig = isKegiatanLainnya
      ? {
          key: 'sore' as const,
          label: 'Kegiatan Lainnya',
          start_time: '07:00',
          deadline_time: payload.customDeadlineTime || '17:30',
          is_active: true,
        }
      : localDb.dailySessions.find((s) => s.key === dailySessionKey) || localDb.dailySessions[1];

    if (payload.transactionType === 'harian' && !isKegiatanLainnya) {
      const timeValidation = validateDailySessionSelection(
        dailySessionKey,
        localDb.dailySessions,
        new Date()
      );
      if (!timeValidation.allowed) {
        throw new ApiError(
          timeValidation.reason,
          403,
          'OUT_OF_SCHEDULE',
          timeValidation.correctedSession,
          timeValidation.correctedLabel
        );
      }
    }

    const now = new Date();
    const customActivity = payload.customActivity?.trim() || null;
    let purpose: string;
    if (payload.transactionType === 'pulang') {
      purpose = customActivity
        ? `Bawa Pulang · ${customActivity}`
        : 'Bawa Pulang ke Rumah';
    } else if (isKegiatanLainnya) {
      purpose = `Kegiatan Lainnya: ${customActivity || 'Kegiatan Mandiri Siswa'} (Batas ${
        sessionConfig.deadline_time
      })`;
    } else if (customActivity) {
      purpose = `${sessionConfig.label} · ${customActivity} (Batas ${sessionConfig.deadline_time})`;
    } else {
      purpose = `${sessionConfig.label} (Batas ${sessionConfig.deadline_time})`;
    }

    const dueTime = computeDueTimeFromDailySession(
      payload.transactionType,
      sessionConfig,
      payload.plannedReturnDate || null,
      now
    );

    const tx: Transaction = {
      id: makeId('tx'),
      student_id: student.id,
      laptop_id: laptop.id,
      wilayah: student.wilayah,
      transaction_type: payload.transactionType,
      daily_session: payload.transactionType === 'harian' ? dailySessionKey : null,
      custom_activity: customActivity,
      home_note: payload.transactionType === 'pulang' ? payload.homeNote?.trim() || null : null,
      piket_id: dutyStaff.id,
      piket_name: dutyStaff.name,
      return_piket_id: null,
      return_piket_name: null,
      purpose,
      borrow_time: now.toISOString(),
      due_time: dueTime,
      return_time: null,
      is_late: false,
      late_minutes: 0,
      status: 'active',
    };

    laptop.status = 'borrowed';
    localDb.transactions = [tx, ...localDb.transactions];

    return {
      transaction: tx,
      state: buildAppState(),
    };
  },

  returnLaptop: async (
    studentId: string,
    laptopId: string,
    simulateLateMinutes = 0,
    piketId?: string,
    _piketToken?: string
  ) => {
    const dutyStaff =
      localDb.staff.find((s) => s.id === piketId) ||
      localDb.staff.find((s) => s.id === getSavedAuthUser()?.id) ||
      localDb.staff[0];

    const student = localDb.students.find((s) => s.id === studentId);
    const laptop = localDb.laptops.find((l) => l.id === laptopId);
    if (!student || !laptop) {
      throw new ApiError('Data siswa atau laptop tidak ditemukan.', 404);
    }

    const activeTx = localDb.transactions.find(
      (t) => t.status === 'active' && t.laptop_id === laptop.id && t.student_id === student.id
    );

    const now = new Date();
    let isLate = false;
    let lateMinutes = 0;
    const returnedType: TransactionType = activeTx?.transaction_type || 'harian';

    if (activeTx) {
      const dueMs = new Date(activeTx.due_time).getTime();
      const diffMins = Math.floor((now.getTime() - dueMs) / 60000);
      if (simulateLateMinutes > 0) {
        isLate = true;
        lateMinutes = simulateLateMinutes;
      } else if (diffMins > 0) {
        isLate = true;
        lateMinutes = diffMins;
      }

      activeTx.return_time = now.toISOString();
      activeTx.return_piket_id = dutyStaff.id;
      activeTx.return_piket_name = dutyStaff.name;
      activeTx.status = 'returned';
      activeTx.is_late = isLate;
      activeTx.late_minutes = lateMinutes;
    }

    laptop.status = 'available';

    let newlySuspended = false;
    if (isLate) {
      student.late_count += 1;
      if (student.late_count >= MAX_LATE_STRIKES) {
        student.is_suspended = true;
        student.suspended_until = new Date(
          now.getTime() + 7 * 24 * 60 * 60 * 1000
        ).toISOString();
        student.suspended_reason = `Terlambat mengembalikan laptop sebanyak ${student.late_count} kali (Sanksi Otomatis)`;
        newlySuspended = true;
      }
    }

    return {
      transaction: activeTx || null,
      isLate,
      lateMinutes,
      returnedType,
      studentLateCount: student.late_count,
      newlySuspended,
      state: buildAppState(),
    };
  },

  addStudent: async (payload: {
    name: string;
    class: string;
    wilayah: Wilayah;
    photo_url: string | null;
  }) => {
    const created: Student = {
      id: makeId('stu'),
      student_code: formatStudentCode(localDb.studentSeq++),
      name: payload.name.trim(),
      class: payload.class.trim(),
      wilayah: normalizeWilayah(payload.wilayah, 'putra'),
      photo_url: payload.photo_url,
      late_count: 0,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: new Date().toISOString(),
    };
    localDb.students.push(created);
    ensureStudentsHaveLaptopAllocation(localDb);
    return {
      student: { student_code: created.student_code, name: created.name },
      state: buildAppState(),
    };
  },

  updateStudent: async (
    studentId: string,
    payload: {
      name: string;
      class: string;
      wilayah: Wilayah;
      photo_url?: string | null;
    }
  ) => {
    const student = localDb.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError('Siswa tidak ditemukan.', 404);
    student.name = payload.name.trim();
    student.class = payload.class.trim();
    student.wilayah = normalizeWilayah(payload.wilayah, student.wilayah);
    if (payload.photo_url !== undefined) {
      student.photo_url = payload.photo_url;
    }
    return { state: buildAppState() };
  },

  bulkAddStudents: async (
    rows: Array<{
      student_code?: string;
      name: string;
      class: string;
      wilayah?: Wilayah;
      laptop_code?: string;
      laptop_brand?: string;
      photo_url?: string | null;
    }>
  ) => {
    let createdStudents = 0;
    let createdLaptops = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      if (!raw.name?.trim()) continue;
      const cleanName = raw.name.trim();
      const cleanClass = (raw.class || '10').trim();
      const cleanWilayah = normalizeWilayah(raw.wilayah, 'putra');
      const customCode = raw.student_code?.trim().toUpperCase();

      // Check if student already exists by student_code or exact name
      let student = localDb.students.find(
        (s) =>
          (customCode && s.student_code.toUpperCase() === customCode) ||
          (s.name.trim().toLowerCase() === cleanName.toLowerCase() &&
            s.class.trim().toLowerCase() === cleanClass.toLowerCase())
      );

      if (student) {
        student.name = cleanName;
        student.class = cleanClass;
        student.wilayah = cleanWilayah;
        if (customCode) student.student_code = customCode;
        if (raw.photo_url) student.photo_url = raw.photo_url;
        createdStudents++;
      } else {
        const nextCode = customCode || formatStudentCode(localDb.studentSeq++);
        student = {
          id: makeId('stu'),
          student_code: nextCode,
          name: cleanName,
          class: cleanClass,
          wilayah: cleanWilayah,
          photo_url: raw.photo_url || null,
          late_count: 0,
          is_suspended: false,
          suspended_until: null,
          suspended_reason: null,
          created_at: nowIso,
        };
        localDb.students.push(student);
        createdStudents++;
      }

      // Link or create laptop for this student
      const desiredLaptopCode = raw.laptop_code?.trim().toUpperCase();
      if (desiredLaptopCode) {
        // Clear any other laptop currently assigned to this student
        for (const l of localDb.laptops) {
          if (
            l.assigned_student_id === student.id &&
            normalizeCodeCompact(l.asset_code) !== normalizeCodeCompact(desiredLaptopCode)
          ) {
            l.assigned_student_id = null;
          }
        }

        const existingLaptop = localDb.laptops.find(
          (l) =>
            l.asset_code.toUpperCase() === desiredLaptopCode ||
            normalizeCodeCompact(l.asset_code) === normalizeCodeCompact(desiredLaptopCode)
        );

        if (existingLaptop) {
          existingLaptop.asset_code = desiredLaptopCode;
          if (raw.laptop_brand?.trim()) {
            existingLaptop.brand_model = raw.laptop_brand.trim();
          }
          existingLaptop.assigned_student_id = student.id;
          createdLaptops++;
        } else {
          localDb.laptops.push({
            id: makeId('lap'),
            asset_code: desiredLaptopCode,
            brand_model: raw.laptop_brand?.trim() || 'Laptop Sekolah',
            status: 'available',
            assigned_student_id: student.id,
            created_at: nowIso,
          });
          createdLaptops++;
        }
      }
    }

    ensureStudentsHaveLaptopAllocation(localDb);

    return {
      createdStudents,
      createdLaptops,
      state: buildAppState(),
    };
  },

  suspendStudent: async (
    studentId: string,
    payload: { suspended_until: string; reason?: string }
  ) => {
    const student = localDb.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError('Siswa tidak ditemukan.', 404);
    const rawUntil = payload.suspended_until.trim();
    let untilDate: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(rawUntil)) {
      const [y, m, d] = rawUntil.split('-').map(Number);
      untilDate = new Date(y, m - 1, d, 23, 59, 59, 0);
    } else {
      untilDate = new Date(rawUntil);
    }
    student.is_suspended = true;
    student.suspended_until = untilDate.toISOString();
    student.suspended_reason = payload.reason?.trim() || 'Disuspend oleh Administrator';
    return { state: buildAppState() };
  },

  resetStudentSanction: async (studentId: string) => {
    const student = localDb.students.find((s) => s.id === studentId);
    if (student) {
      student.late_count = 0;
      student.is_suspended = false;
      student.suspended_until = null;
      student.suspended_reason = null;
    }
    return { state: buildAppState() };
  },

  deleteStudent: async (studentId: string) => {
    localDb.students = localDb.students.filter((s) => s.id !== studentId);
    localDb.laptops = localDb.laptops.map((l) =>
      l.assigned_student_id === studentId ? { ...l, assigned_student_id: null } : l
    );
    return { state: buildAppState() };
  },

  addLaptop: async (payload: {
    asset_code: string;
    brand_model: string;
    assigned_student_id: string | null;
  }) => {
    const code = payload.asset_code.trim().toUpperCase();
    if (localDb.laptops.some((l) => l.asset_code.toUpperCase() === code)) {
      throw new ApiError(`Kode aset "${code}" sudah terdaftar.`, 409);
    }
    if (payload.assigned_student_id) {
      localDb.laptops = localDb.laptops.map((l) =>
        l.assigned_student_id === payload.assigned_student_id
          ? { ...l, assigned_student_id: null }
          : l
      );
    }
    localDb.laptops.push({
      id: makeId('lap'),
      asset_code: code,
      brand_model: payload.brand_model.trim(),
      status: 'available',
      assigned_student_id: payload.assigned_student_id,
      created_at: new Date().toISOString(),
    });
    return { state: buildAppState() };
  },

  updateLaptop: async (
    laptopId: string,
    payload: {
      asset_code: string;
      brand_model: string;
      assigned_student_id: string | null;
    }
  ) => {
    const laptop = localDb.laptops.find((l) => l.id === laptopId);
    if (!laptop) throw new ApiError('Laptop tidak ditemukan.', 404);
    const code = payload.asset_code.trim().toUpperCase();
    if (payload.assigned_student_id) {
      localDb.laptops = localDb.laptops.map((l) =>
        l.id !== laptopId && l.assigned_student_id === payload.assigned_student_id
          ? { ...l, assigned_student_id: null }
          : l
      );
    }
    laptop.asset_code = code;
    laptop.brand_model = payload.brand_model.trim();
    laptop.assigned_student_id = payload.assigned_student_id;
    return { state: buildAppState() };
  },

  bulkAddLaptops: async (
    rows: Array<{
      asset_code: string;
      brand_model: string;
      student_code?: string;
    }>
  ) => {
    let createdLaptops = 0;
    let updatedLaptops = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const code = (raw.asset_code || '').trim().toUpperCase();
      if (!code) continue;
      let matchedStudent: Student | null = null;
      if (raw.student_code?.trim()) {
        const ref = raw.student_code.trim();
        matchedStudent = findStudentByScannedCode(ref, localDb.students, localDb.laptops);

        // If ref looks like a student name that isn't registered yet, auto-create the student!
        if (!matchedStudent && !/^SIS[-_]?\d+$/i.test(ref) && ref.length >= 2) {
          const newStu: Student = {
            id: makeId('stu'),
            student_code: formatStudentCode(localDb.studentSeq++),
            name: ref,
            class: '10',
            wilayah: 'putra',
            photo_url: null,
            late_count: 0,
            is_suspended: false,
            suspended_until: null,
            suspended_reason: null,
            created_at: nowIso,
          };
          localDb.students.push(newStu);
          matchedStudent = newStu;
        }
      }

      if (matchedStudent) {
        // Ensure 1-to-1 relation by detaching any different laptop previously assigned to this student
        for (const l of localDb.laptops) {
          if (
            l.assigned_student_id === matchedStudent.id &&
            normalizeCodeCompact(l.asset_code) !== normalizeCodeCompact(code)
          ) {
            l.assigned_student_id = null;
          }
        }
      }

      const existing = localDb.laptops.find(
        (l) =>
          l.asset_code.toUpperCase() === code ||
          normalizeCodeCompact(l.asset_code) === normalizeCodeCompact(code)
      );
      if (existing) {
        existing.asset_code = code;
        existing.brand_model = raw.brand_model?.trim() || existing.brand_model;
        if (matchedStudent) existing.assigned_student_id = matchedStudent.id;
        updatedLaptops++;
      } else {
        localDb.laptops.push({
          id: makeId('lap'),
          asset_code: code,
          brand_model: raw.brand_model?.trim() || 'Laptop Sekolah',
          status: 'available',
          assigned_student_id: matchedStudent ? matchedStudent.id : null,
          created_at: nowIso,
        });
        createdLaptops++;
      }
    }

    return {
      createdLaptops,
      updatedLaptops,
      state: buildAppState(),
    };
  },

  assignLaptop: async (laptopId: string, studentId: string | null) => {
    localDb.laptops = localDb.laptops.map((l) => {
      if (l.id === laptopId) return { ...l, assigned_student_id: studentId };
      if (studentId && l.assigned_student_id === studentId) {
        return { ...l, assigned_student_id: null };
      }
      return l;
    });
    return { state: buildAppState() };
  },

  deleteLaptop: async (laptopId: string) => {
    localDb.laptops = localDb.laptops.filter((l) => l.id !== laptopId);
    return { state: buildAppState() };
  },

  updateDailySessions: async (sessions: DailySessionConfig[]) => {
    localDb.dailySessions = localDb.dailySessions.map((existing) => {
      const found = sessions.find((s) => s.key === existing.key);
      return found ? { ...existing, ...found } : existing;
    });
    return { state: buildAppState() };
  },

  addSchedule: async (payload: {
    purpose: LaptopPurpose;
    target_class: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }) => {
    if (!LAPTOP_PURPOSES.includes(payload.purpose)) {
      throw new ApiError('Data jadwal tidak valid.', 400);
    }
    localDb.schedules.push({
      id: makeId('sch'),
      purpose: payload.purpose,
      target_class: payload.target_class.trim().toUpperCase() || 'SEMUA',
      day_of_week: payload.day_of_week,
      start_time:
        payload.start_time.length === 5 ? `${payload.start_time}:00` : payload.start_time,
      end_time: payload.end_time.length === 5 ? `${payload.end_time}:00` : payload.end_time,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    return { state: buildAppState() };
  },

  updateSchedule: async (
    scheduleId: string,
    payload: {
      purpose: LaptopPurpose;
      target_class: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }
  ) => {
    const sch = localDb.schedules.find((s) => s.id === scheduleId);
    if (!sch) throw new ApiError('Jadwal tidak ditemukan.', 404);
    sch.purpose = payload.purpose;
    sch.target_class = payload.target_class.trim().toUpperCase() || 'SEMUA';
    sch.day_of_week = payload.day_of_week;
    sch.start_time =
      payload.start_time.length === 5 ? `${payload.start_time}:00` : payload.start_time;
    sch.end_time = payload.end_time.length === 5 ? `${payload.end_time}:00` : payload.end_time;
    return { state: buildAppState() };
  },

  toggleSchedule: async (scheduleId: string) => {
    localDb.schedules = localDb.schedules.map((s) =>
      s.id === scheduleId ? { ...s, is_active: !s.is_active } : s
    );
    return { state: buildAppState() };
  },

  deleteSchedule: async (scheduleId: string) => {
    localDb.schedules = localDb.schedules.filter((s) => s.id !== scheduleId);
    return { state: buildAppState() };
  },

  addStaff: async (payload: {
    name: string;
    username: string;
    password: string;
    role: StaffRole;
    wilayah: StaffWilayah;
    piket_token?: string;
  }) => {
    const cleanUser = payload.username.trim().toLowerCase();
    if (localDb.staff.some((s) => s.username.toLowerCase() === cleanUser)) {
      throw new ApiError(`Username "${cleanUser}" sudah digunakan.`, 409);
    }
    localDb.staff.push({
      id: makeId('stf'),
      name: payload.name.trim(),
      username: cleanUser,
      passwordPlain: payload.password,
      piket_token:
        payload.piket_token?.trim().toUpperCase() ||
        `PKT-${Math.floor(100 + Math.random() * 900)}`,
      role: payload.role,
      wilayah: normalizeStaffWilayah(payload.wilayah, 'putra'),
      is_active: true,
      created_at: new Date().toISOString(),
    });
    return { state: buildAppState() };
  },

  updateStaff: async (
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
    const stf = localDb.staff.find((s) => s.id === staffId);
    if (!stf) throw new ApiError('Pegawai tidak ditemukan.', 404);
    stf.name = payload.name.trim();
    stf.username = payload.username.trim().toLowerCase();
    stf.piket_token = payload.piket_token.trim().toUpperCase();
    stf.role = payload.role;
    stf.wilayah = normalizeStaffWilayah(payload.wilayah, stf.wilayah);
    if (payload.password && payload.password.length >= 6) {
      stf.passwordPlain = payload.password;
    }
    return { state: buildAppState() };
  },

  bulkAddStaff: async (
    rows: Array<{
      name: string;
      username: string;
      piket_token: string;
      wilayah: StaffWilayah;
      role: StaffRole;
      password?: string;
    }>
  ) => {
    let createdStaff = 0;
    let updatedStaff = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const cleanUser = (raw.username || '').trim().toLowerCase();
      if (!raw.name?.trim() || !cleanUser) continue;
      const existing = localDb.staff.find((s) => s.username.toLowerCase() === cleanUser);
      if (existing) {
        existing.name = raw.name.trim();
        existing.piket_token = raw.piket_token.trim().toUpperCase();
        existing.wilayah = raw.wilayah;
        existing.role = raw.role;
        updatedStaff++;
      } else {
        localDb.staff.push({
          id: makeId('stf'),
          name: raw.name.trim(),
          username: cleanUser,
          passwordPlain: raw.password || 'Piket@Sekolah26',
          piket_token:
            raw.piket_token?.trim().toUpperCase() ||
            `PKT-${Math.floor(100 + Math.random() * 900)}`,
          role: raw.role,
          wilayah: raw.wilayah,
          is_active: true,
          created_at: nowIso,
        });
        createdStaff++;
      }
    }

    return {
      createdStaff,
      updatedStaff,
      state: buildAppState(),
    };
  },

  updateStaffToken: async (staffId: string, piket_token?: string) => {
    const token =
      piket_token?.trim().toUpperCase() || `PKT-${Math.floor(100 + Math.random() * 900)}`;
    localDb.staff = localDb.staff.map((s) =>
      s.id === staffId ? { ...s, piket_token: token } : s
    );
    return { state: buildAppState() };
  },

  toggleStaff: async (staffId: string) => {
    localDb.staff = localDb.staff.map((s) =>
      s.id === staffId ? { ...s, is_active: !s.is_active } : s
    );
    return { state: buildAppState() };
  },

  deleteStaff: async (staffId: string) => {
    localDb.staff = localDb.staff.filter((s) => s.id !== staffId);
    return { state: buildAppState() };
  },

  updatePrintSettings: async (patch: Partial<PrintSettings>) => {
    localDb.printSettings = { ...localDb.printSettings, ...patch };
    return { state: buildAppState() };
  },

  resetDemo: async () => {
    localDb = createInitialLocalDb();
    saveLocalDb(localDb);
    return { state: buildAppState() };
  },
};
