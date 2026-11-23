import * as XLSX from 'xlsx';
import {
  DailySessionConfig,
  DailySessionKey,
  DAYS_ID,
  Laptop,
  LaptopPurpose,
  MAX_LATE_STRIKES,
  Schedule,
  StaffRole,
  StaffWilayah,
  Student,
  Transaction,
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

export const BIMBEL_DAY_OPTIONS = [
  'Senin',
  'Selasa',
  'Rabu',
  'Kamis',
  'Jumat',
  'Sabtu',
  'Minggu',
] as const;

export function parseBimbelDays(raw: unknown): string[] {
  if (!raw) return [];
  const rawList: string[] = Array.isArray(raw)
    ? raw.map((x) => String(x || ''))
    : String(raw)
        .split(/[,;/|+&]+|\s+dan\s+|\s+/i)
        .map((s) => s.trim())
        .filter(Boolean);

  const normalized: string[] = [];
  for (const item of rawList) {
    const lower = item.trim().toLowerCase();
    if (!lower || lower === 'semua' || lower === 'bebas' || lower === 'all' || lower === '-') {
      if (lower === 'semua' || lower === 'bebas' || lower === 'all') {
        return [];
      }
      continue;
    }
    let matched: string | null = null;
    if (lower.startsWith('sen')) matched = 'Senin';
    else if (lower.startsWith('sel')) matched = 'Selasa';
    else if (lower.startsWith('rab')) matched = 'Rabu';
    else if (lower.startsWith('kam')) matched = 'Kamis';
    else if (lower.startsWith('jum')) matched = 'Jumat';
    else if (lower.startsWith('sab')) matched = 'Sabtu';
    else if (lower.startsWith('min') || lower.startsWith('ahad')) matched = 'Minggu';

    if (matched && !normalized.includes(matched)) {
      normalized.push(matched);
    }
  }
  return normalized;
}

export function formatBimbelDays(days?: string[] | null): string {
  if (!days || days.length === 0) return 'Semua Hari (Bebas)';
  return days.join(', ');
}

/**
 * Validates whether today's day matches the student's configured `bimbel_days` schedule.
 * If `student.bimbel_days` is empty or undefined, all days are allowed.
 */
export function validateStudentBimbelSchedule(
  student: Student,
  now = new Date()
): {
  hasSchedule: boolean;
  todayName: string;
  allowedToday: boolean;
  scheduleLabel: string;
  reason: string;
} {
  const todayName = DAYS_ID[now.getDay()];
  const configuredDays = parseBimbelDays(student.bimbel_days);
  if (configuredDays.length === 0) {
    return {
      hasSchedule: false,
      todayName,
      allowedToday: true,
      scheduleLabel: 'Semua Hari (Bebas)',
      reason: '',
    };
  }

  const allowedToday = configuredDays.some(
    (d) => d.toLowerCase() === todayName.toLowerCase()
  );
  const scheduleLabel = configuredDays.join(', ');
  const reason = allowedToday
    ? ''
    : `Jadwal Bimbel / Penggunaan ${student.name} terdaftar pada hari [${scheduleLabel}], sedangkan hari ini adalah hari ${todayName}. Sistem mendeteksi ketidaksesuaian jadwal penggunaan hari ini.`;

  return {
    hasSchedule: true,
    todayName,
    allowedToday,
    scheduleLabel,
    reason,
  };
}

export interface ParsedStudentLaptopRow {
  student_code?: string;
  name: string;
  class: string;
  wilayah: Wilayah;
  laptop_code?: string;
  laptop_brand?: string;
  bimbel_days?: string[];
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
 * Header-aware & fallback parser for Student + Laptop CSV/Excel template.
 * Supports optional `no`, `kode_siswa`, `jadwal_bimbel`, and any column ordering:
 * e.g. nama | kelas | wilayah | kode_laptop | merk_laptop | jadwal_bimbel | photo_url
 */
export function parseStudentCsv(text: string): ParsedStudentLaptopRow[] {
  const lines = normalizeCsvLines(text);
  if (lines.length === 0) return [];

  const firstRowCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
  const isHeaderRow = firstRowCols.some(
    (c) =>
      /^(no|nomor|nama|name|siswa|murid|kelas|class|wilayah|kode_siswa|student_code|nis|kode_laptop|asset_code|merk_laptop|jadwal_bimbel|hari_bimbel|bimbel)$/.test(
        c.replace(/\s+/g, '_')
      ) ||
      c.includes('nama') ||
      c.includes('kelas') ||
      c.includes('laptop') ||
      c.includes('bimbel')
  );

  const dataLines = isHeaderRow ? lines.slice(1) : lines;

  // Map column indices dynamically from header if present
  const findColIdx = (patterns: RegExp[]): number => {
    if (!isHeaderRow) return -1;
    for (const pat of patterns) {
      const idx = firstRowCols.findIndex((h) => pat.test(h.replace(/\s+/g, '_')));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxStudentCode = findColIdx([
    /^(kode_siswa|student_code|kode_kartu|barcode_siswa|barcode_kartu|nis|nisn|id_siswa)$/,
  ]);
  const idxName = findColIdx([/^(nama|nama_siswa|nama_lengkap|name|siswa|murid)$/, /nama/]);
  const idxClass = findColIdx([/^(kelas|class|rombel|tingkat)$/, /kelas/]);
  const idxWilayah = findColIdx([/^(wilayah|asrama|gender|jk|jenis_kelamin|putra_putri)$/, /wilayah/]);
  const idxLaptopCode = findColIdx([
    /^(kode_laptop|asset_code|barcode_tas|kode_tas|barcode_laptop|kode_barcode|nomor_laptop)$/,
    /kode.*laptop|barcode.*tas/,
  ]);
  const idxLaptopBrand = findColIdx([
    /^(merk_laptop|merk|brand|brand_model|tipe_laptop|model_laptop)$/,
    /merk|brand/,
  ]);
  const idxBimbel = findColIdx([
    /^(jadwal_bimbel|hari_bimbel|jadwal_hari|bimbel|hari_penggunaan|jadwal)$/,
    /bimbel|jadwal/,
  ]);
  const idxPhoto = findColIdx([/^(photo_url|foto|photo|url_foto)$/]);

  return dataLines
    .map((line) => {
      let cols = splitCsvLine(line);
      // If there's no header row and column 0 is just a row number (1, 2, 3), shift it off
      if (!isHeaderRow && cols.length >= 4 && /^\d{1,3}$/.test(cols[0])) {
        cols = cols.slice(1);
      }

      if (isHeaderRow && idxName !== -1) {
        const nama = (cols[idxName] || '').trim();
        const kelas = idxClass !== -1 ? (cols[idxClass] || '').trim() : '10';
        const wilayahRaw = idxWilayah !== -1 ? cols[idxWilayah] : 'putra';
        const studentCodeRaw = idxStudentCode !== -1 ? (cols[idxStudentCode] || '').trim() : '';
        const kodeLaptopRaw = idxLaptopCode !== -1 ? (cols[idxLaptopCode] || '').trim() : '';
        const merkLaptopRaw = idxLaptopBrand !== -1 ? (cols[idxLaptopBrand] || '').trim() : '';
        const bimbelRaw = idxBimbel !== -1 ? (cols[idxBimbel] || '').trim() : '';
        const fotoRaw = idxPhoto !== -1 ? (cols[idxPhoto] || '').trim() : '';

        return {
          student_code: studentCodeRaw ? studentCodeRaw.toUpperCase() : undefined,
          name: nama,
          class: kelas || '10',
          wilayah: parseWilayahCol(wilayahRaw),
          laptop_code: kodeLaptopRaw ? kodeLaptopRaw.toUpperCase() : undefined,
          laptop_brand: merkLaptopRaw || undefined,
          bimbel_days: parseBimbelDays(bimbelRaw),
          photo_url: fotoRaw || null,
        };
      }

      // Positional fallback
      const [c0, c1, c2, c3, c4, c5, c6] = cols;
      // Check if c0 looks like a student code (SIS-XXXX)
      if (/^SIS[-_]?\d+/i.test(c0 || '') && c1) {
        const parsedDays = parseBimbelDays(c6);
        return {
          student_code: c0.toUpperCase(),
          name: c1,
          class: c2 || '10',
          wilayah: parseWilayahCol(c3),
          laptop_code: c4 ? c4.toUpperCase() : undefined,
          laptop_brand: c5 || undefined,
          bimbel_days: parsedDays.length > 0 ? parsedDays : undefined,
          photo_url: null,
        };
      }

      const c5Days = parseBimbelDays(c5);
      const isC5Bimbel = c5Days.length > 0 && !/^https?:|^data:/i.test(c5 || '');

      return {
        name: c0 || '',
        class: c1 || '10',
        wilayah: parseWilayahCol(c2),
        laptop_code: c3 ? c3.toUpperCase() : undefined,
        laptop_brand: c4 || undefined,
        bimbel_days: isC5Bimbel ? c5Days : undefined,
        photo_url: isC5Bimbel ? c6 || null : c5 || null,
      };
    })
    .filter((row) => Boolean(row.name));
}

/**
 * Header-aware & fallback parser for Laptop-only CSV/Excel template:
 * Kolom: kode_laptop | merk_laptop | kode_siswa
 */
export function parseLaptopCsv(text: string): ParsedLaptopOnlyRow[] {
  const lines = normalizeCsvLines(text);
  if (lines.length === 0) return [];

  const firstRowCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
  const isHeaderRow = firstRowCols.some(
    (c) =>
      c.includes('kode') ||
      c.includes('laptop') ||
      c.includes('merk') ||
      c.includes('brand') ||
      c.includes('siswa') ||
      c.includes('nama')
  );

  const dataLines = isHeaderRow ? lines.slice(1) : lines;

  const findColIdx = (patterns: RegExp[]): number => {
    if (!isHeaderRow) return -1;
    for (const pat of patterns) {
      const idx = firstRowCols.findIndex((h) => pat.test(h.replace(/\s+/g, '_')));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxLaptopCode = findColIdx([
    /^(kode_laptop|asset_code|barcode_tas|kode_tas|kode_barcode|barcode)$/,
    /kode.*laptop|barcode/,
  ]);
  const idxBrand = findColIdx([
    /^(merk_laptop|merk|brand|brand_model|tipe_laptop|model)$/,
    /merk|brand/,
  ]);
  const idxStudentRef = findColIdx([
    /^(kode_siswa|student_code|nama_siswa|nama|pemilik|siswa)$/,
    /siswa|nama|pemilik/,
  ]);

  return dataLines
    .map((line) => {
      let cols = splitCsvLine(line);
      if (!isHeaderRow && cols.length >= 3 && /^\d{1,3}$/.test(cols[0]) && /^LAP/i.test(cols[1])) {
        cols = cols.slice(1);
      }

      if (isHeaderRow && idxLaptopCode !== -1) {
        const kodeLaptop = (cols[idxLaptopCode] || '').trim();
        const merkLaptop = idxBrand !== -1 ? (cols[idxBrand] || '').trim() : 'Laptop Sekolah';
        const kodeSiswa = idxStudentRef !== -1 ? (cols[idxStudentRef] || '').trim() : '';
        return {
          asset_code: kodeLaptop.toUpperCase(),
          brand_model: merkLaptop || 'Laptop Sekolah',
          student_code: kodeSiswa || undefined,
        };
      }

      const [kodeLaptop, merkLaptop, kodeSiswa] = cols;
      return {
        asset_code: (kodeLaptop || '').toUpperCase(),
        brand_model: merkLaptop || 'Laptop Sekolah',
        student_code: kodeSiswa ? kodeSiswa.trim() : undefined,
      };
    })
    .filter((row) => Boolean(row.asset_code));
}

/**
 * Header-aware & fallback parser for Staff / Guru Piket CSV/Excel template:
 * Kolom: nama | username | token_barcode | wilayah | role | password
 */
export function parseStaffCsv(text: string): ParsedStaffRow[] {
  const lines = normalizeCsvLines(text);
  if (lines.length === 0) return [];

  const firstRowCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
  const isHeaderRow = firstRowCols.some(
    (c) =>
      c.includes('nama') ||
      c.includes('username') ||
      c.includes('token') ||
      c.includes('barcode') ||
      c.includes('wilayah') ||
      c.includes('role')
  );

  const dataLines = isHeaderRow ? lines.slice(1) : lines;

  const findColIdx = (patterns: RegExp[]): number => {
    if (!isHeaderRow) return -1;
    for (const pat of patterns) {
      const idx = firstRowCols.findIndex((h) => pat.test(h.replace(/\s+/g, '_')));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxName = findColIdx([/^(nama|nama_pegawai|nama_guru|name|guru|pegawai)$/, /nama/]);
  const idxUsername = findColIdx([/^(username|user|akun|id_login)$/]);
  const idxToken = findColIdx([
    /^(token_barcode|piket_token|token|kode_barcode|barcode|kode_token)$/,
    /token|barcode|kode/,
  ]);
  const idxWilayah = findColIdx([/^(wilayah|pos|asrama)$/]);
  const idxRole = findColIdx([/^(role|jabatan|peran)$/]);
  const idxPassword = findColIdx([/^(password|pass|sandi|kata_sandi)$/]);

  return dataLines
    .map((line) => {
      let cols = splitCsvLine(line);
      if (!isHeaderRow && cols.length >= 3 && /^\d{1,3}$/.test(cols[0])) {
        cols = cols.slice(1);
      }

      let nama = '';
      let username = '';
      let tokenBarcode = '';
      let wilayah = '';
      let role = '';
      let password = '';

      if (isHeaderRow && idxName !== -1) {
        nama = (cols[idxName] || '').trim();
        username = idxUsername !== -1 ? (cols[idxUsername] || '').trim() : '';
        tokenBarcode = idxToken !== -1 ? (cols[idxToken] || '').trim() : '';
        wilayah = idxWilayah !== -1 ? (cols[idxWilayah] || '').trim() : 'putra';
        role = idxRole !== -1 ? (cols[idxRole] || '').trim() : 'piket';
        password = idxPassword !== -1 ? (cols[idxPassword] || '').trim() : '';
      } else {
        [nama, username, tokenBarcode, wilayah, role, password] = cols;
        // If only 2 columns were provided (nama, token_barcode)
        if (cols.length === 2 && nama && username && !tokenBarcode) {
          tokenBarcode = username;
          username = '';
        }
      }

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

/**
 * Normalizes a barcode/QR code string by stripping spaces, hyphens, underscores,
 * and common punctuation so codes like "SIS-0007", "SIS0007", "LAP-007", "LAP007",
 * "PKT-205", "PKT205" can be matched reliably.
 */
export function normalizeCodeCompact(raw: string): string {
  return (raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.:/\\]+/g, '');
}

export function extractPrefixAndNumber(raw: string): { prefix: string; num: number | null } {
  const clean = (raw || '').trim().toUpperCase();
  const m = clean.match(/^([A-Z]+)?[\s\-_.:]*0*(\d+)$/);
  if (!m) return { prefix: clean, num: null };
  return {
    prefix: (m[1] || '').trim(),
    num: Number.parseInt(m[2], 10),
  };
}

/**
 * Generates the next guaranteed-unique Student Code (`SIS-XXXX`) that does not collide
 * with any existing student_code in `students`.
 */
export function generateNextUniqueStudentCode(
  students: Student[],
  startSeq = 1
): { code: string; nextSeq: number } {
  const usedExact = new Set<string>();
  const usedCompact = new Set<string>();
  const usedSisNumbers = new Set<number>();
  let maxNumber = 0;

  for (const s of students) {
    const raw = (s.student_code || '').trim().toUpperCase();
    if (!raw) continue;
    usedExact.add(raw);
    usedCompact.add(normalizeCodeCompact(raw));
    const parsed = extractPrefixAndNumber(raw);
    if (
      parsed.num !== null &&
      (parsed.prefix === 'SIS' || parsed.prefix === 'SISWA' || parsed.prefix === '')
    ) {
      usedSisNumbers.add(parsed.num);
      if (parsed.num > maxNumber) maxNumber = parsed.num;
    }
  }

  let candidateSeq = Math.max(1, startSeq, maxNumber + 1);
  // First try startSeq if it isn't taken, otherwise advance until free
  let probe = Math.max(1, startSeq);
  while (
    usedSisNumbers.has(probe) ||
    usedExact.has(`SIS-${String(probe).padStart(4, '0')}`) ||
    usedCompact.has(`SIS${String(probe).padStart(4, '0')}`)
  ) {
    probe++;
  }
  candidateSeq = probe;
  const code = `SIS-${String(candidateSeq).padStart(4, '0')}`;
  return { code, nextSeq: Math.max(candidateSeq + 1, maxNumber + 1) };
}

/**
 * Generates a guaranteed-unique Laptop Asset Code (`LAP-XXX`) that does not collide
 * with any existing asset_code in `laptops`.
 */
export function generateNextUniqueLaptopCode(
  laptops: Laptop[],
  preferredNum?: number | null
): string {
  const usedExact = new Set<string>();
  const usedCompact = new Set<string>();
  const usedLapNumbers = new Set<number>();

  for (const l of laptops) {
    const raw = (l.asset_code || '').trim().toUpperCase();
    if (!raw) continue;
    usedExact.add(raw);
    usedCompact.add(normalizeCodeCompact(raw));
    const parsed = extractPrefixAndNumber(raw);
    if (
      parsed.num !== null &&
      (parsed.prefix === 'LAP' || parsed.prefix === 'TAS' || parsed.prefix === '')
    ) {
      usedLapNumbers.add(parsed.num);
    }
  }

  if (preferredNum && preferredNum > 0) {
    const desired = `LAP-${String(preferredNum).padStart(3, '0')}`;
    if (
      !usedExact.has(desired) &&
      !usedCompact.has(normalizeCodeCompact(desired)) &&
      !usedLapNumbers.has(preferredNum)
    ) {
      return desired;
    }
  }

  let probe = preferredNum && preferredNum > 0 ? preferredNum : 1;
  while (
    usedLapNumbers.has(probe) ||
    usedExact.has(`LAP-${String(probe).padStart(3, '0')}`) ||
    usedCompact.has(`LAP${String(probe).padStart(3, '0')}`)
  ) {
    probe++;
  }
  return `LAP-${String(probe).padStart(3, '0')}`;
}

/**
 * Deterministic 1-to-1 lookup for a student's assigned laptop across all views
 * (Print PDF, CardPreview, CodePreviewModal, MasterView, and ScanView).
 */
export function getAssignedLaptopForStudent(
  studentId: string | null | undefined,
  laptops: Laptop[]
): Laptop | undefined {
  if (!studentId) return undefined;
  return laptops.find((l) => l.assigned_student_id === studentId);
}

/**
 * Sanitizes and self-heals the database records so that:
 * 1. Every student has a trimmed, uppercase, 100% unique `student_code`.
 * 2. Every laptop has a trimmed, uppercase, 100% unique `asset_code`.
 * 3. Strict 1-to-1 Student <-> Laptop ownership: at most ONE laptop can have `assigned_student_id === student.id`.
 *    If multiple laptops point to the same student (e.g. an auto-generated placeholder `Laptop Sekolah` and an imported real laptop),
 *    the explicit/preferred laptop is kept and redundant auto-generated placeholder duplicates are removed or detached.
 * 4. Dangling `assigned_student_id` references (pointing to non-existent students) are cleared to `null`.
 */
export function sanitizeDatabaseRecords(data: {
  students: Student[];
  laptops: Laptop[];
  transactions?: Transaction[];
}): {
  students: Student[];
  laptops: Laptop[];
  nextStudentSeq: number;
} {
  const activeLaptopIds = new Set(
    (data.transactions || [])
      .filter((t) => t.status === 'active')
      .map((t) => t.laptop_id)
  );

  // 1. Normalize & ensure unique student_code for every student
  const seenStudentIds = new Set<string>();
  const usedStudentCompactCodes = new Set<string>();
  const cleanStudents: Student[] = [];

  for (const rawStu of data.students) {
    if (!rawStu || !rawStu.id || seenStudentIds.has(rawStu.id)) continue;
    seenStudentIds.add(rawStu.id);

    let code = (rawStu.student_code || '').trim().toUpperCase();
    const compact = normalizeCodeCompact(code);
    if (!code || usedStudentCompactCodes.has(compact)) {
      const gen = generateNextUniqueStudentCode(cleanStudents, cleanStudents.length + 1);
      code = gen.code;
    }
    usedStudentCompactCodes.add(normalizeCodeCompact(code));

    cleanStudents.push({
      ...rawStu,
      student_code: code,
      name: (rawStu.name || '').trim(),
      class: (rawStu.class || '10').trim(),
    });
  }

  const validStudentMap = new Map(cleanStudents.map((s) => [s.id, s]));

  // 2. Deduplicate laptops by ID & normalize asset_code
  const seenLaptopIds = new Set<string>();
  const rawLaptops: Laptop[] = [];
  for (const rawLap of data.laptops) {
    if (!rawLap || !rawLap.id || seenLaptopIds.has(rawLap.id)) continue;
    seenLaptopIds.add(rawLap.id);
    const cleanAssigned =
      rawLap.assigned_student_id && validStudentMap.has(rawLap.assigned_student_id)
        ? rawLap.assigned_student_id
        : null;
    rawLaptops.push({
      ...rawLap,
      asset_code: (rawLap.asset_code || '').trim().toUpperCase(),
      brand_model: (rawLap.brand_model || 'Laptop Sekolah').trim(),
      assigned_student_id: cleanAssigned,
    });
  }

  // 3. Enforce strict 1-to-1 Student <-> Laptop assignment
  // If multiple laptops claim the same `assigned_student_id`, pick the single authoritative laptop for that student.
  const laptopsByStudent = new Map<string, Laptop[]>();
  for (const lap of rawLaptops) {
    if (!lap.assigned_student_id) continue;
    const list = laptopsByStudent.get(lap.assigned_student_id) || [];
    list.push(lap);
    laptopsByStudent.set(lap.assigned_student_id, list);
  }

  const winnerLaptopIdByStudent = new Map<string, string>();
  const redundantAutoLaptopIdsToRemove = new Set<string>();

  for (const [stuId, candidates] of laptopsByStudent.entries()) {
    if (candidates.length === 1) {
      winnerLaptopIdByStudent.set(stuId, candidates[0].id);
      continue;
    }
    const stu = validStudentMap.get(stuId);
    const stuNum = stu ? extractPrefixAndNumber(stu.student_code).num : null;

    // Score each candidate laptop so the real/imported/active one wins deterministically
    let bestLap = candidates[0];
    let bestScore = -1;
    for (let idx = 0; idx < candidates.length; idx++) {
      const c = candidates[idx];
      let score = idx; // Tie-breaker: later record (e.g. newly imported CSV row) wins over older placeholder
      if (activeLaptopIds.has(c.id) || c.status === 'borrowed') score += 1000;
      if (c.brand_model && c.brand_model.toLowerCase() !== 'laptop sekolah') score += 200;
      const lapNum = extractPrefixAndNumber(c.asset_code).num;
      if (stuNum !== null && lapNum !== null && stuNum === lapNum) score += 100;
      if (score >= bestScore) {
        bestScore = score;
        bestLap = c;
      }
    }

    winnerLaptopIdByStudent.set(stuId, bestLap.id);

    for (const c of candidates) {
      if (c.id !== bestLap.id) {
        // If this loser laptop was just an auto-generated "Laptop Sekolah" with no active transaction, remove it cleanly
        if (
          c.brand_model.toLowerCase() === 'laptop sekolah' &&
          !activeLaptopIds.has(c.id) &&
          c.status === 'available'
        ) {
          redundantAutoLaptopIdsToRemove.add(c.id);
        }
      }
    }
  }

  // 4. Rebuild laptops list with unique asset_codes and strict 1-to-1 assigned_student_id
  const usedLaptopCompactCodes = new Set<string>();
  const cleanLaptops: Laptop[] = [];

  for (const lap of rawLaptops) {
    if (redundantAutoLaptopIdsToRemove.has(lap.id)) continue;

    let assignedStudentId = lap.assigned_student_id;
    if (assignedStudentId && winnerLaptopIdByStudent.get(assignedStudentId) !== lap.id) {
      assignedStudentId = null;
    }

    let assetCode = lap.asset_code;
    const compact = normalizeCodeCompact(assetCode);
    if (!assetCode || usedLaptopCompactCodes.has(compact)) {
      const parsed = extractPrefixAndNumber(assetCode);
      assetCode = generateNextUniqueLaptopCode(cleanLaptops, parsed.num);
    }
    usedLaptopCompactCodes.add(normalizeCodeCompact(assetCode));

    cleanLaptops.push({
      ...lap,
      asset_code: assetCode,
      assigned_student_id: assignedStudentId,
    });
  }

  const nextSeqInfo = generateNextUniqueStudentCode(cleanStudents, cleanStudents.length + 1);

  return {
    students: cleanStudents,
    laptops: cleanLaptops,
    nextStudentSeq: nextSeqInfo.nextSeq - 1,
  };
}

/**
 * Splits a multi-field QR text (e.g., "SIS-0007 | Rina Putri | 12 IPS 1") into clean uppercase tokens
 * so we never use unsafe raw substring `.includes()` where "SIS-0001" could falsely match "SIS-00010".
 */
function splitQrPayloadTokens(upperText: string): string[] {
  return upperText
    .split(/[\s|,;/()[\]"']+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Strictly checks if a scanned code matches a Student Card (`SIS-XXXX` or `student.student_code` or student name)
 * WITHOUT matching a Laptop Bag Tag (`LAP-XXX`) and WITHOUT false substring matches.
 * Used in Phase 1 (Scan Kartu Siswa) of the sequential scanner.
 */
export function findStudentCardStrict(
  rawCode: string,
  students: Student[]
): Student | null {
  const clean = (rawCode || '').trim();
  if (!clean) return null;
  const upper = clean.toUpperCase();
  const compact = normalizeCodeCompact(upper);
  const parsedScan = extractPrefixAndNumber(upper);

  // 1. Exact student_code match (highest priority)
  const exactStudent = students.find((s) => s.student_code.trim().toUpperCase() === upper);
  if (exactStudent) return exactStudent;

  // 2. Compact student_code match (e.g. "SIS0007" == "SIS-0007", but "SIS0001" !== "SIS00010")
  const compactStudent = students.find(
    (s) => normalizeCodeCompact(s.student_code) === compact
  );
  if (compactStudent) return compactStudent;

  // Reject explicit Laptop Bag Tag prefixes in strict Student Card mode
  if (parsedScan.prefix === 'LAP' || parsedScan.prefix === 'TAS') {
    return null;
  }

  // 3. Prefix + exact integer number match for SIS-XXXX (e.g. "SIS-7", "SIS0007", "0007", "7")
  // Only match if the student's code also has a standard student prefix (SIS / SISWA / empty)
  // AND there is a unique match for that number.
  if (
    parsedScan.num !== null &&
    (parsedScan.prefix === 'SIS' || parsedScan.prefix === '' || parsedScan.prefix === 'SISWA')
  ) {
    const numMatches = students.filter((s) => {
      const sp = extractPrefixAndNumber(s.student_code);
      const isCompatiblePrefix =
        sp.prefix === 'SIS' || sp.prefix === 'SISWA' || sp.prefix === '' || sp.prefix === parsedScan.prefix;
      return isCompatiblePrefix && sp.num !== null && sp.num === parsedScan.num;
    });
    if (numMatches.length === 1) {
      return numMatches[0];
    }
  }

  // 4. Exact student Name match (only if unique)
  const nameMatches = students.filter(
    (s) =>
      s.name.trim().toUpperCase() === upper ||
      normalizeCodeCompact(s.name) === compact
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }

  // 5. Token-boundary match inside multi-field Student Card QR text (e.g., "SIS-0007 | Rina Putri")
  // Never uses raw `.includes()` on codes so "SIS-0001" will NEVER falsely match "SIS-00010".
  const tokens = splitQrPayloadTokens(upper);
  if (tokens.length > 1) {
    const tokenSet = new Set(tokens);
    const compactTokenSet = new Set(tokens.map((t) => normalizeCodeCompact(t)));
    const tokenMatchedStudent = students.find((s) => {
      const stuCodeUpper = s.student_code.trim().toUpperCase();
      const stuCodeCompact = normalizeCodeCompact(stuCodeUpper);
      return (
        tokenSet.has(stuCodeUpper) ||
        (stuCodeCompact.length >= 3 && compactTokenSet.has(stuCodeCompact))
      );
    });
    if (tokenMatchedStudent) return tokenMatchedStudent;
  }

  return null;
}

/**
 * Strictly checks if a scanned code matches a Laptop Bag Tag (`LAP-XXX` or `laptop.asset_code`)
 * WITHOUT accepting a Student Card (`SIS-XXXX`) and WITHOUT false substring matches.
 * Used in Phase 2 (Scan Gantungan Tas) of the sequential scanner.
 */
export function findLaptopBagStrict(
  rawCode: string,
  laptops: Laptop[],
  currentScannedStudent?: Student | null
): Laptop | null {
  const clean = (rawCode || '').trim();
  if (!clean) return null;
  const upper = clean.toUpperCase();
  const compact = normalizeCodeCompact(upper);
  const parsedScan = extractPrefixAndNumber(upper);

  // 1. Exact asset_code match (highest priority)
  const exactLaptop = laptops.find((l) => l.asset_code.trim().toUpperCase() === upper);
  if (exactLaptop) return exactLaptop;

  // 2. Compact asset_code match (e.g. "LAP007" == "LAP-007", but "LAP001" !== "LAP0010")
  const compactLaptop = laptops.find((l) => normalizeCodeCompact(l.asset_code) === compact);
  if (compactLaptop) return compactLaptop;

  // Reject explicit Student Card prefixes in strict Bag Tag mode
  if (parsedScan.prefix === 'SIS' || parsedScan.prefix === 'SISWA') {
    return null;
  }

  // 3. Prefix + exact integer number match for LAP-XXX / TAS-XXX
  if (
    parsedScan.num !== null &&
    (parsedScan.prefix === 'LAP' || parsedScan.prefix === 'TAS' || parsedScan.prefix === '')
  ) {
    const numCandidates = laptops.filter((l) => {
      const lp = extractPrefixAndNumber(l.asset_code);
      const isCompatiblePrefix =
        lp.prefix === 'LAP' ||
        lp.prefix === 'TAS' ||
        lp.prefix === '' ||
        lp.prefix === parsedScan.prefix;
      return isCompatiblePrefix && lp.num !== null && lp.num === parsedScan.num;
    });

    if (numCandidates.length === 1) {
      return numCandidates[0];
    }
    if (numCandidates.length > 1 && currentScannedStudent) {
      const ownedCandidate = numCandidates.find(
        (l) => l.assigned_student_id === currentScannedStudent.id
      );
      if (ownedCandidate) return ownedCandidate;
    }
  }

  // 4. Token-boundary match inside multi-field Bag Tag QR text (e.g., "LAP-007 | Lenovo")
  // Never uses raw `.includes()` so "LAP-001" will NEVER falsely match "LAP-0010" or "LAP-0012".
  const tokens = splitQrPayloadTokens(upper);
  if (tokens.length > 1) {
    const tokenSet = new Set(tokens);
    const compactTokenSet = new Set(tokens.map((t) => normalizeCodeCompact(t)));
    const tokenMatchedLaptop = laptops.find((l) => {
      const lapCodeUpper = l.asset_code.trim().toUpperCase();
      const lapCodeCompact = normalizeCodeCompact(lapCodeUpper);
      return (
        tokenSet.has(lapCodeUpper) ||
        (lapCodeCompact.length >= 3 && compactTokenSet.has(lapCodeCompact))
      );
    });
    if (tokenMatchedLaptop) return tokenMatchedLaptop;
  }

  return null;
}

/**
 * General student lookup (used for CSV imports and admin search).
 */
export function findStudentByScannedCode(
  rawCode: string,
  students: Student[],
  laptops: Laptop[]
): Student | null {
  const strictStudent = findStudentCardStrict(rawCode, students);
  if (strictStudent) return strictStudent;

  const matchedLaptop = findLaptopBagStrict(rawCode, laptops);
  if (matchedLaptop?.assigned_student_id) {
    return students.find((s) => s.id === matchedLaptop.assigned_student_id) || null;
  }

  return null;
}

/**
 * Strict Laptop Bag Tag lookup for Phase 2 (Scan Gantungan Tas).
 */
export function findLaptopByScannedCode(
  rawCode: string,
  laptops: Laptop[],
  _students?: Student[],
  currentScannedStudent?: Student | null
): Laptop | null {
  return findLaptopBagStrict(rawCode, laptops, currentScannedStudent);
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
