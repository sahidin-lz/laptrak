import {
  DailySessionConfig,
  DailySessionKey,
  DAYS_ID,
  LaptopPurpose,
  MAX_LATE_STRIKES,
  Schedule,
  StaffRole,
  StaffWilayah,
  Student,
  Wilayah,
} from '../types/models';

export function findMatchingSchedule(
  schedules: Schedule[],
  studentClass: string,
  referenceDate = new Date()
): Schedule | null {
  const currentDay = referenceDate.getDay();
  const currentTime = referenceDate.toTimeString().slice(0, 8);
  const normClass = studentClass.trim().toUpperCase();

  return (
    schedules.find((sch) => {
      if (!sch.is_active || sch.day_of_week !== currentDay) return false;
      if (currentTime < sch.start_time || currentTime > sch.end_time) return false;

      const target = sch.target_class.trim().toUpperCase();
      if (target === 'SEMUA' || target === 'ALL') return true;
      return normClass.startsWith(target) || normClass.includes(target);
    }) || null
  );
}

/**
 * Checks if a student is currently suspended, taking `suspended_until` into account.
 */
export function isStudentCurrentlySuspended(student: Student): boolean {
  if (!student.is_suspended && student.late_count < MAX_LATE_STRIKES) {
    return false;
  }
  if (student.suspended_until) {
    const untilMs = new Date(student.suspended_until).getTime();
    if (!Number.isNaN(untilMs) && untilMs <= Date.now()) {
      return false;
    }
  }
  return student.is_suspended || student.late_count >= MAX_LATE_STRIKES;
}

export function timeStringToMinutes(hhmm: string): number {
  const parts = hhmm.trim().split(':').map((n) => Number(n) || 0);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function getCurrentSuggestedSessionKey(
  dailySessions?: DailySessionConfig[],
  now = new Date()
): 'siang' | 'sore' | 'malam' {
  const nowMins = now.getHours() * 60 + now.getMinutes();

  if (dailySessions && dailySessions.length > 0) {
    // 1. Exact match inside [start_time, deadline_time]
    for (const s of dailySessions) {
      if (!s.is_active) continue;
      const startM = timeStringToMinutes(s.start_time);
      const endM = timeStringToMinutes(s.deadline_time);
      if (nowMins >= startM && nowMins <= endM) {
        return s.key;
      }
    }
    // 2. Fallback based on configured session boundaries
    const soreSession = dailySessions.find((s) => s.key === 'sore');
    const malamSession = dailySessions.find((s) => s.key === 'malam');
    const soreStart = soreSession ? timeStringToMinutes(soreSession.start_time) : 15 * 60;
    const malamStart = malamSession ? timeStringToMinutes(malamSession.start_time) : 18 * 60 + 30;

    if (nowMins < soreStart) return 'siang';
    if (nowMins < malamStart) return 'sore';
    return 'malam';
  }

  const h = now.getHours();
  if (h < 15) return 'siang';
  if (h < 18) return 'sore';
  return 'malam';
}

export function getTimeOfDayLabel(now = new Date()): string {
  const h = now.getHours();
  if (h < 11) return 'Pagi';
  if (h < 15) return 'Siang';
  if (h < 18) return 'Sore';
  return 'Malam';
}

/**
 * Validates whether a Guru Piket's chosen daily session ('siang' | 'sore' | 'malam')
 * matches the current clock time. If the teacher selects e.g. "Sesi Sore" while the clock
 * shows morning/afternoon, it blocks and returns the corrected session.
 */
export function validateDailySessionSelection(
  chosenKey: DailySessionKey,
  dailySessions: DailySessionConfig[],
  now = new Date()
): {
  allowed: boolean;
  currentTimeStr: string;
  timeOfDayLabel: string;
  chosenSession: DailySessionConfig | null;
  correctedSession: 'siang' | 'sore' | 'malam';
  correctedLabel: string;
  reason: string;
  message?: string;
} {
  const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes()
  ).padStart(2, '0')}`;
  const timeOfDayLabel = getTimeOfDayLabel(now);
  const suggestedKey = getCurrentSuggestedSessionKey(dailySessions, now);
  const correctedSessionObj =
    dailySessions.find((s) => s.key === suggestedKey) ||
    dailySessions[0] || {
      key: 'siang' as const,
      label: 'Sesi Siang',
      start_time: '07:30',
      deadline_time: '14:30',
      is_active: true,
    };

  if (chosenKey === 'kegiatan_lainnya') {
    return {
      allowed: true,
      currentTimeStr,
      timeOfDayLabel,
      chosenSession: null,
      correctedSession: correctedSessionObj.key,
      correctedLabel: correctedSessionObj.label,
      reason: '',
    };
  }

  const chosenSession = dailySessions.find((s) => s.key === chosenKey) || null;
  if (!chosenSession) {
    const msg = `Sesi tidak ditemukan. Sistem mengoreksi ke ${correctedSessionObj.label}.`;
    return {
      allowed: false,
      currentTimeStr,
      timeOfDayLabel,
      chosenSession: null,
      correctedSession: correctedSessionObj.key,
      correctedLabel: correctedSessionObj.label,
      reason: msg,
      message: msg,
    };
  }

  if (!chosenSession.is_active) {
    const msg = `${chosenSession.label} sedang dinonaktifkan oleh Admin. Sistem mengoreksi ke ${correctedSessionObj.label}.`;
    return {
      allowed: false,
      currentTimeStr,
      timeOfDayLabel,
      chosenSession,
      correctedSession: correctedSessionObj.key,
      correctedLabel: correctedSessionObj.label,
      reason: msg,
      message: msg,
    };
  }

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = timeStringToMinutes(chosenSession.start_time);
  const endMins = timeStringToMinutes(chosenSession.deadline_time);
  const isInsideWindow = nowMins >= startMins && nowMins <= endMins;

  // Allow if inside configured [start_time, deadline_time] OR if chosenKey matches the current time-of-day bucket
  if (isInsideWindow || chosenKey === suggestedKey) {
    return {
      allowed: true,
      currentTimeStr,
      timeOfDayLabel,
      chosenSession,
      correctedSession: correctedSessionObj.key,
      correctedLabel: correctedSessionObj.label,
      reason: '',
    };
  }

  const msg = `Saat ini pukul ${currentTimeStr} (Waktu ${timeOfDayLabel}), sedangkan ${chosenSession.label} dijadwalkan pukul ${chosenSession.start_time}–${chosenSession.deadline_time}. Sistem menahan pilihan dan mengoreksi otomatis ke ${correctedSessionObj.label} (${correctedSessionObj.start_time}–${correctedSessionObj.deadline_time}).`;
  return {
    allowed: false,
    currentTimeStr,
    timeOfDayLabel,
    chosenSession,
    correctedSession: correctedSessionObj.key,
    correctedLabel: correctedSessionObj.label,
    reason: msg,
    message: msg,
  };
}

export interface ParsedStudentLaptopRow {
  name: string;
  class: string;
  wilayah: Wilayah;
  laptop_code?: string;
  laptop_brand?: string;
  photo_url?: string | null;
}

export interface ParsedLaptopOnlyRow {
  asset_code: string;
  brand_model: string;
  student_code?: string;
}

export type ParsedLaptopCsvRow = ParsedLaptopOnlyRow;

export interface ParsedStaffRow {
  name: string;
  username: string;
  piket_token: string;
  wilayah: StaffWilayah;
  role: StaffRole;
  password?: string;
}

export type ParsedStaffCsvRow = ParsedStaffRow;

function splitCsvLine(line: string): string[] {
  const delimiter = line.includes('\t')
    ? '\t'
    : line.includes(';') && !line.includes(',')
    ? ';'
    : ',';
  return line.split(delimiter).map((v) => v?.replace(/^"|"$/g, '').trim() || '');
}

function parseWilayahCol(raw: string | undefined): Wilayah {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'putri' || v === 'pr' || v === 'perempuan' || v === 'p') return 'putri';
  return 'putra';
}

function parseStaffWilayahCol(raw: string | undefined): StaffWilayah {
  const v = (raw || '').trim().toLowerCase();
  if (v === 'putri' || v === 'pr' || v === 'perempuan') return 'putri';
  if (v === 'semua' || v === 'all') return 'semua';
  return 'putra';
}

/**
 * Parse Student + Laptop CSV/Excel template:
 * Kolom: nama,kelas,wilayah,kode_laptop,merk_laptop,photo_url
 */
export function parseStudentCsv(text: string): ParsedStudentLaptopRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const headerLine = lines[0].toLowerCase();
  const hasWilayah = headerLine.includes('wilayah');
  const hasLaptop = headerLine.includes('kode_laptop');

  return lines
    .slice(1)
    .map((line) => {
      const cols = splitCsvLine(line);

      if (hasWilayah && hasLaptop) {
        const [nama, kelas, wilayah, kodeLaptop, merkLaptop, foto] = cols;
        return {
          name: nama,
          class: kelas,
          wilayah: parseWilayahCol(wilayah),
          laptop_code: kodeLaptop ? kodeLaptop.toUpperCase() : undefined,
          laptop_brand: merkLaptop || undefined,
          photo_url: foto || null,
        };
      }

      if (hasLaptop) {
        const [nama, kelas, kodeLaptop, merkLaptop, foto] = cols;
        return {
          name: nama,
          class: kelas,
          wilayah: 'putra' as Wilayah,
          laptop_code: kodeLaptop ? kodeLaptop.toUpperCase() : undefined,
          laptop_brand: merkLaptop || undefined,
          photo_url: foto || null,
        };
      }

      const [nama, kelas, wilayahOrFoto] = cols;
      return {
        name: nama,
        class: kelas,
        wilayah: hasWilayah ? parseWilayahCol(wilayahOrFoto) : ('putra' as Wilayah),
        photo_url: hasWilayah ? null : wilayahOrFoto || null,
      };
    })
    .filter((row) => Boolean(row.name) && Boolean(row.class));
}

/**
 * Parse Laptop-only CSV/Excel template:
 * Kolom: kode_laptop,merk_laptop,kode_siswa
 */
export function parseLaptopCsv(text: string): ParsedLaptopOnlyRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  return lines
    .slice(1)
    .map((line) => {
      const [kodeLaptop, merkLaptop, kodeSiswa] = splitCsvLine(line);
      return {
        asset_code: (kodeLaptop || '').toUpperCase(),
        brand_model: merkLaptop || 'Laptop Sekolah',
        student_code: kodeSiswa ? kodeSiswa.toUpperCase() : undefined,
      };
    })
    .filter((row) => Boolean(row.asset_code));
}

/**
 * Parse Staff / Guru Piket CSV/Excel template:
 * Kolom: nama,username,token_barcode,wilayah,role,password
 */
export function parseStaffCsv(text: string): ParsedStaffRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  return lines
    .slice(1)
    .map((line) => {
      const [nama, username, tokenBarcode, wilayah, role, password] = splitCsvLine(line);
      const normRole: StaffRole =
        (role || '').trim().toLowerCase() === 'admin' ? 'admin' : 'piket';
      const cleanUser =
        (username || '').trim().toLowerCase() ||
        (nama || '')
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '.')
          .replace(/^\.|\.$/g, '');

      return {
        name: nama,
        username: cleanUser,
        piket_token: tokenBarcode
          ? tokenBarcode.toUpperCase()
          : `PKT-${Math.floor(100 + Math.random() * 900)}`,
        wilayah: parseStaffWilayahCol(wilayah),
        role: normRole,
        password: password || undefined,
      };
    })
    .filter((row) => Boolean(row.name) && Boolean(row.username));
}

export function formatDateTimeID(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = DAYS_ID[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day}, ${dd}/${mm} · ${hh}:${min}`;
}

export function formatTimeOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateOnly(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—';
  const totalMins = Math.max(1, Math.round((end - start) / 60000));
  const days = Math.floor(totalMins / (60 * 24));
  const hours = Math.floor((totalMins % (60 * 24)) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}h ${hours}j`;
  if (hours === 0) return `${mins} mnt`;
  return `${hours}j ${mins}m`;
}

export function getSuggestedTargetClass(purpose: LaptopPurpose): string {
  if (purpose === 'Bimbel Kelas 10') return '10';
  if (purpose === 'Bimbel Kelas 11') return '11';
  if (purpose === 'Bimbel Kelas 12') return '12';
  return 'SEMUA';
}

export function getDefaultReturnDateInput(daysAhead = 3): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
