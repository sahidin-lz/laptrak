import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

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
 * Extract 1-2 character initials from a student name.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
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

  // Clean solid institutional surface with subtle radial highlight
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
        // Center-crop square
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
