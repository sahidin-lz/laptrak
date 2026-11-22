import * as XLSX from 'xlsx';
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

/**
 * Download a native multi-column Excel (.xlsx) file so each field is in its own
 * separate column (Kolom A, Kolom B, Kolom C, ...) when opened in Microsoft Excel,
 * WPS Office, LibreOffice, or Google Sheets.
 */
export function downloadMultiColumnExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: string[][],
  colWidths?: number[]
): void {
  const aoa: string[][] = [headers, ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  worksheet['!cols'] = headers.map((h, idx) => {
    if (colWidths && colWidths[idx]) {
      return { wch: colWidths[idx] };
    }
    const maxCellLen = rows.reduce((max, r) => Math.max(max, (r[idx] || '').length), h.length);
    return { wch: Math.max(18, maxCellLen + 5) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));

  const cleanFilename = filename.endsWith('.xlsx')
    ? filename
    : `${filename.replace(/\.(csv|xls)$/i, '')}.xlsx`;
  XLSX.writeFile(workbook, cleanFilename);
}

/**
 * Download an Excel-friendly CSV file with UTF-8 BOM and `sep=;` declaration
 * so Microsoft Excel in Indonesian/European regional settings opens each column separately.
 */
export function downloadMultiColumnCsv(
  filename: string,
  headers: string[],
  rows: string[][]
): void {
  const escapeCell = (val: string) => {
    const cleaned = String(val ?? '').replace(/"/g, '""');
    return /[;"\r\n]/.test(cleaned) ? `"${cleaned}"` : cleaned;
  };
  const lines = [
    'sep=;',
    headers.map(escapeCell).join(';'),
    ...rows.map((r) => r.map(escapeCell).join(';')),
  ];
  const csvContent = `\uFEFF${lines.join('\r\n')}\r\n`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Read either an Excel (.xlsx / .xls) file or a CSV (.csv) file and convert it
 * into normalized text lines where columns are separated by tabs ('\t').
 */
export async function readSpreadsheetFileToText(file: File): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return '';
    const sheet = workbook.Sheets[firstSheetName];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    });
    return aoa
      .map((row: unknown[]) =>
        (Array.isArray(row) ? row : [])
          .map((cell: unknown) =>
            String(cell ?? '')
              .replace(/[\r\n\t]+/g, ' ')
              .trim()
          )
          .join('\t')
      )
      .filter((line: string) => line.replace(/\t/g, '').trim().length > 0)
      .join('\n');
  }

  return await file.text();
}

function splitCsvLine(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((v) => v?.replace(/^"|"$/g, '').trim() || '');
  }

  // Count semicolons vs commas outside quotes
  let semiCount = 0;
  let commaCount = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === ';') semiCount++;
      else if (ch === ',') commaCount++;
    }
  }
  const delimiter = semiCount >= commaCount && semiCount > 0 ? ';' : ',';

  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result.map((v) => v.replace(/^"|"$/g, '').trim());
}

function normalizeCsvLines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !/^sep=.$/i.test(line));
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
 * Kolom: nama | kelas | wilayah | kode_laptop | merk_laptop | photo_url
 */
export function parseStudentCsv(text: string): ParsedStudentLaptopRow[] {
  const lines = normalizeCsvLines(text);
  if (lines.length <= 1) return [];

  const headerLine = lines[0].toLowerCase();
  const hasWilayah = headerLine.includes('wilayah');
  const hasLaptop = headerLine.includes('kode_laptop') || headerLine.includes('kode laptop');

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
 * Kolom: kode_laptop | merk_laptop | kode_siswa
 */
export function parseLaptopCsv(text: string): ParsedLaptopOnlyRow[] {
  const lines = normalizeCsvLines(text);
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
 * Kolom: nama | username | token_barcode | wilayah | role | password
 */
export function parseStaffCsv(text: string): ParsedStaffRow[] {
  const lines = normalizeCsvLines(text);
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
