import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { Laptop, PiketOption, Student, WILAYAH_LABELS } from '../types/models';

/**
 * Generate a crisp, high-DPI 1D Code-128 Barcode PNG Data URL for PDF & UI rendering.
 */
export function generateBarcodeDataUrl(
  value: string,
  options?: {
    height?: number;
    width?: number;
    displayValue?: boolean;
    fontSize?: number;
    margin?: number;
  }
): string {
  const canvas = document.createElement('canvas');
  try {
    JsBarcode(canvas, value, {
      format: 'CODE128',
      lineColor: '#0F172A',
      background: '#FFFFFF',
      width: options?.width ?? 2.4,
      height: options?.height ?? 68,
      displayValue: options?.displayValue ?? true,
      font: 'monospace',
      fontOptions: 'bold',
      fontSize: options?.fontSize ?? 16,
      textMargin: 4,
      margin: options?.margin ?? 6,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/**
 * Generate a crisp QR Code PNG Data URL for PDF & UI rendering.
 */
export async function generateQrDataUrl(value: string, size = 240): Promise<string> {
  try {
    return await QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0F172A',
        light: '#FFFFFF',
      },
    });
  } catch {
    return '';
  }
}

/**
 * Extract 1-2 character initials from a person's name.
 */
export function getInitials(name: string): string {
  const clean = name.replace(/\([^)]*\)/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'S';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Render a clean high-resolution monogram avatar to PNG Data URL (for jsPDF embedding when student has no photo).
 */
export function generateMonogramDataUrl(
  name: string,
  bgHex = '#1E3A8A',
  size = 180
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(size * 0.82, size * 0.18, size * 0.42, 0, Math.PI * 2);
  ctx.fill();

  const initials = getInitials(name);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 ${Math.round(size * 0.38)}px "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, size / 2, size / 2 + 2);

  return canvas.toDataURL('image/png');
}

/**
 * Safely load a student photo URL (local data URL or same-origin/CORS image) into a canvas PNG data URL for jsPDF.
 * Falls back gracefully to a crisp monogram avatar if loading fails.
 */
export function resolvePhotoForPdf(
  photoUrl: string | null,
  studentName: string,
  fallbackBgHex: string
): Promise<string> {
  if (!photoUrl) {
    return Promise.resolve(generateMonogramDataUrl(studentName, fallbackBgHex));
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 240;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(generateMonogramDataUrl(studentName, fallbackBgHex));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch {
        resolve(generateMonogramDataUrl(studentName, fallbackBgHex));
      }
    };
    img.onerror = () => {
      resolve(generateMonogramDataUrl(studentName, fallbackBgHex));
    };
    img.src = photoUrl;
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncateTextToWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 3 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

/**
 * Draw a single high-resolution Guru Piket / Administrator ID Card onto a target 2D canvas context
 * at coordinates (offsetX, offsetY) with dimensions 1000 x 630 (CR80 ID card aspect ratio).
 */
async function drawStaffCardOnContext(
  ctx: CanvasRenderingContext2D,
  piket: PiketOption,
  schoolName: string,
  offsetX = 0,
  offsetY = 0
): Promise<void> {
  const W = 1000;
  const H = 630;
  const isAdmin = piket.role === 'admin';
  const tokenCode = (piket.demo_token || 'PKT-201').toUpperCase();

  const [qrDataUrl, barcodeDataUrl] = await Promise.all([
    generateQrDataUrl(tokenCode, 340),
    Promise.resolve(
      generateBarcodeDataUrl(tokenCode, {
        width: 3.4,
        height: 86,
        fontSize: 22,
        margin: 8,
      })
    ),
  ]);

  const [qrImg, barcodeImg] = await Promise.all([
    loadImageElement(qrDataUrl),
    loadImageElement(barcodeDataUrl),
  ]);

  ctx.save();
  ctx.translate(offsetX, offsetY);

  // Outer Card Clip with Rounded Corners
  drawRoundedRect(ctx, 0, 0, W, H, 32);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();

  // Subtle background surface
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#F8FAFC');
  bgGrad.addColorStop(1, '#EFF6FF');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Top Header Banner (Rich Indigo-Royal for Admin, Emerald-Teal-Navy for Guru Piket)
  const headerH = 148;
  const headerGrad = ctx.createLinearGradient(0, 0, W, headerH);
  if (isAdmin) {
    headerGrad.addColorStop(0, '#1E1B4B');
    headerGrad.addColorStop(0.55, '#1D4ED8');
    headerGrad.addColorStop(1, '#4338CA');
  } else {
    headerGrad.addColorStop(0, '#0F172A');
    headerGrad.addColorStop(0.55, '#0F766E');
    headerGrad.addColorStop(1, '#0369A1');
  }
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, W, headerH);

  // Decorative subtle circles in header
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.beginPath();
  ctx.arc(W - 90, 35, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W - 240, 140, 85, 0, Math.PI * 2);
  ctx.fill();

  // Lanyard Slot Guide at Top Center
  drawRoundedRect(ctx, W / 2 - 48, 14, 96, 16, 8);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();

  // Gold / Amber Accent Stripe below header
  const stripeGrad = ctx.createLinearGradient(0, 0, W, 0);
  stripeGrad.addColorStop(0, '#F59E0B');
  stripeGrad.addColorStop(0.5, '#FBBF24');
  stripeGrad.addColorStop(1, '#D97706');
  ctx.fillStyle = stripeGrad;
  ctx.fillRect(0, headerH, W, 8);

  // Header Left Text: School Name & Subtitle
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FCD34D';
  ctx.font = '800 16px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    isAdmin
      ? 'KARTU AKSES & BARCODE LOGIN ADMINISTRATOR'
      : 'KARTU AKSES & BARCODE LOGIN GURU PIKET',
    36,
    42
  );

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(truncateTextToWidth(ctx, schoolName.toUpperCase(), 620), 36, 68);

  ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
  ctx.font = '600 15px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Sistem Manajemen Pemakaian Laptop Siswa · LapTrack Sekolah', 36, 106);

  // Header Right Role & Wilayah Badge
  const roleBadgeText = isAdmin ? 'ADMINISTRATOR' : 'GURU PIKET AKTIF';
  drawRoundedRect(ctx, W - 265, 42, 229, 38, 12);
  ctx.fillStyle = isAdmin ? '#F59E0B' : '#10B981';
  ctx.fill();
  ctx.fillStyle = isAdmin ? '#0F172A' : '#052E16';
  ctx.font = '800 16px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(roleBadgeText, W - 265 + 114.5, 61);

  // Wilayah Pill under Role Badge
  const wilayahText = WILAYAH_LABELS[piket.wilayah].toUpperCase();
  drawRoundedRect(ctx, W - 265, 90, 229, 34, 10);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(wilayahText, W - 265 + 114.5, 107);

  // =========================================================================
  // MAIN BODY: Teacher/Admin Profile Box + Scannable QR & 1D Barcode
  // =========================================================================
  // Profile Banner Card (Top of Body)
  const profX = 36;
  const profY = 178;
  const profW = W - 72;
  const profH = 132;

  drawRoundedRect(ctx, profX, profY, profW, profH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  // Avatar Circle / Rounded Square
  const avSize = 94;
  const avX = profX + 20;
  const avY = profY + 19;
  drawRoundedRect(ctx, avX, avY, avSize, avSize, 20);
  ctx.fillStyle = isAdmin ? '#1E3A8A' : '#0F766E';
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 34px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(getInitials(piket.name), avX + avSize / 2, avY + avSize / 2 + 2);

  // Name & Role Details
  const infoX = avX + avSize + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#64748B';
  ctx.font = '700 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('NAMA LENGKAP PETUGAS / GURU PIKET', infoX, profY + 20);

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(truncateTextToWidth(ctx, piket.name, 500), infoX, profY + 42);

  ctx.fillStyle = isAdmin ? '#1D4ED8' : '#0F766E';
  ctx.font = '700 16px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `${isAdmin ? 'Hak Akses Penuh Administrator' : 'Petugas Validasi Scan Sesi'} · ${
      WILAYAH_LABELS[piket.wilayah]
    }`,
    infoX,
    profY + 84
  );

  // Token Code Highlight Box on Right of Profile Banner
  const tokW = 225;
  const tokH = 92;
  const tokX = profX + profW - tokW - 20;
  const tokY = profY + 20;
  drawRoundedRect(ctx, tokX, tokY, tokW, tokH, 16);
  ctx.fillStyle = '#FEF3C7';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#F59E0B';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#92400E';
  ctx.font = '800 12px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('TOKEN KODE BARCODE', tokX + tokW / 2, tokY + 14);

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 30px "JetBrains Mono", monospace';
  ctx.fillText(tokenCode, tokX + tokW / 2, tokY + 38);

  // =========================================================================
  // BOTTOM ROW: QR Code Box (Left) + 1D Barcode Box (Right)
  // =========================================================================
  const rowY = 328;
  const rowH = 226;

  // Left Box: QR Code
  const qrBoxX = 36;
  const qrBoxW = 290;
  drawRoundedRect(ctx, qrBoxX, rowY, qrBoxW, rowH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  if (qrImg) {
    const qrDrawSize = 166;
    ctx.drawImage(
      qrImg,
      qrBoxX + (qrBoxW - qrDrawSize) / 2,
      rowY + 14,
      qrDrawSize,
      qrDrawSize
    );
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#334155';
  ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('SCAN QR KAMERA HP / LAPTOP', qrBoxX + qrBoxW / 2, rowY + 190);

  // Right Box: 1D Code-128 Barcode
  const barBoxX = 346;
  const barBoxW = W - 346 - 36;
  drawRoundedRect(ctx, barBoxX, rowY, barBoxW, rowH, 20);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#475569';
  ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('BARCODE 1D (CODE-128) · SCANNER LASER & KAMERA', barBoxX + 24, rowY + 18);

  if (barcodeImg) {
    const maxBarW = barBoxW - 48;
    const maxBarH = 132;
    const ratio = Math.min(maxBarW / barcodeImg.width, maxBarH / barcodeImg.height);
    const drawW = barcodeImg.width * ratio;
    const drawH = barcodeImg.height * ratio;
    ctx.drawImage(
      barcodeImg,
      barBoxX + (barBoxW - drawW) / 2,
      rowY + 46 + (maxBarH - drawH) / 2,
      drawW,
      drawH
    );
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 13px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `Arahkan barcode "${tokenCode}" ke kamera untuk langsung masuk Tiket Sesi`,
    barBoxX + barBoxW / 2,
    rowY + 190
  );

  // =========================================================================
  // FOOTER BAND
  // =========================================================================
  const footerY = H - 54;
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, footerY, W, 54);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    'KARTU RESMI PETUGAS · JANGAN DIPINJAMKAN KEPADA SISWA',
    36,
    footerY + 27
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = '#FCD34D';
  ctx.font = '800 14px "JetBrains Mono", monospace';
  ctx.fillText(`ID: ${tokenCode}`, W - 36, footerY + 27);

  // Outer Border Stroke
  drawRoundedRect(ctx, 2, 2, W - 4, H - 4, 30);
  ctx.lineWidth = 4;
  ctx.strokeStyle = isAdmin ? '#1E3A8A' : '#0F172A';
  ctx.stroke();

  ctx.restore();
}

/**
 * Generate a complete, high-resolution (1000 x 630 px) Guru Piket or Administrator ID Card PNG Data URL.
 */
export async function generateStaffCardPngDataUrl(
  piket: PiketOption,
  schoolName = 'SMA NEGERI 1 NUSANTARA'
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  await drawStaffCardOnContext(ctx, piket, schoolName, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Generate a single high-resolution Master Poster Sheet PNG containing ALL Guru Piket & Admin cards
 * arranged neatly in a 2-column print-ready grid.
 */
export async function generateAllStaffCardsSheetPngDataUrl(
  piketList: PiketOption[],
  schoolName = 'SMA NEGERI 1 NUSANTARA'
): Promise<string> {
  if (piketList.length === 0) return '';

  const cols = piketList.length === 1 ? 1 : 2;
  const rows = Math.ceil(piketList.length / cols);
  const cardW = 1000;
  const cardH = 630;
  const gap = 48;
  const padX = 56;
  const headerBannerH = 140;
  const padBottom = 56;

  const totalW = padX * 2 + cols * cardW + (cols - 1) * gap;
  const totalH = headerBannerH + rows * cardH + (rows - 1) * gap + padBottom;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Sheet background
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(0, 0, totalW, totalH);

  // Sheet Top Title Bar
  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, 0, totalW, 100);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FCD34D';
  ctx.font = '800 26px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `LEMBAR CETAK KARTU BARCODE LOGIN GURU PIKET & ADMIN — ${schoolName.toUpperCase()}`,
    padX,
    40
  );
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '600 17px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `Total: ${piketList.length} Kartu Petugas · Resolusi Tinggi Siap Cetak & Laminating`,
    padX,
    74
  );

  for (let i = 0; i < piketList.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + gap);
    const y = headerBannerH + row * (cardH + gap);
    await drawStaffCardOnContext(ctx, piketList[i], schoolName, x, y);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Generate a complete, high-resolution (1000 x 630 px) Student ID Card OR Bag Hang Tag PNG Data URL.
 */
export async function generateStudentOrLaptopCardPngDataUrl(params: {
  mode: 'student' | 'laptop';
  student?: Student;
  laptop?: Laptop;
  schoolName?: string;
  academicYear?: string;
}): Promise<string> {
  const schoolName = params.schoolName || 'SMA NEGERI 1 NUSANTARA';
  const academicYear = params.academicYear || 'TA 2026/2027';

  if (params.mode === 'student' && params.student) {
    const st = params.student;
    const lp = params.laptop;
    const W = 1000;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const isPutra = st.wilayah === 'putra';
    const [photoUrl, qrUrl, barUrl] = await Promise.all([
      resolvePhotoForPdf(st.photo_url, st.name, isPutra ? '#1E3A8A' : '#701A75'),
      generateQrDataUrl(st.student_code, 300),
      Promise.resolve(
        generateBarcodeDataUrl(st.student_code, {
          width: 3.2,
          height: 76,
          fontSize: 20,
          margin: 6,
        })
      ),
    ]);

    const [photoImg, qrImg, barImg] = await Promise.all([
      loadImageElement(photoUrl),
      loadImageElement(qrUrl),
      loadImageElement(barUrl),
    ]);

    drawRoundedRect(ctx, 0, 0, W, H, 30);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.clip();

    // Header
    const headGrad = ctx.createLinearGradient(0, 0, W, 130);
    headGrad.addColorStop(0, isPutra ? '#1E3A8A' : '#581C87');
    headGrad.addColorStop(1, isPutra ? '#2563EB' : '#9333EA');
    ctx.fillStyle = headGrad;
    ctx.fillRect(0, 0, W, 130);

    ctx.fillStyle = '#F59E0B';
    ctx.fillRect(0, 130, W, 8);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#FDE68A';
    ctx.font = '800 15px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('KARTU AKSES PEMAKAIAN LAPTOP SISWA', 36, 26);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 28px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(truncateTextToWidth(ctx, schoolName.toUpperCase(), 680), 36, 52);

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = '600 15px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(`${academicYear} · ${WILAYAH_LABELS[st.wilayah]}`, 36, 92);

    // Photo
    if (photoImg) {
      ctx.save();
      drawRoundedRect(ctx, 36, 168, 190, 220, 20);
      ctx.clip();
      ctx.drawImage(photoImg, 36, 168, 190, 220);
      ctx.restore();
      drawRoundedRect(ctx, 36, 168, 190, 220, 20);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#CBD5E1';
      ctx.stroke();
    }

    // Student info
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1D4ED8';
    ctx.font = '800 24px "JetBrains Mono", monospace';
    ctx.fillText(st.student_code, 254, 174);

    ctx.fillStyle = '#0F172A';
    ctx.font = '800 32px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(truncateTextToWidth(ctx, st.name, 460), 254, 212);

    ctx.fillStyle = '#475569';
    ctx.font = '700 20px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(`Kelas ${st.class} · ${WILAYAH_LABELS[st.wilayah]}`, 254, 262);

    drawRoundedRect(ctx, 254, 306, 440, 68, 14);
    ctx.fillStyle = '#F1F5F9';
    ctx.fill();
    ctx.fillStyle = '#0F172A';
    ctx.font = '800 20px "JetBrains Mono", monospace';
    ctx.fillText(
      lp ? `Tas Laptop: ${lp.asset_code} (${lp.brand_model})` : 'Tas Laptop: Belum Ditentukan',
      274,
      330
    );

    // QR on right
    if (qrImg) {
      drawRoundedRect(ctx, W - 246, 168, 210, 220, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#CBD5E1';
      ctx.stroke();
      ctx.drawImage(qrImg, W - 226, 178, 170, 170);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#334155';
      ctx.font = '800 13px "Plus Jakarta Sans", system-ui, sans-serif';
      ctx.fillText('SCAN KARTU SISWA', W - 141, 358);
    }

    // Bottom 1D Barcode
    if (barImg) {
      drawRoundedRect(ctx, 36, 412, W - 72, 146, 18);
      ctx.fillStyle = '#F8FAFC';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#E2E8F0';
      ctx.stroke();
      const maxW = 620;
      const maxH = 115;
      const r = Math.min(maxW / barImg.width, maxH / barImg.height);
      const dw = barImg.width * r;
      const dh = barImg.height * r;
      ctx.drawImage(barImg, (W - dw) / 2, 412 + (146 - dh) / 2, dw, dh);
    }

    // Footer
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, H - 46, W, 46);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      'WAJIB DIBAWA SAAT MENGAMBIL & MENGEMBALIKAN LAPTOP SEKOLAH',
      W / 2,
      H - 23
    );

    return canvas.toDataURL('image/png');
  }

  // Bag Hang Tag PNG (Vertical 680 x 1080)
  const lp = params.laptop;
  const st = params.student;
  if (!lp) return '';

  const W = 680;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const [qrUrl, barUrl] = await Promise.all([
    generateQrDataUrl(lp.asset_code, 300),
    Promise.resolve(
      generateBarcodeDataUrl(lp.asset_code, {
        width: 3.4,
        height: 100,
        fontSize: 24,
        margin: 8,
      })
    ),
  ]);
  const [qrImg, barImg] = await Promise.all([
    loadImageElement(qrUrl),
    loadImageElement(barUrl),
  ]);

  drawRoundedRect(ctx, 0, 0, W, H, 32);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.clip();

  // Top Lanyard Hole Area
  ctx.fillStyle = '#EFF6FF';
  ctx.fillRect(0, 0, W, 110);
  ctx.beginPath();
  ctx.arc(W / 2, 50, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#64748B';
  ctx.stroke();

  // Header
  ctx.fillStyle = '#1E3A8A';
  ctx.fillRect(0, 110, W, 120);
  ctx.fillStyle = '#F59E0B';
  ctx.fillRect(0, 230, W, 8);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FDE68A';
  ctx.font = '800 16px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('GANTUNGAN BARCODE TAS LAPTOP', W / 2, 132);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 26px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(truncateTextToWidth(ctx, schoolName.toUpperCase(), W - 60), W / 2, 164);

  // Asset Code & Brand
  ctx.fillStyle = '#1E3A8A';
  ctx.font = '800 58px "JetBrains Mono", monospace';
  ctx.fillText(lp.asset_code, W / 2, 266);
  ctx.fillStyle = '#475569';
  ctx.font = '700 22px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(lp.brand_model, W / 2, 336);

  // Owner Box
  drawRoundedRect(ctx, 44, 386, W - 88, 170, 20);
  ctx.fillStyle = '#F8FAFC';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#CBD5E1';
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = '800 14px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('PEMILIK TAS LAPTOP TERDAFTAR', W / 2, 410);

  ctx.fillStyle = '#0F172A';
  ctx.font = '800 30px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    truncateTextToWidth(ctx, st ? st.name : 'Belum Dialokasikan', W - 130),
    W / 2,
    444
  );

  ctx.fillStyle = '#1D4ED8';
  ctx.font = '700 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    st
      ? `Kelas ${st.class} · ${WILAYAH_LABELS[st.wilayah]} · ${st.student_code}`
      : 'Hubungi Petugas Lab',
    W / 2,
    496
  );

  // QR + Barcode
  if (qrImg) {
    ctx.drawImage(qrImg, (W - 200) / 2, 580, 200, 200);
  }
  if (barImg) {
    const maxW = W - 96;
    const maxH = 160;
    const r = Math.min(maxW / barImg.width, maxH / barImg.height);
    const dw = barImg.width * r;
    const dh = barImg.height * r;
    ctx.drawImage(barImg, (W - dw) / 2, 800, dw, dh);
  }

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(0, H - 56, W, 56);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 15px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('SCAN BERSAMA KARTU SISWA SAAT PINJAM / KEMBALI', W / 2, H - 28);

  return canvas.toDataURL('image/png');
}
