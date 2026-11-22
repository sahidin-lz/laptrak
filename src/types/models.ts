export const LAPTOP_PURPOSES = [
  'Sesi Siang',
  'Sesi Sore',
  'Sesi Malam',
  'Kegiatan Lainnya',
  'Bimbel Kelas 10',
  'Bimbel Kelas 11',
  'Bimbel Kelas 12',
  'SUGT',
] as const;

export type LaptopPurpose = (typeof LAPTOP_PURPOSES)[number];

export const DAYS_ID = [
  'Minggu',
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
] as const;

export type Wilayah = 'putra' | 'putri';
export type StaffWilayah = Wilayah | 'semua';
export type TransactionType = 'harian' | 'pulang';
export type DailySessionKey = 'siang' | 'sore' | 'malam' | 'kegiatan_lainnya';

export interface DailySessionConfig {
  key: 'siang' | 'sore' | 'malam';
  label: string;
  start_time: string;    // "HH:MM"
  deadline_time: string; // "HH:MM" — Batas jam yang membuat siswa teridentifikasi telat
  is_active: boolean;
}

export const WILAYAH_LABELS: Record<StaffWilayah, string> = {
  putra: 'Wilayah Putra',
  putri: 'Wilayah Putri',
  semua: 'Semua Wilayah (Putra & Putri)',
};

export type StaffRole = 'admin' | 'piket';

export interface StaffMember {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  wilayah: StaffWilayah;
  piket_token: string;
  is_active: boolean;
  created_at: string;
}

export interface PiketOption {
  id: string;
  name: string;
  role: StaffRole;
  wilayah: StaffWilayah;
  demo_token?: string;
}

export interface PiketTicket {
  id: string;
  name: string;
  role: StaffRole;
  wilayah: StaffWilayah;
  piket_token: string;
  ticket_number: string;
  issued_at: string;
}

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  role: StaffRole;
  wilayah: StaffWilayah;
}

export interface Student {
  id: string;
  student_code: string;
  name: string;
  class: string;
  wilayah: Wilayah;
  photo_url: string | null;
  late_count: number;
  is_suspended: boolean;
  suspended_until: string | null;
  suspended_reason: string | null;
  created_at: string;
}

export interface Laptop {
  id: string;
  asset_code: string;
  brand_model: string;
  status: 'available' | 'borrowed';
  assigned_student_id: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  purpose: LaptopPurpose;
  target_class: string;
  day_of_week: number;
  start_time: string; // "HH:MM:SS"
  end_time: string;   // "HH:MM:SS"
  is_active: boolean;
  created_at: string;
}

export interface Transaction {
  id: string;
  student_id: string;
  laptop_id: string;
  wilayah: Wilayah;
  transaction_type: TransactionType;
  daily_session: DailySessionKey | null;
  custom_activity?: string | null;
  home_note: string | null;
  piket_id: string;
  piket_name: string;
  return_piket_id: string | null;
  return_piket_name: string | null;
  purpose: string;
  borrow_time: string;
  due_time: string;
  return_time: string | null;
  is_late: boolean;
  late_minutes: number;
  status: 'active' | 'returned';
}

export type CardThemeKey = 'navy' | 'emerald' | 'slate' | 'maroon';

export interface CardTheme {
  key: CardThemeKey;
  label: string;
  primaryHex: string;
  primaryRgb: [number, number, number];
  accentHex: string;
  accentRgb: [number, number, number];
  tintHex: string;
  tintRgb: [number, number, number];
}

export const CARD_THEMES: Record<CardThemeKey, CardTheme> = {
  navy: {
    key: 'navy',
    label: 'Biru Instansi',
    primaryHex: '#1E3A8A',
    primaryRgb: [30, 58, 138],
    accentHex: '#2563EB',
    accentRgb: [37, 99, 235],
    tintHex: '#EFF6FF',
    tintRgb: [239, 246, 255],
  },
  emerald: {
    key: 'emerald',
    label: 'Hijau Akademik',
    primaryHex: '#065F46',
    primaryRgb: [6, 95, 70],
    accentHex: '#059669',
    accentRgb: [5, 150, 105],
    tintHex: '#ECFDF5',
    tintRgb: [236, 253, 245],
  },
  slate: {
    key: 'slate',
    label: 'Grafit Modern',
    primaryHex: '#0F172A',
    primaryRgb: [15, 23, 42],
    accentHex: '#334155',
    accentRgb: [51, 65, 85],
    tintHex: '#F1F5F9',
    tintRgb: [241, 245, 249],
  },
  maroon: {
    key: 'maroon',
    label: 'Merah Marun',
    primaryHex: '#7F1D1D',
    primaryRgb: [127, 29, 29],
    accentHex: '#B91C1C',
    accentRgb: [185, 28, 28],
    tintHex: '#FEF2F2',
    tintRgb: [254, 242, 242],
  },
};

export type StudentCardOrientation = 'landscape' | 'portrait';
export type BagTagStyle = 'single' | 'foldable';

export interface PrintSettings {
  schoolName: string;
  schoolSubtext: string;
  academicYear: string;
  theme: CardThemeKey;
  cardOrientation: StudentCardOrientation;
  bagTagStyle: BagTagStyle;
  showCutGuides: boolean;
  showPunchHole: boolean;
  includeQrOnTag: boolean;
  includeBarcodeOnCard: boolean;
}

export type ActivePage = 'scan' | 'database' | 'manajemen' | 'print';
export type KioskWizardStep = 'piket_login' | 'select_session' | 'scan_student' | 'validation_panel';

export interface KioskPersistedState {
  activePage: ActivePage;
  wizardStep: KioskWizardStep;
  piketTicket: PiketTicket | null;
  selectedWilayah: Wilayah;
  scanMode: TransactionType;
  selectedSessionKey: DailySessionKey;
  customActivityInput: string;
  customDeadlineTime: string;
  plannedReturnDate: string;
  homeNote: string;
}

export interface AppStatePayload {
  students: Student[];
  laptops: Laptop[];
  schedules: Schedule[];
  dailySessions: DailySessionConfig[];
  transactions: Transaction[];
  staff: StaffMember[];
  piketOptions: PiketOption[];
  printSettings: PrintSettings;
  kioskState: KioskPersistedState;
}

export const MAX_LATE_STRIKES = 3;
