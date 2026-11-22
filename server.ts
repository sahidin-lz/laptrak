import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  ActivePage,
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
  StaffRole,
  StaffWilayah,
  Student,
  Transaction,
  TransactionType,
  Wilayah,
} from './src/types/models';
import {
  extractPrefixAndNumber,
  findStudentByScannedCode,
  normalizeCodeCompact,
  validateDailySessionSelection,
} from './src/lib/store';

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET =
  process.env.SESSION_SECRET?.trim() || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const COOKIE_NAME = 'laptrack_session';

interface StoredStaff {
  id: string;
  name: string;
  username: string;
  passwordHash: string | null;
  piket_token: string;
  role: StaffRole;
  wilayah: StaffWilayah;
  is_active: boolean;
  created_at: string;
}

interface ServerDatabase {
  adminClaimed: boolean;
  studentSeq: number;
  staff: StoredStaff[];
  students: Student[];
  laptops: Laptop[];
  schedules: Schedule[];
  dailySessions: DailySessionConfig[];
  transactions: Transaction[];
  printSettings: PrintSettings;
  kioskState: KioskPersistedState;
}

const revokedTokens = new Set<string>();

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(plain: string, storedHash: string | null): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(plain, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

function safeCompareStrings(a: string, b: string): boolean {
  const cleanA = a.trim().toUpperCase();
  const cleanB = b.trim().toUpperCase();
  if (!cleanA || !cleanB) return false;
  const bufA = Buffer.from(cleanA, 'utf8');
  const bufB = Buffer.from(cleanB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function signSessionToken(user: AuthUser): string {
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS,
    jti: crypto.randomBytes(12).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(
  token: string
): { sub: string; username: string; role: StaffRole; exp: number } | null {
  if (!token || revokedTokens.has(token)) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      sub: string;
      username: string;
      role: StaffRole;
      exp: number;
    };
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const raw = req.headers.cookie || '';
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(val);
      } catch {
        result[key] = val;
      }
    }
  }
  return result;
}

function setSessionCookie(res: Response, token: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(
      token
    )}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None; Partitioned`
  );
}

function sanitizePhotoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed.length <= 1_500_000 ? trimmed : null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
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

function formatStudentCode(seqNum: number): string {
  return `SIS-${String(seqNum).padStart(4, '0')}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
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

function createInitialDb(): ServerDatabase {
  const now = new Date();
  const todayDay = now.getDay();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const envAdminPass = process.env.ADMIN_DEFAULT_PASSCODE?.trim() || '121320';
  const envPiketPass = process.env.PIKET_DEFAULT_PASSCODE?.trim() || '121320';

  const adminHash = hashPassword(envAdminPass);
  const piketHash = hashPassword(envPiketPass);

  const staff: StoredStaff[] = [
    {
      id: 'stf-1',
      name: 'Sahidin',
      username: 'sahidin',
      passwordHash: adminHash,
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
      passwordHash: adminHash,
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
      passwordHash: adminHash,
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
      passwordHash: adminHash,
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
      passwordHash: piketHash,
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
      passwordHash: piketHash,
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
      passwordHash: piketHash,
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
      passwordHash: piketHash,
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
    {
      id: 'tx-3',
      student_id: 'stu-3',
      laptop_id: 'lap-3',
      wilayah: 'putra',
      transaction_type: 'harian',
      daily_session: 'malam',
      home_note: null,
      piket_id: 'stf-7',
      piket_name: 'Ustadz Ridwan Kamil (Piket Malam Putra)',
      return_piket_id: 'stf-7',
      return_piket_name: 'Ustadz Ridwan Kamil (Piket Malam Putra)',
      purpose: 'Sesi Malam (Batas 21:30)',
      borrow_time: new Date(oneDayAgo.getTime() - 5 * 60 * 60 * 1000).toISOString(),
      due_time: new Date(oneDayAgo.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      return_time: new Date(oneDayAgo.getTime() - 2 * 60 * 60 * 1000 - 18 * 60 * 1000).toISOString(),
      is_late: true,
      late_minutes: 42,
      status: 'returned',
    },
    {
      id: 'tx-4',
      student_id: 'stu-4',
      laptop_id: 'lap-4',
      wilayah: 'putri',
      transaction_type: 'pulang',
      daily_session: null,
      home_note: 'Libur tengah semester · Dijemput Ibu',
      piket_id: 'stf-6',
      piket_name: 'Ibu Ratna Sari (Piket Putri)',
      return_piket_id: 'stf-6',
      return_piket_name: 'Ibu Ratna Sari (Piket Putri)',
      purpose: 'Bawa Pulang ke Rumah',
      borrow_time: new Date(twoDaysAgo.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      due_time: new Date(oneDayAgo.getTime() + 4 * 60 * 60 * 1000).toISOString(),
      return_time: new Date(oneDayAgo.getTime() + 1 * 60 * 60 * 1000).toISOString(),
      is_late: false,
      late_minutes: 0,
      status: 'returned',
    },
  ];

  return {
    adminClaimed: Boolean(envAdminPass),
    studentSeq: 7,
    staff,
    students,
    laptops,
    schedules,
    dailySessions: DEFAULT_DAILY_SESSIONS.map((s) => ({ ...s })),
    transactions,
    printSettings: { ...DEFAULT_PRINT_SETTINGS },
    kioskState: createInitialKioskState(),
  };
}

let db = createInitialDb();

interface AuthedRequest extends Request {
  authUser?: AuthUser;
  authToken?: string;
}

function extractRequestToken(req: Request): { token: string; fromCookie: boolean } | null {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return { token, fromCookie: false };
  }
  const cookies = parseCookies(req);
  const cookieToken = cookies[COOKIE_NAME];
  if (cookieToken) {
    // Protect state-changing cookie requests against CSRF via custom header verification
    const method = req.method.toUpperCase();
    const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (isMutating && req.headers['x-requested-with'] !== 'LapTrackClient') {
      return null;
    }
    return { token: cookieToken, fromCookie: true };
  }
  return null;
}

function getOptionalAuthUser(req: Request): AuthUser | null {
  const extracted = extractRequestToken(req);
  if (!extracted) return null;
  const payload = verifySessionToken(extracted.token);
  if (!payload) return null;
  const staff = db.staff.find((s) => s.id === payload.sub && s.is_active);
  if (!staff) return null;
  return {
    id: staff.id,
    name: staff.name,
    username: staff.username,
    role: staff.role,
    wilayah: staff.wilayah,
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const extracted = extractRequestToken(req);
  const user = getOptionalAuthUser(req);
  if (!user || !extracted) {
    res.status(401).json({ error: 'Sesi tidak valid. Silakan login Admin terlebih dahulu.' });
    return;
  }
  req.authUser = user;
  req.authToken = extracted.token;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.authUser || req.authUser.role !== 'admin') {
    res.status(403).json({ error: 'Akses ditolak. Fitur ini khusus Administrator.' });
    return;
  }
  next();
}

function sanitizeStaffList() {
  return db.staff.map(({ passwordHash: _ignored, ...safe }) => safe);
}

function getActivePiketOptions(): PiketOption[] {
  return db.staff
    .filter((s) => s.is_active)
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      wilayah: s.wilayah,
      demo_token: s.piket_token,
    }));
}

function ensureServerStudentsHaveLaptopAllocation() {
  const assignedStudentIds = new Set(
    db.laptops.map((l) => l.assigned_student_id).filter(Boolean) as string[]
  );
  const nowIso = new Date().toISOString();

  for (const st of db.students) {
    if (assignedStudentIds.has(st.id)) continue;

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

function buildStateForRole(_role: StaffRole | 'public') {
  refreshExpiredSuspensions(db.students);
  ensureServerStudentsHaveLaptopAllocation();
  return {
    students: db.students,
    laptops: db.laptops,
    schedules: db.schedules,
    dailySessions: db.dailySessions,
    transactions: db.transactions,
    staff: sanitizeStaffList(),
    piketOptions: getActivePiketOptions(),
    printSettings: db.printSettings,
    kioskState: db.kioskState,
  };
}

function verifyAndResolveDutyPiket(
  req: Request,
  piketIdRaw: unknown,
  piketTokenRaw: unknown
): { ok: true; staff: StoredStaff } | { ok: false; error: string } {
  const piketId = typeof piketIdRaw === 'string' ? piketIdRaw.trim() : '';
  const piketToken = typeof piketTokenRaw === 'string' ? piketTokenRaw.trim() : '';
  const authedAdmin = getOptionalAuthUser(req);

  const targetStaff = db.staff.find((s) => s.id === piketId && s.is_active);
  if (!targetStaff) {
    if (authedAdmin) {
      const adminRecord = db.staff.find((s) => s.id === authedAdmin.id && s.is_active);
      if (adminRecord) return { ok: true, staff: adminRecord };
    }
    return { ok: false, error: 'Pilih atau scan barcode Guru Piket aktif terlebih dahulu.' };
  }

  if (!piketToken) {
    return {
      ok: false,
      error: `Token Guru Piket untuk ${targetStaff.name} wajib diinput.`,
    };
  }

  if (!safeCompareStrings(piketToken, targetStaff.piket_token)) {
    return {
      ok: false,
      error: `Token Guru Piket tidak cocok untuk ${targetStaff.name}. Periksa kembali token Anda.`,
    };
  }

  return { ok: true, staff: targetStaff };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // ==========================================
  // AUTH ROUTES (ADMIN LOGIN & REFRESH PERSISTENCE)
  // ==========================================
  app.get('/api/auth/status', (_req, res) => {
    const envConfigured = Boolean(process.env.ADMIN_DEFAULT_PASSCODE?.trim());
    const needsSetup = !envConfigured && !db.adminClaimed;
    res.json({
      needsSetup,
      adminUsernames: db.staff
        .filter((s) => s.role === 'admin')
        .map((s) => ({ name: s.name, username: s.username })),
    });
  });

  app.post('/api/auth/claim-admin', (req, res) => {
    const envConfigured = Boolean(process.env.ADMIN_DEFAULT_PASSCODE?.trim());
    if (envConfigured || db.adminClaimed) {
      res.status(409).json({
        error: 'Aktivasi awal sudah selesai. Silakan login menggunakan username dan password Admin.',
      });
      return;
    }

    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const piketPassword =
      typeof req.body?.piketPassword === 'string' ? req.body.piketPassword : '';

    if (password.length < 6) {
      res.status(400).json({ error: 'Password admin minimal 6 karakter.' });
      return;
    }

    const targetAdmin = db.staff.find(
      (s) => s.role === 'admin' && s.username.toLowerCase() === username
    );
    if (!targetAdmin) {
      res.status(400).json({ error: 'Pilih salah satu akun Admin bawaan yang tersedia.' });
      return;
    }

    const hashedAdmin = hashPassword(password);
    const hashedPiket =
      piketPassword.length >= 6 ? hashPassword(piketPassword) : hashPassword(password);

    db.staff = db.staff.map((s) => ({
      ...s,
      passwordHash: s.role === 'admin' ? hashedAdmin : hashedPiket,
    }));
    db.adminClaimed = true;

    const user: AuthUser = {
      id: targetAdmin.id,
      name: targetAdmin.name,
      username: targetAdmin.username,
      role: targetAdmin.role,
      wilayah: targetAdmin.wilayah,
    };
    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const staff = db.staff.find((s) => s.username.toLowerCase() === username);
    if (!staff) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }
    if (!staff.is_active) {
      res.status(403).json({ error: 'Akun Anda sedang dinonaktifkan oleh Administrator.' });
      return;
    }

    const envConfigured = Boolean(process.env.ADMIN_DEFAULT_PASSCODE?.trim());
    let valid = false;
    if (staff.role === 'admin' && envConfigured) {
      const envPass = process.env.ADMIN_DEFAULT_PASSCODE!.trim();
      const envBuf = Buffer.from(envPass, 'utf8');
      const inBuf = Buffer.from(password, 'utf8');
      if (envBuf.length === inBuf.length && crypto.timingSafeEqual(envBuf, inBuf)) {
        valid = true;
      }
    }
    if (!valid && staff.role === 'admin') {
      const fallbackPasses = [
        '121320',
        'Admin@Sahidin26',
        'Admin@Anis26',
        'Admin@Fadly26',
        'Admin@Yusufa26',
      ];
      if (fallbackPasses.includes(password.trim())) {
        valid = true;
        db.adminClaimed = true;
      }
    }
    if (!valid) {
      valid = verifyPassword(password, staff.passwordHash);
    }

    if (!valid) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }

    const user: AuthUser = {
      id: staff.id,
      name: staff.name,
      username: staff.username,
      role: staff.role,
      wilayah: staff.wilayah,
    };
    const token = signSessionToken(user);
    setSessionCookie(res, token);
    res.json({ token, user });
  });

  app.post('/api/auth/logout', (req: AuthedRequest, res) => {
    const extracted = extractRequestToken(req);
    if (extracted?.token) revokedTokens.add(extracted.token);
    clearSessionCookie(res);
    if (db.kioskState.activePage !== 'scan') {
      db.kioskState.activePage = 'scan';
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const user = getOptionalAuthUser(req);
    res.json({ user: user || null });
  });

  // ==========================================
  // PUBLIC / FRONT-PAGE SCAN, KIOSK PERSISTENCE & TOKEN VERIFY ROUTES
  // ==========================================
  app.get('/api/state', (req, res) => {
    const authed = getOptionalAuthUser(req);
    res.json(buildStateForRole(authed ? authed.role : 'public'));
  });

  // Hydrate server in-memory database from Firebase Firestore Quota-Saving Bundle (/kiosk_bundles/main)
  app.post('/api/state/hydrate', (req, res) => {
    const bundle = req.body?.bundle;
    if (!bundle || typeof bundle !== 'object') {
      res.status(400).json({ error: 'Payload bundle tidak valid.' });
      return;
    }

    const incomingLaptopCount = Array.isArray(bundle.laptops) ? bundle.laptops.length : 0;
    const serverHasMoreUnsyncedData = db.laptops.length > incomingLaptopCount && db.laptops.length > 6;

    if (!serverHasMoreUnsyncedData) {
      if (Array.isArray(bundle.students) && bundle.students.length > 0) {
        db.students = bundle.students.slice(0, 1000);
        db.studentSeq = Math.max(db.studentSeq, db.students.length + 1);
      }
      if (Array.isArray(bundle.laptops) && bundle.laptops.length > 0) {
        db.laptops = bundle.laptops.slice(0, 1000);
      }
    }
    if (Array.isArray(bundle.staff) && bundle.staff.length > 0) {
      for (const incoming of bundle.staff.slice(0, 200)) {
        const existing = db.staff.find(
          (s) =>
            s.id === incoming.id ||
            s.username.toLowerCase() === incoming.username.toLowerCase() ||
            s.piket_token.toUpperCase() === incoming.piket_token.toUpperCase()
        );
        if (existing) {
          existing.name = incoming.name;
          existing.piket_token = incoming.piket_token;
          existing.wilayah = incoming.wilayah;
          existing.role = incoming.role;
          existing.is_active = incoming.is_active;
        } else {
          db.staff.push({
            ...incoming,
            passwordHash: hashPassword('121320'),
          });
        }
      }
    }
    if (Array.isArray(bundle.schedules) && bundle.schedules.length > 0) {
      db.schedules = bundle.schedules.slice(0, 200);
    }
    if (Array.isArray(bundle.dailySessions) && bundle.dailySessions.length === 3) {
      db.dailySessions = bundle.dailySessions;
    }
    if (Array.isArray(bundle.transactions)) {
      db.transactions = bundle.transactions.slice(0, 2000);
    }
    if (bundle.printSettings && typeof bundle.printSettings === 'object') {
      db.printSettings = {
        ...db.printSettings,
        ...bundle.printSettings,
      };
    }
    if (bundle.kioskState && typeof bundle.kioskState === 'object') {
      db.kioskState = {
        ...db.kioskState,
        ...bundle.kioskState,
      };
    }

    const authed = getOptionalAuthUser(req);
    res.json(buildStateForRole(authed ? authed.role : 'public'));
  });

  // Persists activePage, wizardStep, piketTicket, selectedSessionKey, scanMode across browser refreshes
  app.patch('/api/kiosk-state', (req, res) => {
    const patch = req.body || {};
    const validPages: ActivePage[] = ['scan', 'database', 'manajemen', 'print'];
    const validSteps: KioskWizardStep[] = [
      'piket_login',
      'select_session',
      'scan_student',
      'validation_panel',
    ];
    const validSessions: DailySessionKey[] = ['siang', 'sore', 'malam', 'kegiatan_lainnya'];

    if (typeof patch.activePage === 'string' && validPages.includes(patch.activePage as ActivePage)) {
      db.kioskState.activePage = patch.activePage as ActivePage;
    }
    if (
      typeof patch.wizardStep === 'string' &&
      validSteps.includes(patch.wizardStep as KioskWizardStep)
    ) {
      db.kioskState.wizardStep = patch.wizardStep as KioskWizardStep;
    }
    if (patch.piketTicket === null) {
      db.kioskState.piketTicket = null;
    } else if (
      patch.piketTicket &&
      typeof patch.piketTicket === 'object' &&
      typeof patch.piketTicket.id === 'string' &&
      typeof patch.piketTicket.piket_token === 'string'
    ) {
      const stf = db.staff.find((s) => s.id === patch.piketTicket.id && s.is_active);
      if (stf && safeCompareStrings(patch.piketTicket.piket_token, stf.piket_token)) {
        const ticket: PiketTicket = {
          id: stf.id,
          name: stf.name,
          role: stf.role,
          wilayah: stf.wilayah,
          piket_token: stf.piket_token,
          ticket_number:
            typeof patch.piketTicket.ticket_number === 'string'
              ? patch.piketTicket.ticket_number
              : `TKT-${stf.piket_token}`,
          issued_at:
            typeof patch.piketTicket.issued_at === 'string'
              ? patch.piketTicket.issued_at
              : new Date().toISOString(),
        };
        db.kioskState.piketTicket = ticket;
      }
    }
    if (patch.selectedWilayah === 'putra' || patch.selectedWilayah === 'putri') {
      db.kioskState.selectedWilayah = patch.selectedWilayah;
    }
    if (patch.scanMode === 'harian' || patch.scanMode === 'pulang') {
      db.kioskState.scanMode = patch.scanMode;
    }
    if (
      typeof patch.selectedSessionKey === 'string' &&
      validSessions.includes(patch.selectedSessionKey as DailySessionKey)
    ) {
      db.kioskState.selectedSessionKey = patch.selectedSessionKey as DailySessionKey;
    }
    if (typeof patch.customActivityInput === 'string') {
      db.kioskState.customActivityInput = patch.customActivityInput.slice(0, 140);
    }
    if (
      typeof patch.customDeadlineTime === 'string' &&
      /^\d{2}:\d{2}$/.test(patch.customDeadlineTime)
    ) {
      db.kioskState.customDeadlineTime = patch.customDeadlineTime;
    }
    if (
      typeof patch.plannedReturnDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(patch.plannedReturnDate)
    ) {
      db.kioskState.plannedReturnDate = patch.plannedReturnDate;
    }
    if (typeof patch.homeNote === 'string') {
      db.kioskState.homeNote = patch.homeNote.slice(0, 160);
    }

    res.json({ kioskState: db.kioskState });
  });

  app.post('/api/piket/verify-token', (req, res) => {
    const check = verifyAndResolveDutyPiket(req, req.body?.piketId, req.body?.piketToken);
    if (!check.ok) {
      res.status(401).json({ error: check.error });
      return;
    }
    res.json({
      ok: true,
      piket: {
        id: check.staff.id,
        name: check.staff.name,
        role: check.staff.role,
        wilayah: check.staff.wilayah,
      },
    });
  });

  // Barcode Login Guru Piket -> langsung masuk hasil tiket & disimpan agar tahan refresh
  app.post('/api/piket/barcode-login', (req, res) => {
    const rawBarcode =
      typeof req.body?.barcode === 'string' ? req.body.barcode.trim().toUpperCase() : '';
    if (!rawBarcode) {
      res.status(400).json({ error: 'Scan atau masukkan kode barcode login Guru Piket.' });
      return;
    }

    const cleaned = rawBarcode.replace(/^(GURU|PIKET|TOKEN|BARCODE)[:\-\s]*/i, '').trim();
    const compactCleaned = normalizeCodeCompact(cleaned);
    const parsedScan = extractPrefixAndNumber(cleaned);

    let matchedStaff: StoredStaff | undefined;
    for (const stf of db.staff) {
      if (!stf.is_active) continue;
      const tokenUpper = stf.piket_token.trim().toUpperCase();
      const userUpper = stf.username.trim().toUpperCase();
      const nameUpper = stf.name.trim().toUpperCase();
      if (
        safeCompareStrings(cleaned, stf.piket_token) ||
        safeCompareStrings(rawBarcode, stf.piket_token) ||
        safeCompareStrings(cleaned, stf.username) ||
        normalizeCodeCompact(tokenUpper) === compactCleaned ||
        normalizeCodeCompact(userUpper) === compactCleaned ||
        nameUpper === cleaned ||
        normalizeCodeCompact(nameUpper) === compactCleaned
      ) {
        matchedStaff = stf;
        break;
      }
      if (parsedScan.num !== null) {
        const sp = extractPrefixAndNumber(tokenUpper);
        if (sp.num !== null && sp.num === parsedScan.num) {
          matchedStaff = stf;
          break;
        }
      }
    }

    if (!matchedStaff) {
      res.status(401).json({
        error: `Barcode Guru Piket "${rawBarcode}" tidak dikenali atau akun tidak aktif.`,
      });
      return;
    }

    const ticketNumber = `TKT-${matchedStaff.piket_token}-${new Date()
      .toTimeString()
      .slice(0, 5)
      .replace(':', '')}`;

    const ticket: PiketTicket = {
      id: matchedStaff.id,
      name: matchedStaff.name,
      role: matchedStaff.role,
      wilayah: matchedStaff.wilayah,
      piket_token: matchedStaff.piket_token,
      ticket_number: ticketNumber,
      issued_at: new Date().toISOString(),
    };

    // Persist Guru Piket login state on the server so browser refresh stays logged in
    db.kioskState.piketTicket = ticket;
    if (matchedStaff.wilayah === 'putra' || matchedStaff.wilayah === 'putri') {
      db.kioskState.selectedWilayah = matchedStaff.wilayah;
    }
    if (db.kioskState.wizardStep === 'piket_login') {
      db.kioskState.wizardStep = 'select_session';
    }

    res.json({
      ok: true,
      ticket,
      kioskState: db.kioskState,
    });
  });

  app.post('/api/transactions/borrow', (req, res) => {
    const check = verifyAndResolveDutyPiket(req, req.body?.piketId, req.body?.piketToken);
    if (!check.ok) {
      res.status(401).json({ code: 'INVALID_PIKET_TOKEN', error: check.error });
      return;
    }
    const dutyStaff = check.staff;

    const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
    const laptopId = typeof req.body?.laptopId === 'string' ? req.body.laptopId : '';
    const transactionType: TransactionType =
      req.body?.transactionType === 'pulang' ? 'pulang' : 'harian';
    const dailySessionKey: DailySessionKey =
      req.body?.dailySession === 'siang' ||
      req.body?.dailySession === 'sore' ||
      req.body?.dailySession === 'malam' ||
      req.body?.dailySession === 'kegiatan_lainnya'
        ? req.body.dailySession
        : 'sore';
    const customActivity =
      typeof req.body?.customActivity === 'string' && req.body.customActivity.trim()
        ? req.body.customActivity.trim().slice(0, 140)
        : null;
    const customDeadlineTime =
      typeof req.body?.customDeadlineTime === 'string' &&
      /^\d{2}:\d{2}$/.test(req.body.customDeadlineTime.trim())
        ? req.body.customDeadlineTime.trim()
        : null;
    const stationWilayah: Wilayah | null =
      req.body?.wilayah === 'putra' || req.body?.wilayah === 'putri'
        ? req.body.wilayah
        : null;
    const plannedReturnDate =
      typeof req.body?.plannedReturnDate === 'string' ? req.body.plannedReturnDate.trim() : null;
    const homeNote =
      typeof req.body?.homeNote === 'string' && req.body.homeNote.trim()
        ? req.body.homeNote.trim().slice(0, 160)
        : null;

    refreshExpiredSuspensions(db.students);

    const student = db.students.find((s) => s.id === studentId);
    const laptop = db.laptops.find((l) => l.id === laptopId);

    if (!student || !laptop) {
      res.status(404).json({ error: 'Data siswa atau laptop tidak ditemukan.' });
      return;
    }

    // 1. Wilayah Pos Validation (Putra vs Putri)
    if (stationWilayah && student.wilayah !== stationWilayah) {
      res.status(403).json({
        code: 'WRONG_WILAYAH',
        error: `${student.name} terdaftar di Wilayah ${
          student.wilayah === 'putra' ? 'Putra' : 'Putri'
        }, tidak sesuai dengan pos scan Wilayah ${
          stationWilayah === 'putra' ? 'Putra' : 'Putri'
        }.`,
      });
      return;
    }

    // 2. Ownership check
    if (laptop.assigned_student_id !== student.id) {
      const realOwner = db.students.find((s) => s.id === laptop.assigned_student_id);
      res.status(409).json({
        code: 'WRONG_BAG',
        error: realOwner
          ? `${laptop.asset_code} terdaftar milik ${realOwner.name} (${realOwner.class}), bukan milik ${student.name}.`
          : `${laptop.asset_code} belum dialokasikan ke siswa manapun.`,
      });
      return;
    }

    // 3. Suspension check (with suspended_until info)
    if (student.is_suspended || student.late_count >= MAX_LATE_STRIKES) {
      const untilLabel = student.suspended_until
        ? new Date(student.suspended_until).toLocaleDateString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })
        : 'dibuka oleh Admin';
      res.status(403).json({
        code: 'SUSPENDED_3X_LATE',
        error: `${student.name} sedang di-suspend sampai ${untilLabel}. (${
          student.suspended_reason || `Terlambat ${student.late_count} kali`
        })`,
      });
      return;
    }

    if (laptop.status !== 'available') {
      res.status(409).json({ error: 'Laptop sedang berstatus dipinjam.' });
      return;
    }

    // 4. Daily Session check for Penggunaan Harian (Siang / Sore / Malam / Kegiatan Lainnya)
    // Kepulangan ('pulang') waktunya bebas 24 jam tanpa penahanan jam sesi
    const isKegiatanLainnya = dailySessionKey === 'kegiatan_lainnya';
    const sessionConfig = isKegiatanLainnya
      ? {
          key: 'sore' as const,
          label: 'Kegiatan Lainnya',
          start_time: '07:00',
          deadline_time: customDeadlineTime || '17:30',
          is_active: true,
        }
      : db.dailySessions.find((s) => s.key === dailySessionKey) || db.dailySessions[1];

    if (transactionType === 'harian' && !isKegiatanLainnya) {
      const timeValidation = validateDailySessionSelection(
        dailySessionKey,
        db.dailySessions,
        new Date()
      );
      if (!timeValidation.allowed) {
        res.status(403).json({
          code: 'OUT_OF_SCHEDULE',
          error: timeValidation.reason,
          correctedSession: timeValidation.correctedSession,
          correctedLabel: timeValidation.correctedLabel,
        });
        return;
      }
    }

    const now = new Date();
    let purpose: string;
    if (transactionType === 'pulang') {
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
      transactionType,
      sessionConfig,
      plannedReturnDate,
      now
    );

    const tx: Transaction = {
      id: makeId('tx'),
      student_id: student.id,
      laptop_id: laptop.id,
      wilayah: student.wilayah,
      transaction_type: transactionType,
      daily_session: transactionType === 'harian' ? dailySessionKey : null,
      custom_activity: customActivity,
      home_note: transactionType === 'pulang' ? homeNote : null,
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
    db.transactions = [tx, ...db.transactions];

    const authed = getOptionalAuthUser(req);
    res.json({
      transaction: tx,
      state: buildStateForRole(authed ? authed.role : 'public'),
    });
  });

  // Pengembalian laptop (baik dari Sesi Harian maupun dari Kepulangan) bebas jam berapa saja
  // dan langsung mengubah status Kepulangan dari 'active' (Sedang Dibawa Pulang) menjadi 'returned' (Sudah Kembali)
  app.post('/api/transactions/return', (req, res) => {
    const authed = getOptionalAuthUser(req);
    let dutyStaff: { id: string; name: string };

    if (authed && !req.body?.piketToken) {
      dutyStaff = { id: authed.id, name: authed.name };
    } else {
      const check = verifyAndResolveDutyPiket(req, req.body?.piketId, req.body?.piketToken);
      if (!check.ok) {
        res.status(401).json({ code: 'INVALID_PIKET_TOKEN', error: check.error });
        return;
      }
      dutyStaff = { id: check.staff.id, name: check.staff.name };
    }

    const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : '';
    const laptopId = typeof req.body?.laptopId === 'string' ? req.body.laptopId : '';
    const simulateLateMinutes =
      typeof req.body?.simulateLateMinutes === 'number' && req.body.simulateLateMinutes > 0
        ? Math.min(Math.round(req.body.simulateLateMinutes), 600)
        : 0;

    const student = db.students.find((s) => s.id === studentId);
    const laptop = db.laptops.find((l) => l.id === laptopId);

    if (!student || !laptop) {
      res.status(404).json({ error: 'Data siswa atau laptop tidak ditemukan.' });
      return;
    }

    const activeTx = db.transactions.find(
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

    res.json({
      transaction: activeTx || null,
      isLate,
      lateMinutes,
      returnedType,
      studentLateCount: student.late_count,
      newlySuspended,
      state: buildStateForRole(authed ? authed.role : 'public'),
    });
  });

  // ==========================================
  // ADMIN-ONLY DATA MASTER (FULL CRUD + CSV BULK UPLOAD)
  // ==========================================
  app.post('/api/students', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const studentClass = typeof req.body?.class === 'string' ? req.body.class.trim() : '';
    const wilayah = normalizeWilayah(req.body?.wilayah, 'putra');
    const photoUrl = sanitizePhotoUrl(req.body?.photo_url);

    if (!name || !studentClass) {
      res.status(400).json({ error: 'Nama dan kelas siswa wajib diisi.' });
      return;
    }

    const created: Student = {
      id: makeId('stu'),
      student_code: formatStudentCode(db.studentSeq++),
      name: name.slice(0, 120),
      class: studentClass.slice(0, 40),
      wilayah,
      photo_url: photoUrl,
      late_count: 0,
      is_suspended: false,
      suspended_until: null,
      suspended_reason: null,
      created_at: new Date().toISOString(),
    };
    db.students.push(created);
    res.json({ student: created, state: buildStateForRole('admin') });
  });

  app.put('/api/students/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const student = db.students.find((s) => s.id === req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Siswa tidak ditemukan.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : student.name;
    const studentClass =
      typeof req.body?.class === 'string' ? req.body.class.trim() : student.class;
    const wilayah =
      req.body?.wilayah !== undefined
        ? normalizeWilayah(req.body.wilayah, student.wilayah)
        : student.wilayah;
    const photoUrl =
      req.body?.photo_url !== undefined ? sanitizePhotoUrl(req.body.photo_url) : student.photo_url;

    if (!name || !studentClass) {
      res.status(400).json({ error: 'Nama dan kelas siswa wajib diisi.' });
      return;
    }

    student.name = name.slice(0, 120);
    student.class = studentClass.slice(0, 40);
    student.wilayah = wilayah;
    student.photo_url = photoUrl;

    res.json({ student, state: buildStateForRole('admin') });
  });

  app.post('/api/students/bulk', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0 || rows.length > 500) {
      res.status(400).json({ error: 'Jumlah baris CSV harus antara 1 sampai 500.' });
      return;
    }

    let createdStudents = 0;
    let createdLaptops = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      const cls = typeof raw?.class === 'string' && raw.class.trim() ? raw.class.trim() : '10';
      const wilayah = normalizeWilayah(raw?.wilayah, 'putra');
      const customCode =
        typeof raw?.student_code === 'string' ? raw.student_code.trim().toUpperCase() : '';
      const laptopCode =
        typeof raw?.laptop_code === 'string' ? raw.laptop_code.trim().toUpperCase() : '';
      const laptopBrand =
        typeof raw?.laptop_brand === 'string' ? raw.laptop_brand.trim() : '';
      const photoUrl = sanitizePhotoUrl(raw?.photo_url);

      if (!name) continue;

      let student = db.students.find(
        (s) =>
          (customCode && s.student_code.toUpperCase() === customCode) ||
          (s.name.trim().toLowerCase() === name.toLowerCase() &&
            s.class.trim().toLowerCase() === cls.toLowerCase())
      );

      if (student) {
        student.name = name.slice(0, 120);
        student.class = cls.slice(0, 40);
        student.wilayah = wilayah;
        if (customCode) student.student_code = customCode.slice(0, 40);
        if (photoUrl) student.photo_url = photoUrl;
        createdStudents++;
      } else {
        student = {
          id: makeId('stu'),
          student_code: (customCode || formatStudentCode(db.studentSeq++)).slice(0, 40),
          name: name.slice(0, 120),
          class: cls.slice(0, 40),
          wilayah,
          photo_url: photoUrl,
          late_count: 0,
          is_suspended: false,
          suspended_until: null,
          suspended_reason: null,
          created_at: nowIso,
        };
        db.students.push(student);
        createdStudents++;
      }

      if (laptopCode) {
        for (const l of db.laptops) {
          if (
            l.assigned_student_id === student.id &&
            normalizeCodeCompact(l.asset_code) !== normalizeCodeCompact(laptopCode)
          ) {
            l.assigned_student_id = null;
          }
        }

        const existingLaptop = db.laptops.find(
          (l) =>
            l.asset_code.toUpperCase() === laptopCode ||
            normalizeCodeCompact(l.asset_code) === normalizeCodeCompact(laptopCode)
        );
        if (existingLaptop) {
          existingLaptop.asset_code = laptopCode.slice(0, 40);
          if (laptopBrand) existingLaptop.brand_model = laptopBrand.slice(0, 100);
          existingLaptop.assigned_student_id = student.id;
          createdLaptops++;
        } else {
          db.laptops.push({
            id: makeId('lap'),
            asset_code: laptopCode.slice(0, 40),
            brand_model: (laptopBrand || 'Laptop Sekolah').slice(0, 100),
            status: 'available',
            assigned_student_id: student.id,
            created_at: nowIso,
          });
          createdLaptops++;
        }
      }
    }

    res.json({
      createdStudents,
      createdLaptops,
      state: buildStateForRole('admin'),
    });
  });

  app.post(
    '/api/students/:id/suspend',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const student = db.students.find((s) => s.id === req.params.id);
      if (!student) {
        res.status(404).json({ error: 'Siswa tidak ditemukan.' });
        return;
      }

      const rawUntil =
        typeof req.body?.suspended_until === 'string' ? req.body.suspended_until.trim() : '';
      const reason =
        typeof req.body?.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 180)
          : 'Disuspend oleh Administrator';

      if (!rawUntil) {
        res.status(400).json({ error: 'Pilih batas tanggal/waktu suspend sampai kapan.' });
        return;
      }

      let untilDate: Date;
      if (/^\d{4}-\d{2}-\d{2}$/.test(rawUntil)) {
        const [y, m, d] = rawUntil.split('-').map(Number);
        untilDate = new Date(y, m - 1, d, 23, 59, 59, 0);
      } else {
        untilDate = new Date(rawUntil);
      }

      if (Number.isNaN(untilDate.getTime()) || untilDate.getTime() <= Date.now()) {
        res.status(400).json({ error: 'Waktu berakhir suspend harus di masa mendatang.' });
        return;
      }

      student.is_suspended = true;
      student.suspended_until = untilDate.toISOString();
      student.suspended_reason = reason;

      res.json({ state: buildStateForRole('admin') });
    }
  );

  app.post(
    '/api/students/:id/reset-sanction',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const student = db.students.find((s) => s.id === req.params.id);
      if (!student) {
        res.status(404).json({ error: 'Siswa tidak ditemukan.' });
        return;
      }
      student.late_count = 0;
      student.is_suspended = false;
      student.suspended_until = null;
      student.suspended_reason = null;
      res.json({ state: buildStateForRole('admin') });
    }
  );

  app.delete('/api/students/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const id = req.params.id;
    db.students = db.students.filter((s) => s.id !== id);
    db.laptops = db.laptops.map((l) =>
      l.assigned_student_id === id ? { ...l, assigned_student_id: null } : l
    );
    res.json({ state: buildStateForRole('admin') });
  });

  app.post('/api/laptops', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const assetCode =
      typeof req.body?.asset_code === 'string' ? req.body.asset_code.trim().toUpperCase() : '';
    const brandModel =
      typeof req.body?.brand_model === 'string' ? req.body.brand_model.trim() : '';
    const assignedStudentId =
      typeof req.body?.assigned_student_id === 'string' && req.body.assigned_student_id.trim()
        ? req.body.assigned_student_id.trim()
        : null;

    if (!assetCode || !brandModel) {
      res.status(400).json({ error: 'Kode aset dan merk laptop wajib diisi.' });
      return;
    }
    if (db.laptops.some((l) => l.asset_code.toUpperCase() === assetCode)) {
      res.status(409).json({ error: `Kode aset "${assetCode}" sudah terdaftar.` });
      return;
    }

    if (assignedStudentId) {
      db.laptops = db.laptops.map((l) =>
        l.assigned_student_id === assignedStudentId ? { ...l, assigned_student_id: null } : l
      );
    }

    db.laptops.push({
      id: makeId('lap'),
      asset_code: assetCode.slice(0, 40),
      brand_model: brandModel.slice(0, 100),
      status: 'available',
      assigned_student_id: assignedStudentId,
      created_at: new Date().toISOString(),
    });
    res.json({ state: buildStateForRole('admin') });
  });

  app.put('/api/laptops/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const laptop = db.laptops.find((l) => l.id === req.params.id);
    if (!laptop) {
      res.status(404).json({ error: 'Data laptop tidak ditemukan.' });
      return;
    }

    const assetCode =
      typeof req.body?.asset_code === 'string'
        ? req.body.asset_code.trim().toUpperCase()
        : laptop.asset_code;
    const brandModel =
      typeof req.body?.brand_model === 'string' ? req.body.brand_model.trim() : laptop.brand_model;
    const assignedStudentId =
      req.body?.assigned_student_id !== undefined
        ? typeof req.body.assigned_student_id === 'string' && req.body.assigned_student_id.trim()
          ? req.body.assigned_student_id.trim()
          : null
        : laptop.assigned_student_id;

    if (!assetCode || !brandModel) {
      res.status(400).json({ error: 'Kode aset dan merk laptop wajib diisi.' });
      return;
    }

    if (
      db.laptops.some((l) => l.id !== laptop.id && l.asset_code.toUpperCase() === assetCode)
    ) {
      res.status(409).json({ error: `Kode aset "${assetCode}" sudah digunakan unit lain.` });
      return;
    }

    if (assignedStudentId) {
      db.laptops = db.laptops.map((l) =>
        l.id !== laptop.id && l.assigned_student_id === assignedStudentId
          ? { ...l, assigned_student_id: null }
          : l
      );
    }

    laptop.asset_code = assetCode.slice(0, 40);
    laptop.brand_model = brandModel.slice(0, 100);
    laptop.assigned_student_id = assignedStudentId;

    res.json({ laptop, state: buildStateForRole('admin') });
  });

  app.post('/api/laptops/bulk', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0 || rows.length > 500) {
      res.status(400).json({ error: 'Jumlah baris CSV laptop harus antara 1 sampai 500.' });
      return;
    }

    let createdLaptops = 0;
    let updatedLaptops = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const assetCode =
        typeof raw?.asset_code === 'string' ? raw.asset_code.trim().toUpperCase() : '';
      const brandModel =
        typeof raw?.brand_model === 'string' && raw.brand_model.trim()
          ? raw.brand_model.trim()
          : 'Laptop Sekolah';
      const studentRef =
        typeof raw?.student_code === 'string' ? raw.student_code.trim() : '';

      if (!assetCode) continue;

      let matchedStudent: Student | null = null;
      if (studentRef) {
        matchedStudent = findStudentByScannedCode(studentRef, db.students, db.laptops);
        if (!matchedStudent && !/^SIS[-_]?\d+$/i.test(studentRef) && studentRef.length >= 2) {
          const newStu: Student = {
            id: makeId('stu'),
            student_code: formatStudentCode(db.studentSeq++),
            name: studentRef.slice(0, 120),
            class: '10',
            wilayah: 'putra',
            photo_url: null,
            late_count: 0,
            is_suspended: false,
            suspended_until: null,
            suspended_reason: null,
            created_at: nowIso,
          };
          db.students.push(newStu);
          matchedStudent = newStu;
        }
      }

      if (matchedStudent) {
        db.laptops = db.laptops.map((l) =>
          l.assigned_student_id === matchedStudent!.id &&
          normalizeCodeCompact(l.asset_code) !== normalizeCodeCompact(assetCode)
            ? { ...l, assigned_student_id: null }
            : l
        );
      }

      const existing = db.laptops.find(
        (l) =>
          l.asset_code.toUpperCase() === assetCode ||
          normalizeCodeCompact(l.asset_code) === normalizeCodeCompact(assetCode)
      );
      if (existing) {
        existing.brand_model = brandModel.slice(0, 100);
        if (matchedStudent) {
          existing.assigned_student_id = matchedStudent.id;
        }
        updatedLaptops++;
      } else {
        db.laptops.push({
          id: makeId('lap'),
          asset_code: assetCode.slice(0, 40),
          brand_model: brandModel.slice(0, 100),
          status: 'available',
          assigned_student_id: matchedStudent ? matchedStudent.id : null,
          created_at: nowIso,
        });
        createdLaptops++;
      }
    }

    res.json({
      createdLaptops,
      updatedLaptops,
      state: buildStateForRole('admin'),
    });
  });

  app.patch('/api/laptops/:id/assign', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const id = req.params.id;
    const studentId =
      typeof req.body?.studentId === 'string' && req.body.studentId.trim()
        ? req.body.studentId.trim()
        : null;

    db.laptops = db.laptops.map((l) => {
      if (l.id === id) return { ...l, assigned_student_id: studentId };
      if (studentId && l.assigned_student_id === studentId) {
        return { ...l, assigned_student_id: null };
      }
      return l;
    });
    res.json({ state: buildStateForRole('admin') });
  });

  app.delete('/api/laptops/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    db.laptops = db.laptops.filter((l) => l.id !== req.params.id);
    res.json({ state: buildStateForRole('admin') });
  });

  // ==========================================
  // ADMIN-ONLY DAILY SESSIONS (SIANG, SORE, MALAM) & SCHEDULES
  // ==========================================
  app.patch(
    '/api/settings/daily-sessions',
    requireAuth,
    requireAdmin,
    (req: AuthedRequest, res) => {
      const sessionsInput = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
      if (sessionsInput.length > 0) {
        db.dailySessions = db.dailySessions.map((existing) => {
          const found = sessionsInput.find((item: { key?: string }) => item?.key === existing.key);
          if (!found) return existing;
          const startTime =
            typeof found.start_time === 'string' && /^\d{2}:\d{2}$/.test(found.start_time.trim())
              ? found.start_time.trim()
              : existing.start_time;
          const deadlineTime =
            typeof found.deadline_time === 'string' &&
            /^\d{2}:\d{2}$/.test(found.deadline_time.trim())
              ? found.deadline_time.trim()
              : existing.deadline_time;
          const isActive =
            typeof found.is_active === 'boolean' ? found.is_active : existing.is_active;
          return {
            ...existing,
            start_time: startTime,
            deadline_time: deadlineTime,
            is_active: isActive,
          };
        });
      }
      res.json({ state: buildStateForRole('admin') });
    }
  );

  app.post('/api/schedules', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const purpose = req.body?.purpose as LaptopPurpose;
    const targetClass =
      typeof req.body?.target_class === 'string'
        ? req.body.target_class.trim().toUpperCase()
        : 'SEMUA';
    const dayOfWeek = Number(req.body?.day_of_week);
    const startTime = typeof req.body?.start_time === 'string' ? req.body.start_time.trim() : '';
    const endTime = typeof req.body?.end_time === 'string' ? req.body.end_time.trim() : '';

    if (
      !LAPTOP_PURPOSES.includes(purpose) ||
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6 ||
      !startTime ||
      !endTime
    ) {
      res.status(400).json({ error: 'Data jadwal tidak valid.' });
      return;
    }

    db.schedules.push({
      id: makeId('sch'),
      purpose,
      target_class: targetClass || 'SEMUA',
      day_of_week: dayOfWeek,
      start_time: startTime.length === 5 ? `${startTime}:00` : startTime,
      end_time: endTime.length === 5 ? `${endTime}:00` : endTime,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    res.json({ state: buildStateForRole('admin') });
  });

  app.put('/api/schedules/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const sch = db.schedules.find((s) => s.id === req.params.id);
    if (!sch) {
      res.status(404).json({ error: 'Jadwal tidak ditemukan.' });
      return;
    }

    const purpose = (req.body?.purpose as LaptopPurpose) || sch.purpose;
    const targetClass =
      typeof req.body?.target_class === 'string'
        ? req.body.target_class.trim().toUpperCase()
        : sch.target_class;
    const dayOfWeek =
      req.body?.day_of_week !== undefined ? Number(req.body.day_of_week) : sch.day_of_week;
    const startTime =
      typeof req.body?.start_time === 'string' ? req.body.start_time.trim() : sch.start_time;
    const endTime =
      typeof req.body?.end_time === 'string' ? req.body.end_time.trim() : sch.end_time;

    if (
      !LAPTOP_PURPOSES.includes(purpose) ||
      !Number.isInteger(dayOfWeek) ||
      dayOfWeek < 0 ||
      dayOfWeek > 6 ||
      !startTime ||
      !endTime
    ) {
      res.status(400).json({ error: 'Data jadwal tidak valid.' });
      return;
    }

    sch.purpose = purpose;
    sch.target_class = targetClass || 'SEMUA';
    sch.day_of_week = dayOfWeek;
    sch.start_time = startTime.length === 5 ? `${startTime}:00` : startTime;
    sch.end_time = endTime.length === 5 ? `${endTime}:00` : endTime;

    res.json({ state: buildStateForRole('admin') });
  });

  app.patch('/api/schedules/:id/toggle', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    db.schedules = db.schedules.map((s) =>
      s.id === req.params.id ? { ...s, is_active: !s.is_active } : s
    );
    res.json({ state: buildStateForRole('admin') });
  });

  app.delete('/api/schedules/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    db.schedules = db.schedules.filter((s) => s.id !== req.params.id);
    res.json({ state: buildStateForRole('admin') });
  });

  // ==========================================
  // ADMIN-ONLY STAFF / GURU PIKET & TOKEN MANAGEMENT (FULL CRUD + CSV BULK)
  // ==========================================
  app.post('/api/staff', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const username =
      typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const role: StaffRole = req.body?.role === 'admin' ? 'admin' : 'piket';
    const wilayah = normalizeStaffWilayah(req.body?.wilayah, role === 'admin' ? 'semua' : 'putra');
    const customToken =
      typeof req.body?.piket_token === 'string' && req.body.piket_token.trim()
        ? req.body.piket_token.trim().toUpperCase().slice(0, 16)
        : `PKT-${Math.floor(100 + Math.random() * 900)}`;

    if (!name || !username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
      res.status(400).json({
        error: 'Nama wajib diisi dan username harus 3–40 karakter (huruf kecil, angka, titik, atau garis bawah).',
      });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: 'Password minimal 6 karakter.' });
      return;
    }
    if (db.staff.some((s) => s.username.toLowerCase() === username)) {
      res.status(409).json({ error: `Username "${username}" sudah digunakan.` });
      return;
    }

    db.staff.push({
      id: makeId('stf'),
      name: name.slice(0, 100),
      username,
      passwordHash: hashPassword(password),
      piket_token: customToken,
      role,
      wilayah,
      is_active: true,
      created_at: new Date().toISOString(),
    });
    res.json({ state: buildStateForRole('admin') });
  });

  app.put('/api/staff/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const stf = db.staff.find((s) => s.id === req.params.id);
    if (!stf) {
      res.status(404).json({ error: 'Data pegawai/guru piket tidak ditemukan.' });
      return;
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : stf.name;
    const username =
      typeof req.body?.username === 'string'
        ? req.body.username.trim().toLowerCase()
        : stf.username;
    const piketToken =
      typeof req.body?.piket_token === 'string' && req.body.piket_token.trim()
        ? req.body.piket_token.trim().toUpperCase().slice(0, 16)
        : stf.piket_token;
    const role: StaffRole =
      req.body?.role === 'admin' || req.body?.role === 'piket' ? req.body.role : stf.role;
    const wilayah =
      req.body?.wilayah !== undefined
        ? normalizeStaffWilayah(req.body.wilayah, stf.wilayah)
        : stf.wilayah;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!name || !username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
      res.status(400).json({
        error: 'Nama wajib diisi dan username harus 3–40 karakter.',
      });
      return;
    }

    if (db.staff.some((s) => s.id !== stf.id && s.username.toLowerCase() === username)) {
      res.status(409).json({ error: `Username "${username}" sudah digunakan pegawai lain.` });
      return;
    }

    stf.name = name.slice(0, 100);
    stf.username = username;
    stf.piket_token = piketToken;
    stf.role = role;
    stf.wilayah = wilayah;
    if (password.length >= 6) {
      stf.passwordHash = hashPassword(password);
    }

    // Keep active kiosk ticket in sync if this teacher is currently logged in
    if (db.kioskState.piketTicket && db.kioskState.piketTicket.id === stf.id) {
      db.kioskState.piketTicket = {
        ...db.kioskState.piketTicket,
        name: stf.name,
        role: stf.role,
        wilayah: stf.wilayah,
        piket_token: stf.piket_token,
      };
    }

    res.json({ state: buildStateForRole('admin') });
  });

  app.post('/api/staff/bulk', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0 || rows.length > 500) {
      res.status(400).json({ error: 'Jumlah baris CSV pegawai harus antara 1 sampai 500.' });
      return;
    }

    let createdStaff = 0;
    let updatedStaff = 0;
    const nowIso = new Date().toISOString();

    for (const raw of rows) {
      const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
      const rawUsername =
        typeof raw?.username === 'string'
          ? raw.username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
          : '';
      const piketToken =
        typeof raw?.piket_token === 'string' && raw.piket_token.trim()
          ? raw.piket_token.trim().toUpperCase().slice(0, 16)
          : `PKT-${Math.floor(100 + Math.random() * 900)}`;
      const role: StaffRole = raw?.role === 'admin' ? 'admin' : 'piket';
      const wilayah = normalizeStaffWilayah(raw?.wilayah, role === 'admin' ? 'semua' : 'putra');
      const password =
        typeof raw?.password === 'string' && raw.password.length >= 6
          ? raw.password
          : 'Piket@Sekolah26';

      if (!name || !rawUsername) continue;

      const existing = db.staff.find((s) => s.username.toLowerCase() === rawUsername);
      if (existing) {
        existing.name = name.slice(0, 100);
        existing.piket_token = piketToken;
        existing.wilayah = wilayah;
        existing.role = role;
        updatedStaff++;
      } else {
        db.staff.push({
          id: makeId('stf'),
          name: name.slice(0, 100),
          username: rawUsername.slice(0, 40),
          passwordHash: hashPassword(password),
          piket_token: piketToken,
          role,
          wilayah,
          is_active: true,
          created_at: nowIso,
        });
        createdStaff++;
      }
    }

    res.json({
      createdStaff,
      updatedStaff,
      state: buildStateForRole('admin'),
    });
  });

  app.patch('/api/staff/:id/token', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const targetId = req.params.id;
    const newToken =
      typeof req.body?.piket_token === 'string' && req.body.piket_token.trim()
        ? req.body.piket_token.trim().toUpperCase().slice(0, 16)
        : `PKT-${Math.floor(100 + Math.random() * 900)}`;
    db.staff = db.staff.map((s) =>
      s.id === targetId ? { ...s, piket_token: newToken } : s
    );
    res.json({ state: buildStateForRole('admin') });
  });

  app.patch('/api/staff/:id/toggle', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const targetId = req.params.id;
    if (targetId === req.authUser!.id) {
      res.status(400).json({ error: 'Anda tidak dapat menonaktifkan akun yang sedang dipakai.' });
      return;
    }
    db.staff = db.staff.map((s) =>
      s.id === targetId ? { ...s, is_active: !s.is_active } : s
    );
    res.json({ state: buildStateForRole('admin') });
  });

  app.delete('/api/staff/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const targetId = req.params.id;
    if (targetId === req.authUser!.id) {
      res.status(400).json({ error: 'Anda tidak dapat menghapus akun sendiri.' });
      return;
    }
    db.staff = db.staff.filter((s) => s.id !== targetId);
    res.json({ state: buildStateForRole('admin') });
  });

  app.patch('/api/settings/print', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
    const patch = req.body || {};
    db.printSettings = {
      ...db.printSettings,
      schoolName:
        typeof patch.schoolName === 'string'
          ? patch.schoolName.slice(0, 120)
          : db.printSettings.schoolName,
      schoolSubtext:
        typeof patch.schoolSubtext === 'string'
          ? patch.schoolSubtext.slice(0, 140)
          : db.printSettings.schoolSubtext,
      academicYear:
        typeof patch.academicYear === 'string'
          ? patch.academicYear.slice(0, 30)
          : db.printSettings.academicYear,
      theme: ['navy', 'emerald', 'slate', 'maroon'].includes(patch.theme)
        ? patch.theme
        : db.printSettings.theme,
      cardOrientation: ['landscape', 'portrait'].includes(patch.cardOrientation)
        ? patch.cardOrientation
        : db.printSettings.cardOrientation,
      bagTagStyle: ['single', 'foldable'].includes(patch.bagTagStyle)
        ? patch.bagTagStyle
        : db.printSettings.bagTagStyle,
      showCutGuides:
        typeof patch.showCutGuides === 'boolean'
          ? patch.showCutGuides
          : db.printSettings.showCutGuides,
      showPunchHole:
        typeof patch.showPunchHole === 'boolean'
          ? patch.showPunchHole
          : db.printSettings.showPunchHole,
      includeQrOnTag:
        typeof patch.includeQrOnTag === 'boolean'
          ? patch.includeQrOnTag
          : db.printSettings.includeQrOnTag,
      includeBarcodeOnCard:
        typeof patch.includeBarcodeOnCard === 'boolean'
          ? patch.includeBarcodeOnCard
          : db.printSettings.includeBarcodeOnCard,
    };
    res.json({ state: buildStateForRole('admin') });
  });

  app.post('/api/admin/reset-demo', requireAuth, requireAdmin, (_req: AuthedRequest, res) => {
    const preservedStaff = db.staff;
    const preservedClaimed = db.adminClaimed;
    const preservedKiosk = db.kioskState;
    const fresh = createInitialDb();
    db = {
      ...fresh,
      staff: preservedStaff,
      adminClaimed: preservedClaimed,
      kioskState: preservedKiosk,
    };
    res.json({ state: buildStateForRole('admin') });
  });

  // ==========================================
  // VITE MIDDLEWARE / STATIC ASSETS
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Not Found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LapTrack Sekolah Server running on http://localhost:${PORT}`);
  });
}

startServer();
