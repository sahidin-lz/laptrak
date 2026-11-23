import { jsPDF } from 'jspdf';
import {
  CARD_THEMES,
  Laptop,
  PrintSettings,
  Student,
  Transaction,
  WILAYAH_LABELS,
} from '../types/models';
import {
  generateBarcodeDataUrl,
  generateQrDataUrl,
  resolvePhotoForPdf,
} from './barcode';
import { formatDateOnly, formatDateTimeID } from './store';

const A4_W = 210;
const A4_H = 297;

function drawCropMarks(doc: jsPDF, x: number, y: number, w: number, h: number) {
  const len = 3;
  const gap = 1.2;
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.2);

  // Top-left
  doc.line(x - gap - len, y, x - gap, y);
  doc.line(x, y - gap - len, x, y - gap);
  // Top-right
  doc.line(x + w + gap, y, x + w + gap + len, y);
  doc.line(x + w, y - gap - len, x + w, y - gap);
  // Bottom-left
  doc.line(x - gap - len, y + h, x - gap, y + h);
  doc.line(x, y + h + gap, x, y + h + gap + len);
  // Bottom-right
  doc.line(x + w + gap, y + h, x + w + gap + len, y + h);
  doc.line(x + w, y + h + gap, x + w, y + h + gap + len);
}

function drawPunchHole(doc: jsPDF, cx: number, cy: number) {
  // Outer reinforcement ring
  doc.setDrawColor(148, 163, 184);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.25);
  doc.circle(cx, cy, 4.0, 'FD');

  // Inner punch cutout circle (5mm hole diameter)
  doc.setDrawColor(71, 85, 105);
  doc.setLineWidth(0.3);
  doc.circle(cx, cy, 2.5, 'S');

  // Fine center crosshair
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.15);
  doc.line(cx - 1.4, cy, cx + 1.4, cy);
  doc.line(cx, cy - 1.4, cx, cy + 1.4);
}

function drawPageFooter(doc: jsPDF, title: string, pageNum: number, totalPages: number) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(title, 12, A4_H - 6.5);
  doc.text(`Halaman ${pageNum} dari ${totalPages}`, A4_W - 12, A4_H - 6.5, { align: 'right' });
}

function truncateText(doc: jsPDF, text: string, maxWidth: number): string {
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 2 && doc.getTextWidth(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

async function drawLandscapeStudentCard(
  doc: jsPDF,
  x: number,
  y: number,
  student: Student,
  assignedLaptop: Laptop | undefined,
  settings: PrintSettings
) {
  const W = 85.6;
  const H = 54;
  const theme = CARD_THEMES[settings.theme];

  // Outer card background & crisp hairline border
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, W, H, 2.5, 2.5, 'FD');

  // Header band
  doc.setFillColor(...theme.primaryRgb);
  doc.roundedRect(x, y, W, 12.2, 2.5, 2.5, 'F');
  doc.rect(x, y + 8, W, 4.2, 'F'); // square bottom edge of header

  // Accent strip under header
  doc.setFillColor(...theme.accentRgb);
  doc.rect(x, y + 12.2, W, 0.9, 'F');

  // Header typography
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.8);
  doc.text(truncateText(doc, settings.schoolName.toUpperCase(), 58), x + 4, y + 5.6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.4);
  doc.setTextColor(226, 232, 240);
  doc.text('KARTU AKSES PEMINJAMAN LAPTOP', x + 4, y + 9.8);

  doc.setFont('courier', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(255, 255, 255);
  doc.text(settings.academicYear, x + W - 4, y + 6.5, { align: 'right' });

  // Student Photo / Monogram
  const photoData = await resolvePhotoForPdf(student.photo_url, student.name, theme.primaryHex);
  const photoX = x + 4;
  const photoY = y + 15.8;
  const photoW = 16.5;
  const photoH = 19.5;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(photoX - 0.3, photoY - 0.3, photoW + 0.6, photoH + 0.6, 'S');
  if (photoData) {
    doc.addImage(photoData, photoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', photoX, photoY, photoW, photoH);
  }

  // Student Details (middle column)
  const infoX = x + 23.2;
  const maxInfoW = 40.5;

  // Student Code label
  doc.setFont('courier', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...theme.primaryRgb);
  doc.text(student.student_code, infoX, y + 19.4);

  // Name (up to 2 lines cleanly)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  doc.setTextColor(15, 23, 42);
  const nameLines = doc.splitTextToSize(student.name, maxInfoW) as string[];
  doc.text(nameLines.slice(0, 2), infoX, y + 24.1);

  const afterNameY = nameLines.length > 1 ? y + 31.2 : y + 28.4;

  // Class & Wilayah
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.6);
  doc.setTextColor(71, 85, 105);
  const wilayahText = student.wilayah === 'putri' ? 'Putri' : 'Putra';
  doc.text(`Kelas ${student.class} · ${wilayahText}`, infoX, afterNameY);

  // Assigned Laptop
  doc.setFont('courier', 'bold');
  doc.setFontSize(6.6);
  doc.setTextColor(...theme.accentRgb);
  const lapText = assignedLaptop ? `Tas: ${assignedLaptop.asset_code}` : 'Tas: Belum Ditentukan';
  doc.text(truncateText(doc, lapText, maxInfoW), infoX, afterNameY + 4.1);

  // QR Code (right side)
  const qrData = await generateQrDataUrl(student.student_code, 240);
  const qrSize = 16.8;
  const qrX = x + W - qrSize - 4;
  const qrY = y + 15.6;
  if (qrData) {
    doc.addImage(qrData, 'PNG', qrX, qrY, qrSize, qrSize);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(4.8);
  doc.setTextColor(100, 116, 139);
  doc.text('SCAN KARTU', qrX + qrSize / 2, qrY + qrSize + 2.3, { align: 'center' });

  // Bottom strip: Barcode or institutional footer
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(x + 4, y + 37.8, x + W - 4, y + 37.8);

  if (settings.includeBarcodeOnCard) {
    const barcodeData = generateBarcodeDataUrl(student.student_code, {
      width: 2.2,
      height: 46,
      displayValue: true,
      fontSize: 14,
      margin: 2,
    });
    if (barcodeData) {
      const bcW = 54;
      const bcH = 13.4;
      doc.addImage(barcodeData, 'PNG', x + (W - bcW) / 2, y + 39.0, bcW, bcH);
    }
  } else {
    doc.setFillColor(...theme.tintRgb);
    doc.rect(x + 0.5, y + 38.4, W - 1, 14.8, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.0);
    doc.setTextColor(71, 85, 105);
    doc.text(
      truncateText(doc, settings.schoolSubtext, W - 10),
      x + W / 2,
      y + 44.5,
      { align: 'center' }
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.6);
    doc.setTextColor(...theme.primaryRgb);
    doc.text('Wajib dibawa saat mengambil & mengembalikan laptop', x + W / 2, y + 49.0, {
      align: 'center',
    });
  }

  if (settings.showCutGuides) {
    drawCropMarks(doc, x, y, W, H);
  }
}

async function drawPortraitStudentCard(
  doc: jsPDF,
  x: number,
  y: number,
  student: Student,
  assignedLaptop: Laptop | undefined,
  settings: PrintSettings
) {
  const W = 54;
  const H = 85.6;
  const theme = CARD_THEMES[settings.theme];

  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, W, H, 2.5, 2.5, 'FD');

  // Header
  doc.setFillColor(...theme.primaryRgb);
  doc.roundedRect(x, y, W, 15.5, 2.5, 2.5, 'F');
  doc.rect(x, y + 10, W, 5.5, 'F');
  doc.setFillColor(...theme.accentRgb);
  doc.rect(x, y + 15.5, W, 0.9, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.2);
  doc.text(truncateText(doc, settings.schoolName.toUpperCase(), W - 6), x + W / 2, y + 6.5, {
    align: 'center',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.2);
  doc.setTextColor(226, 232, 240);
  doc.text(`KARTU LAPTOP · ${settings.academicYear}`, x + W / 2, y + 11.4, { align: 'center' });

  // Photo centered
  const photoData = await resolvePhotoForPdf(student.photo_url, student.name, theme.primaryHex);
  const pW = 16.5;
  const pH = 19;
  const pX = x + (W - pW) / 2;
  const pY = y + 19.2;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.2);
  doc.rect(pX - 0.3, pY - 0.3, pW + 0.6, pH + 0.6, 'S');
  if (photoData) {
    doc.addImage(photoData, photoData.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', pX, pY, pW, pH);
  }

  // Name, Class, Codes
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text(truncateText(doc, student.name, W - 8), x + W / 2, y + 43.2, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Kelas ${student.class} · ${student.wilayah === 'putri' ? 'Putri' : 'Putra'}`,
    x + W / 2,
    y + 47.2,
    { align: 'center' }
  );

  doc.setFont('courier', 'bold');
  doc.setFontSize(8.2);
  doc.setTextColor(...theme.primaryRgb);
  doc.text(student.student_code, x + W / 2, y + 51.6, { align: 'center' });

  doc.setFont('courier', 'bold');
  doc.setFontSize(6.2);
  doc.setTextColor(...theme.accentRgb);
  doc.text(
    assignedLaptop ? `Tas Laptop: ${assignedLaptop.asset_code}` : 'Tas Laptop: —',
    x + W / 2,
    y + 55.2,
    { align: 'center' }
  );

  // QR Code
  const qrData = await generateQrDataUrl(student.student_code, 220);
  if (settings.includeBarcodeOnCard) {
    const qrS = 14.5;
    if (qrData) {
      doc.addImage(qrData, 'PNG', x + (W - qrS) / 2, y + 57.0, qrS, qrS);
    }
    const bcData = generateBarcodeDataUrl(student.student_code, {
      width: 2,
      height: 36,
      displayValue: true,
      fontSize: 13,
      margin: 2,
    });
    if (bcData) {
      doc.addImage(bcData, 'PNG', x + 5, y + 72.5, W - 10, 11);
    }
  } else {
    const qrS = 22;
    if (qrData) {
      doc.addImage(qrData, 'PNG', x + (W - qrS) / 2, y + 58.2, qrS, qrS);
    }
  }

  if (settings.showCutGuides) {
    drawCropMarks(doc, x, y, W, H);
  }
}

async function drawSingleBagTag(
  doc: jsPDF,
  x: number,
  y: number,
  laptop: Laptop,
  owner: Student | undefined,
  settings: PrintSettings
) {
  const W = 58;
  const H = 94;
  const theme = CARD_THEMES[settings.theme];

  // Outer Tag Shape
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, W, H, 3.2, 3.2, 'FD');

  // Top punch-hole header zone
  doc.setFillColor(...theme.tintRgb);
  doc.roundedRect(x + 0.2, y + 0.2, W - 0.4, 14.2, 3, 3, 'F');
  doc.rect(x + 0.2, y + 9, W - 0.4, 5.4, 'F');

  if (settings.showPunchHole) {
    drawPunchHole(doc, x + W / 2, y + 7.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(4.4);
    doc.setTextColor(100, 116, 139);
    doc.text('LUBANG TALI', x + W / 2, y + 13.2, { align: 'center' });
  }

  // Colored Brand Header Band
  doc.setFillColor(...theme.primaryRgb);
  doc.rect(x + 0.2, y + 14.4, W - 0.4, 11.4, 'F');
  doc.setFillColor(...theme.accentRgb);
  doc.rect(x + 0.2, y + 25.8, W - 0.4, 0.9, 'F');

  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.4);
  doc.text('GANTUNGAN TAS LAPTOP', x + W / 2, y + 18.8, { align: 'center' });

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.text(truncateText(doc, settings.schoolName.toUpperCase(), W - 6), x + W / 2, y + 23.4, {
    align: 'center',
  });

  // Prominent Asset Code + Model + Optional QR Code
  if (settings.includeQrOnTag) {
    const qrData = await generateQrDataUrl(laptop.asset_code, 220);
    const qrSize = 15.5;
    // Left text block
    doc.setFont('courier', 'bold');
    doc.setFontSize(13.5);
    doc.setTextColor(...theme.primaryRgb);
    doc.text(laptop.asset_code, x + 4, y + 34.4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.4);
    doc.setTextColor(71, 85, 105);
    const modelLines = doc.splitTextToSize(laptop.brand_model, 33) as string[];
    doc.text(modelLines.slice(0, 2), x + 4, y + 38.8);

    // Right QR
    if (qrData) {
      doc.addImage(qrData, 'PNG', x + W - qrSize - 3.6, y + 28.4, qrSize, qrSize);
    }
  } else {
    doc.setFont('courier', 'bold');
    doc.setFontSize(16.5);
    doc.setTextColor(...theme.primaryRgb);
    doc.text(laptop.asset_code, x + W / 2, y + 35.6, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.0);
    doc.setTextColor(71, 85, 105);
    doc.text(truncateText(doc, laptop.brand_model, W - 8), x + W / 2, y + 40.8, {
      align: 'center',
    });
  }

  // Owner Card Panel
  const ownerBoxY = y + 46.2;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.25);
  doc.roundedRect(x + 3.6, ownerBoxY, W - 7.2, 18.2, 1.8, 1.8, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.setTextColor(100, 116, 139);
  doc.text('PEMILIK TERDAFTAR', x + 6, ownerBoxY + 4.4);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text(
    truncateText(doc, owner ? owner.name : 'Belum Dialokasikan', W - 12),
    x + 6,
    ownerBoxY + 9.6
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(71, 85, 105);
  doc.text(
    owner
      ? `Kelas ${owner.class} · ${owner.wilayah === 'putri' ? 'Putri' : 'Putra'}`
      : 'Hubungi Petugas Lab',
    x + 6,
    ownerBoxY + 13.6
  );

  if (owner) {
    doc.setFont('courier', 'bold');
    doc.setFontSize(6.6);
    doc.setTextColor(...theme.accentRgb);
    doc.text(owner.student_code, x + W - 6, ownerBoxY + 13.6, { align: 'right' });
  }

  // Large High-Contrast 1D Code-128 Barcode Zone (Bottom)
  const barcodeData = generateBarcodeDataUrl(laptop.asset_code, {
    width: 2.6,
    height: 70,
    displayValue: true,
    fontSize: 17,
    margin: 4,
  });
  if (barcodeData) {
    const bcW = W - 7.2;
    const bcH = 21.5;
    doc.addImage(barcodeData, 'PNG', x + 3.6, y + 66.8, bcW, bcH);
  }

  // Bottom notice
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(4.7);
  doc.setTextColor(100, 116, 139);
  doc.text('Scan barcode ini bersama kartu siswa saat pinjam / kembali', x + W / 2, y + H - 2.6, {
    align: 'center',
  });

  if (settings.showCutGuides) {
    drawCropMarks(doc, x, y, W, H);
  }
}

async function drawFoldableBagTag(
  doc: jsPDF,
  x: number,
  y: number,
  laptop: Laptop,
  owner: Student | undefined,
  settings: PrintSettings
) {
  const halfW = 58;
  const W = halfW * 2; // 116mm total width, folds cleanly in half to 58×84mm
  const H = 84;
  const theme = CARD_THEMES[settings.theme];

  // Outer rectangle
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, y, W, H, 2.8, 2.8, 'FD');

  // Center fold line (dashed)
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.25);
  doc.setLineDashPattern([2, 1.5], 0);
  doc.line(x + halfW, y, x + halfW, y + H);
  doc.setLineDashPattern([], 0);

  // ========== LEFT HALF: SISI DEPAN (Identity + QR) ==========
  doc.setFillColor(...theme.tintRgb);
  doc.rect(x + 0.3, y + 0.3, halfW - 0.5, 13.2, 'F');
  if (settings.showPunchHole) {
    drawPunchHole(doc, x + halfW / 2, y + 6.8);
  }

  doc.setFillColor(...theme.primaryRgb);
  doc.rect(x + 0.3, y + 13.5, halfW - 0.5, 11, 'F');
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.text('GANTUNGAN TAS LAPTOP · DEPAN', x + halfW / 2, y + 17.8, { align: 'center' });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.6);
  doc.text(truncateText(doc, settings.schoolName.toUpperCase(), halfW - 6), x + halfW / 2, y + 22.1, {
    align: 'center',
  });

  // Giant Asset Code
  doc.setFont('courier', 'bold');
  doc.setFontSize(15.5);
  doc.setTextColor(...theme.primaryRgb);
  doc.text(laptop.asset_code, x + halfW / 2, y + 32.8, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text(truncateText(doc, laptop.brand_model, halfW - 8), x + halfW / 2, y + 37.2, {
    align: 'center',
  });

  // Owner block
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(x + 4, y + 40.2, halfW - 8, 17, 1.6, 1.6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.0);
  doc.setTextColor(100, 116, 139);
  doc.text('PEMILIK LAPTOP', x + halfW / 2, y + 44.2, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.4);
  doc.setTextColor(15, 23, 42);
  doc.text(truncateText(doc, owner ? owner.name : 'Belum Dialokasikan', halfW - 12), x + halfW / 2, y + 49.4, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    owner
      ? `Kelas ${owner.class} · ${owner.wilayah === 'putra' ? 'Putra' : 'Putri'} · ${owner.student_code}`
      : 'Belum terhubung siswa',
    x + halfW / 2,
    y + 54.0,
    { align: 'center' }
  );

  // QR Code centered at bottom of front side
  const qrData = await generateQrDataUrl(laptop.asset_code, 220);
  if (qrData) {
    const qS = 20.5;
    doc.addImage(qrData, 'PNG', x + (halfW - qS) / 2, y + 59.5, qS, qS);
  }

  // ========== RIGHT HALF: SISI BELAKANG (Extra Large Barcode + Notice) ==========
  const rx = x + halfW;
  doc.setFillColor(...theme.tintRgb);
  doc.rect(rx + 0.2, y + 0.3, halfW - 0.5, 13.2, 'F');
  if (settings.showPunchHole) {
    drawPunchHole(doc, rx + halfW / 2, y + 6.8);
  }

  doc.setFillColor(15, 23, 42);
  doc.rect(rx + 0.2, y + 13.5, halfW - 0.5, 11, 'F');
  doc.setTextColor(226, 232, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.2);
  doc.text('BARCODE SCANNER · BELAKANG', rx + halfW / 2, y + 17.8, { align: 'center' });
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6.5);
  doc.text(settings.academicYear, rx + halfW / 2, y + 22.1, { align: 'center' });

  // Extra-large 1D Code-128 Barcode for laser/camera scanner
  const barcodeData = generateBarcodeDataUrl(laptop.asset_code, {
    width: 2.6,
    height: 82,
    displayValue: true,
    fontSize: 18,
    margin: 4,
  });
  if (barcodeData) {
    doc.addImage(barcodeData, 'PNG', rx + 4, y + 29, halfW - 8, 25);
  }

  // Handling & Return Rules Box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(rx + 4, y + 57.5, halfW - 8, 22, 1.6, 1.6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(5.8);
  doc.setTextColor(...theme.primaryRgb);
  doc.text('KETENTUAN PEMAKAIAN', rx + 6.5, y + 62.0);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.3);
  doc.setTextColor(71, 85, 105);
  const rules = [
    '1. Hanya boleh diambil pemilik sesuai jadwal.',
    '2. Wajib scan kartu siswa + gantungan tas.',
    '3. Jika ditemukan, kembalikan ke Ruang Lab.',
  ];
  doc.text(rules, rx + 6.5, y + 66.4, { lineHeightFactor: 1.45 });

  if (settings.showCutGuides) {
    drawCropMarks(doc, x, y, W, H);
  }
}

/**
 * Export Student ID Cards (CR80) to an A4 Print-Ready PDF.
 */
export async function exportStudentCardsPdf(
  students: Student[],
  allLaptops: Laptop[],
  settings: PrintSettings,
  filename?: string
): Promise<void> {
  if (students.length === 0) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const isLandscape = settings.cardOrientation === 'landscape';

  const cols = isLandscape ? 2 : 3;
  const rows = isLandscape ? 4 : 3;
  const perPage = cols * rows;
  const cardW = isLandscape ? 85.6 : 54;
  const cardH = isLandscape ? 54 : 85.6;
  const gapX = isLandscape ? 8 : 7;
  const gapY = isLandscape ? 8 : 7;

  const totalW = cols * cardW + (cols - 1) * gapX;
  const totalH = rows * cardH + (rows - 1) * gapY;
  const startX = (A4_W - totalW) / 2;
  const startY = (A4_H - totalH) / 2 - 2;

  const totalPages = Math.ceil(students.length / perPage);

  for (let i = 0; i < students.length; i++) {
    const pageIndex = Math.floor(i / perPage);
    const slotIndex = i % perPage;
    if (i > 0 && slotIndex === 0) {
      doc.addPage('a4', 'portrait');
    }

    const col = slotIndex % cols;
    const row = Math.floor(slotIndex / cols);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    const student = students[i];
    const assignedLaptop = allLaptops.find((l) => l.assigned_student_id === student.id);

    if (isLandscape) {
      await drawLandscapeStudentCard(doc, x, y, student, assignedLaptop, settings);
    } else {
      await drawPortraitStudentCard(doc, x, y, student, assignedLaptop, settings);
    }

    if (slotIndex === perPage - 1 || i === students.length - 1) {
      drawPageFooter(
        doc,
        `Kartu Siswa (${isLandscape ? 'CR80 Landscape' : 'CR80 Portrait'}) — ${settings.schoolName}`,
        pageIndex + 1,
        totalPages
      );
    }
  }

  const outName =
    filename ||
    (students.length === 1
      ? `Kartu-Siswa-${students[0].student_code}.pdf`
      : `Kartu-Siswa-Batch-${students.length}-Siswa.pdf`);
  doc.save(outName);
}

/**
 * Export Laptop Bag Hang Tags ("Gantungan Barcode Tas Laptop") to an A4 Print-Ready PDF.
 */
export async function exportBagTagsPdf(
  laptops: Laptop[],
  allStudents: Student[],
  settings: PrintSettings,
  filename?: string
): Promise<void> {
  if (laptops.length === 0) return;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const isFoldable = settings.bagTagStyle === 'foldable';

  const cols = isFoldable ? 1 : 3;
  const rows = isFoldable ? 3 : 2;
  const perPage = cols * rows;
  const tagW = isFoldable ? 116 : 58;
  const tagH = isFoldable ? 84 : 94;
  const gapX = isFoldable ? 0 : 7;
  const gapY = isFoldable ? 10 : 14;

  const totalW = cols * tagW + (cols - 1) * gapX;
  const totalH = rows * tagH + (rows - 1) * gapY;
  const startX = (A4_W - totalW) / 2;
  const startY = (A4_H - totalH) / 2 - 2;

  const totalPages = Math.ceil(laptops.length / perPage);

  for (let i = 0; i < laptops.length; i++) {
    const pageIndex = Math.floor(i / perPage);
    const slotIndex = i % perPage;
    if (i > 0 && slotIndex === 0) {
      doc.addPage('a4', 'portrait');
    }

    const col = slotIndex % cols;
    const row = Math.floor(slotIndex / cols);
    const x = startX + col * (tagW + gapX);
    const y = startY + row * (tagH + gapY);

    const laptop = laptops[i];
    const owner = allStudents.find((s) => s.id === laptop.assigned_student_id);

    if (isFoldable) {
      await drawFoldableBagTag(doc, x, y, laptop, owner, settings);
    } else {
      await drawSingleBagTag(doc, x, y, laptop, owner, settings);
    }

    if (slotIndex === perPage - 1 || i === laptops.length - 1) {
      drawPageFooter(
        doc,
        `Gantungan Barcode Tas (${isFoldable ? 'Model Lipat 2 Sisi' : 'Model 1 Sisi'}) — ${settings.schoolName}`,
        pageIndex + 1,
        totalPages
      );
    }
  }

  const outName =
    filename ||
    (laptops.length === 1
      ? `Gantungan-Tas-${laptops[0].asset_code}.pdf`
      : `Gantungan-Barcode-Tas-${laptops.length}-Unit.pdf`);
  doc.save(outName);
}

/**
 * Export BOTH Student ID Cards and Laptop Bag Hang Tags into a single combined A4 PDF bundle.
 */
export async function exportCombinedBundlePdf(
  students: Student[],
  laptops: Laptop[],
  allStudents: Student[],
  allLaptops: Laptop[],
  settings: PrintSettings
): Promise<void> {
  if (students.length === 0 && laptops.length === 0) return;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const isLandscape = settings.cardOrientation === 'landscape';
  const cardCols = isLandscape ? 2 : 3;
  const cardRows = isLandscape ? 4 : 3;
  const cardPerPage = cardCols * cardRows;
  const cardPages = students.length > 0 ? Math.ceil(students.length / cardPerPage) : 0;

  const isFoldable = settings.bagTagStyle === 'foldable';
  const tagCols = isFoldable ? 1 : 3;
  const tagRows = isFoldable ? 3 : 2;
  const tagPerPage = tagCols * tagRows;
  const tagPages = laptops.length > 0 ? Math.ceil(laptops.length / tagPerPage) : 0;

  const totalPages = cardPages + tagPages;
  let currentPage = 0;

  // Part 1: Student Cards
  if (students.length > 0) {
    const cardW = isLandscape ? 85.6 : 54;
    const cardH = isLandscape ? 54 : 85.6;
    const gapX = isLandscape ? 8 : 7;
    const gapY = isLandscape ? 8 : 7;
    const startX = (A4_W - (cardCols * cardW + (cardCols - 1) * gapX)) / 2;
    const startY = (A4_H - (cardRows * cardH + (cardRows - 1) * gapY)) / 2 - 2;

    for (let i = 0; i < students.length; i++) {
      const slotIndex = i % cardPerPage;
      if (slotIndex === 0) {
        if (currentPage > 0) doc.addPage('a4', 'portrait');
        currentPage++;
      }
      const col = slotIndex % cardCols;
      const row = Math.floor(slotIndex / cardCols);
      const x = startX + col * (cardW + gapX);
      const y = startY + row * (cardH + gapY);
      const assignedLaptop = allLaptops.find((l) => l.assigned_student_id === students[i].id);

      if (isLandscape) {
        await drawLandscapeStudentCard(doc, x, y, students[i], assignedLaptop, settings);
      } else {
        await drawPortraitStudentCard(doc, x, y, students[i], assignedLaptop, settings);
      }

      if (slotIndex === cardPerPage - 1 || i === students.length - 1) {
        drawPageFooter(
          doc,
          `Paket Cetak — Bagian 1: Kartu Siswa · ${settings.schoolName}`,
          currentPage,
          totalPages
        );
      }
    }
  }

  // Part 2: Laptop Bag Hang Tags
  if (laptops.length > 0) {
    const tagW = isFoldable ? 116 : 58;
    const tagH = isFoldable ? 84 : 94;
    const gapX = isFoldable ? 0 : 7;
    const gapY = isFoldable ? 10 : 14;
    const startX = (A4_W - (tagCols * tagW + (tagCols - 1) * gapX)) / 2;
    const startY = (A4_H - (tagRows * tagH + (tagRows - 1) * gapY)) / 2 - 2;

    for (let i = 0; i < laptops.length; i++) {
      const slotIndex = i % tagPerPage;
      if (slotIndex === 0) {
        if (currentPage > 0) doc.addPage('a4', 'portrait');
        currentPage++;
      }
      const col = slotIndex % tagCols;
      const row = Math.floor(slotIndex / tagCols);
      const x = startX + col * (tagW + gapX);
      const y = startY + row * (tagH + gapY);
      const owner = allStudents.find((s) => s.id === laptops[i].assigned_student_id);

      if (isFoldable) {
        await drawFoldableBagTag(doc, x, y, laptops[i], owner, settings);
      } else {
        await drawSingleBagTag(doc, x, y, laptops[i], owner, settings);
      }

      if (slotIndex === tagPerPage - 1 || i === laptops.length - 1) {
        drawPageFooter(
          doc,
          `Paket Cetak — Bagian 2: Gantungan Barcode Tas · ${settings.schoolName}`,
          currentPage,
          totalPages
        );
      }
    }
  }

  doc.save(`Paket-Kartu-Dan-Gantungan-Tas-${settings.academicYear.replace(/[^\w-]/g, '-')}.pdf`);
}

export interface UsageReportPdfParams {
  transactions: Transaction[];
  students: Student[];
  laptops: Laptop[];
  settings?: PrintSettings;
  periodType: 'harian' | 'bulanan' | 'tahunan' | 'semua';
  periodLabel: string;
  wilayahLabel: string;
  periodBreakdown?: Array<{
    label: string;
    total: number;
    harian: number;
    pulang: number;
    late: number;
  }>;
}

/**
 * Export Categorized Usage & Recapitulation Report (Harian / Bulanan / Tahunan / Semua) to A4 Landscape PDF.
 */
export async function exportUsageReportPdf(params: UsageReportPdfParams): Promise<void> {
  const {
    transactions,
    students,
    laptops,
    settings,
    periodType,
    periodLabel,
    wilayahLabel,
    periodBreakdown = [],
  } = params;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 297;
  const pageH = 210;
  const marginX = 12;

  const schoolName = settings?.schoolName || 'LapTrack Sekolah';
  const academicYear = settings?.academicYear || 'Tahun Ajaran Aktif';
  const studentMap = new Map(students.map((s) => [s.id, s]));
  const laptopMap = new Map(laptops.map((l) => [l.id, l]));

  const categoryTitleMap: Record<UsageReportPdfParams['periodType'], string> = {
    harian: 'LAPORAN REKAPITULASI HARIAN (PER HARI)',
    bulanan: 'LAPORAN REKAPITULASI BULANAN (PER BULAN)',
    tahunan: 'LAPORAN REKAPITULASI TAHUNAN (PER TAHUN)',
    semua: 'LAPORAN REKAPITULASI SELURUH PERIODE',
  };

  const totalTx = transactions.length;
  const harianCount = transactions.filter((t) => t.transaction_type !== 'pulang').length;
  const pulangCount = transactions.filter((t) => t.transaction_type === 'pulang').length;
  const activeCount = transactions.filter((t) => t.status === 'active').length;
  const lateCount = transactions.filter((t) => t.is_late).length;
  const onTimeReturnedCount = transactions.filter(
    (t) => t.status === 'returned' && !t.is_late
  ).length;

  const drawReportHeader = (isFirstPage: boolean) => {
    // Top dark header banner
    doc.setFillColor(15, 23, 42);
    doc.roundedRect(marginX, 10, pageW - marginX * 2, 22, 2.2, 2.2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(schoolName.toUpperCase(), marginX + 5, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(203, 213, 225);
    doc.text(
      `${categoryTitleMap[periodType]} · ${academicYear}`,
      marginX + 5,
      24
    );

    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(253, 224, 71);
    doc.text(`PERIODE: ${periodLabel.toUpperCase()}`, pageW - marginX - 5, 17.5, {
      align: 'right',
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(226, 232, 240);
    doc.text(
      `Wilayah: ${wilayahLabel} · Dicetak: ${formatDateTimeID(new Date().toISOString())}`,
      pageW - marginX - 5,
      24,
      { align: 'right' }
    );

    if (!isFirstPage) return 36;

    // Summary KPI Cards on Page 1
    const kpis = [
      { label: 'TOTAL TRANSAKSI', value: String(totalTx), rgb: [30, 64, 175] as [number, number, number] },
      { label: 'SESI HARIAN & KEGIATAN', value: String(harianCount), rgb: [2, 132, 199] as [number, number, number] },
      { label: 'IZIN KEPULANGAN', value: String(pulangCount), rgb: [109, 40, 217] as [number, number, number] },
      { label: 'MASIH DIPAKAI', value: String(activeCount), rgb: [217, 119, 6] as [number, number, number] },
      { label: 'KEMBALI TEPAT WAKTU', value: String(onTimeReturnedCount), rgb: [5, 150, 105] as [number, number, number] },
      { label: 'TERLAMBAT KEMBALI', value: String(lateCount), rgb: [225, 29, 72] as [number, number, number] },
    ];

    const gap = 3.5;
    const cardW = (pageW - marginX * 2 - gap * (kpis.length - 1)) / kpis.length;
    const cardY = 35.5;
    const cardH = 14.5;

    kpis.forEach((kpi, idx) => {
      const cx = marginX + idx * (cardW + gap);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.25);
      doc.roundedRect(cx, cardY, cardW, cardH, 1.6, 1.6, 'FD');

      doc.setFillColor(...kpi.rgb);
      doc.rect(cx, cardY, 1.8, cardH, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.2);
      doc.setTextColor(100, 116, 139);
      doc.text(kpi.label, cx + 4, cardY + 5);

      doc.setFont('courier', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...kpi.rgb);
      doc.text(kpi.value, cx + 4, cardY + 11.6);
    });

    let nextY = cardY + cardH + 4;

    // Optional Period Breakdown Summary strip
    const nonEmptyBreakdown = periodBreakdown.filter((b) => b.total > 0).slice(0, 8);
    if (nonEmptyBreakdown.length > 0) {
      doc.setFillColor(241, 245, 249);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(marginX, nextY, pageW - marginX * 2, 10.5, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(30, 41, 59);
      doc.text('RINGKASAN KATEGORI PERIODE:', marginX + 3.5, nextY + 4.2);

      const summaryText = nonEmptyBreakdown
        .map(
          (b) =>
            `${b.label}: ${b.total} transaksi (Harian ${b.harian}, Pulang ${b.pulang}, Telat ${b.late})`
        )
        .join('   |   ');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(71, 85, 105);
      doc.text(truncateText(doc, summaryText, pageW - marginX * 2 - 7), marginX + 3.5, nextY + 8.3);

      nextY += 13.5;
    }

    return nextY;
  };

  // Table column definitions (total width = 273 mm)
  const columns = [
    { header: 'NO', width: 9 },
    { header: 'WAKTU AMBIL', width: 31 },
    { header: 'WAKTU KEMBALI', width: 31 },
    { header: 'KODE & NAMA SISWA', width: 52 },
    { header: 'KELAS / WIL', width: 24 },
    { header: 'TAS LAPTOP', width: 33 },
    { header: 'JENIS & SESI / KEPERLUAN', width: 45 },
    { header: 'STATUS', width: 24 },
    { header: 'GURU PIKET', width: 24 },
  ];

  const drawTableHeader = (y: number) => {
    doc.setFillColor(30, 41, 59);
    doc.rect(marginX, y, pageW - marginX * 2, 7.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.8);
    doc.setTextColor(255, 255, 255);

    let colX = marginX;
    columns.forEach((col) => {
      doc.text(col.header, colX + 2, y + 5.1);
      colX += col.width;
    });

    return y + 7.5;
  };

  let curY = drawReportHeader(true);
  curY = drawTableHeader(curY);
  const rowH = 8.2;
  const maxY = pageH - 14;

  if (transactions.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(marginX, curY, pageW - marginX * 2, 16, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Tidak ada data transaksi pemakaian laptop pada periode laporan yang dipilih.',
      pageW / 2,
      curY + 9.5,
      { align: 'center' }
    );
  } else {
    transactions.forEach((tx, index) => {
      if (curY + rowH > maxY) {
        doc.addPage('a4', 'landscape');
        curY = drawReportHeader(false);
        curY = drawTableHeader(curY);
      }

      const st = studentMap.get(tx.student_id);
      const lp = laptopMap.get(tx.laptop_id);

      if (index % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(marginX, curY, pageW - marginX * 2, rowH, 'F');
      }

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.15);
      doc.line(marginX, curY + rowH, pageW - marginX, curY + rowH);

      const studentLabel = st ? `${st.student_code} · ${st.name}` : 'Siswa Terhapus';
      const classWilLabel = `${st?.class || '—'} · ${WILAYAH_LABELS[tx.wilayah].replace('Wilayah ', '')}`;
      const laptopLabel = lp ? `${lp.asset_code} (${lp.brand_model})` : '—';
      const sessionDetail =
        tx.custom_activity || tx.home_note
          ? `${tx.purpose} (${tx.custom_activity || tx.home_note})`
          : tx.purpose;
      const statusText =
        tx.status === 'active'
          ? tx.transaction_type === 'pulang'
            ? 'Dibawa Pulang'
            : 'Masih Dipakai'
          : tx.is_late
          ? `Telat ${tx.late_minutes}m`
          : 'Tepat Waktu';
      const returnText = tx.return_time
        ? formatDateTimeID(tx.return_time)
        : tx.transaction_type === 'pulang'
        ? `Batas ${formatDateOnly(tx.due_time)}`
        : 'Belum Kembali';
      const piketLabel = tx.return_piket_name
        ? `${tx.piket_name} / ${tx.return_piket_name}`
        : tx.piket_name;

      const rowValues = [
        String(index + 1),
        formatDateTimeID(tx.borrow_time),
        returnText,
        studentLabel,
        classWilLabel,
        laptopLabel,
        sessionDetail,
        statusText,
        piketLabel,
      ];

      let colX = marginX;
      rowValues.forEach((val, colIdx) => {
        const colW = columns[colIdx].width;
        doc.setFont(colIdx === 0 || colIdx === 5 ? 'courier' : 'helvetica', colIdx === 3 || colIdx === 7 ? 'bold' : 'normal');
        doc.setFontSize(6.6);
        if (colIdx === 7) {
          if (tx.status === 'active') {
            doc.setTextColor(180, 83, 9);
          } else if (tx.is_late) {
            doc.setTextColor(190, 18, 60);
          } else {
            doc.setTextColor(4, 120, 87);
          }
        } else {
          doc.setTextColor(15, 23, 42);
        }
        doc.text(truncateText(doc, val, colW - 3.5), colX + 2, curY + 5.3);
        colX += colW;
      });

      curY += rowH;
    });
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${categoryTitleMap[periodType]} — ${periodLabel} · ${schoolName}`,
      marginX,
      pageH - 5.5
    );
    doc.text(`Halaman ${p} dari ${totalPages}`, pageW - marginX, pageH - 5.5, {
      align: 'right',
    });
  }

  const safePeriod = periodLabel.replace(/[^a-zA-Z0-9_-]+/g, '-');
  doc.save(`Laporan-Pemakaian-${periodType.toUpperCase()}-${safePeriod}.pdf`);
}

