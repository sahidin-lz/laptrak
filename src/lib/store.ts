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
  student_code?: string;
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
 * Header-aware & fallback parser for Student + Laptop CSV/Excel template.
 * Supports optional `no`, `kode_siswa`, and any column ordering:
 * e.g. nama | kelas | wilayah | kode_laptop | merk_laptop | photo_url
 * or kode_siswa | nama | kelas | wilayah | kode_laptop | merk_laptop
 */
export function parseStudentCsv(text: string): ParsedStudentLaptopRow[] {
  const lines = normalizeCsvLines(text);
  if (lines.length === 0) return [];

  const firstRowCols = splitCsvLine(lines[0]).map((c) => c.toLowerCase().trim());
  const isHeaderRow = firstRowCols.some((c) =>
    /^(no|nomor|nama|name|siswa|murid|kelas|class|wilayah|kode_siswa|student_code|nis|kode_laptop|asset_code|merk_laptop)$/.test(
      c.replace(/\s+/g, '_')
    ) ||
    c.includes('nama') ||
    c.includes('kelas') ||
    c.includes('laptop')
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
        const fotoRaw = idxPhoto !== -1 ? (cols[idxPhoto] || '').trim() : '';

        return {
          student_code: studentCodeRaw ? studentCodeRaw.toUpperCase() : undefined,
          name: nama,
          class: kelas || '10',
          wilayah: parseWilayahCol(wilayahRaw),
          laptop_code: kodeLaptopRaw ? kodeLaptopRaw.toUpperCase() : undefined,
          laptop_brand: merkLaptopRaw || undefined,
          photo_url: fotoRaw || null,
        };
      }

      // Positional fallback
      const [c0, c1, c2, c3, c4, c5] = cols;
      // Check if c0 looks like a student code (SIS-XXXX)
      if (/^SIS[-_]?\d+/i.test(c0 || '') && c1) {
        return {
          student_code: c0.toUpperCase(),
          name: c1,
          class: c2 || '10',
          wilayah: parseWilayahCol(c3),
          laptop_code: c4 ? c4.toUpperCase() : undefined,
          laptop_brand: c5 || undefined,
          photo_url: null,
        };
      }

      return {
        name: c0 || '',
        class: c1 || '10',
        wilayah: parseWilayahCol(c2),
        laptop_code: c3 ? c3.toUpperCase() : undefined,
        laptop_brand: c4 || undefined,
        photo_url: c5 || null,
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
 * and common prefixes so codes like "SIS-0007", "SIS0007", "SIS-7", "0007",
 * "LAP-007", "LAP007", "PKT-205", "PKT205" can be matched reliably.
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
 * Strictly checks if a scanned code matches a Student Card (`SIS-XXXX` or `student.student_code` or student name)
 * WITHOUT matching a Laptop Bag Tag (`LAP-XXX`). Used in Phase 1 (Scan Kartu Siswa) of the sequential scanner.
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

  // Reject explicit Laptop Bag Tag prefixes in strict Student Card mode unless a student literally has that exact student_code
  const exactStudent = students.find((s) => s.student_code.trim().toUpperCase() === upper);
  if (exactStudent) return exactStudent;

  const compactStudent = students.find(
    (s) => normalizeCodeCompact(s.student_code) === compact
  );
  if (compactStudent) return compactStudent;

  if (parsedScan.prefix === 'LAP' || parsedScan.prefix === 'TAS') {
    return null;
  }

  // Prefix + number match for SIS-XXXX (e.g. "SIS-7", "SIS0007", "0007", "7")
  if (
    parsedScan.num !== null &&
    (parsedScan.prefix === 'SIS' || parsedScan.prefix === '' || parsedScan.prefix === 'SISWA')
  ) {
    const numMatched = students.find((s) => {
      const sp = extractPrefixAndNumber(s.student_code);
      return sp.num !== null && sp.num === parsedScan.num;
    });
    if (numMatched) return numMatched;
  }

  // Exact or compact student Name match
  const nameMatched = students.find(
    (s) =>
      s.name.trim().toUpperCase() === upper ||
      normalizeCodeCompact(s.name) === compact
  );
  if (nameMatched) return nameMatched;

  // Substring match inside multi-field Student Card QR text (e.g., "SIS-0007 | Rina Putri")
  const substringStudent = students.find(
    (s) =>
      upper.includes(s.student_code.trim().toUpperCase()) ||
      (s.name.trim().length >= 4 && upper.includes(s.name.trim().toUpperCase()))
  );
  if (substringStudent) return substringStudent;

  return null;
}

/**
 * Strictly checks if a scanned code matches a Laptop Bag Tag (`LAP-XXX` or `laptop.asset_code`)
 * WITHOUT accepting a Student Card (`SIS-XXXX`). Used in Phase 2 (Scan Gantungan Tas) of the sequential scanner.
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

  // 1. Exact asset_code match
  const exactLaptop = laptops.find((l) => l.asset_code.trim().toUpperCase() === upper);
  if (exactLaptop) return exactLaptop;

  // 2. Compact asset_code match (e.g. "LAP007" == "LAP-007")
  const compactLaptop = laptops.find((l) => normalizeCodeCompact(l.asset_code) === compact);
  if (compactLaptop) return compactLaptop;

  // Reject explicit Student Card prefixes in strict Bag Tag mode
  if (parsedScan.prefix === 'SIS' || parsedScan.prefix === 'SISWA') {
    return null;
  }

  // 3. Prefix + number match for LAP-XXX / TAS-XXX (or bare number when scanning bag tag)
  if (
    parsedScan.num !== null &&
    (parsedScan.prefix === 'LAP' || parsedScan.prefix === 'TAS' || parsedScan.prefix === '')
  ) {
    if (currentScannedStudent) {
      const ownedMatch = laptops.find((l) => {
        const lp = extractPrefixAndNumber(l.asset_code);
        return (
          l.assigned_student_id === currentScannedStudent.id &&
          lp.num !== null &&
          lp.num === parsedScan.num
        );
      });
      if (ownedMatch) return ownedMatch;
    }
    const numMatched = laptops.find((l) => {
      const lp = extractPrefixAndNumber(l.asset_code);
      return lp.num !== null && lp.num === parsedScan.num;
    });
    if (numMatched) return numMatched;
  }

  // 4. Substring match inside multi-field Bag Tag QR text (e.g., "LAP-007 | Lenovo")
  const substringLaptop = laptops.find((l) =>
    upper.includes(l.asset_code.trim().toUpperCase())
  );
  if (substringLaptop) return substringLaptop;

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
