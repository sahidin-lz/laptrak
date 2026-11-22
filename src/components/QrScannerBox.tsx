import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { Camera, CameraOff, RefreshCw } from 'lucide-react';

interface QrScannerBoxProps {
  onScan: (decodedText: string) => void;
  paused?: boolean;
}

const CAMERA_AUTH_SESSION_KEY = 'laptrack_camera_authorized_v1';
let sessionCameraAuthorized = false;

function isCameraAuthorizedInSession(): boolean {
  if (sessionCameraAuthorized) return true;
  try {
    return window.sessionStorage.getItem(CAMERA_AUTH_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

function setCameraAuthorizedInSession(authorized: boolean): void {
  sessionCameraAuthorized = authorized;
  try {
    if (authorized) {
      window.sessionStorage.setItem(CAMERA_AUTH_SESSION_KEY, '1');
    } else {
      window.sessionStorage.removeItem(CAMERA_AUTH_SESSION_KEY);
    }
  } catch {
    // Ignore sessionStorage errors
  }
}

export function QrScannerBox({ onScan, paused = false }: QrScannerBoxProps) {
  const containerId = 'laptrack-camera-scanner';
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  const mountedRef = useRef(true);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(() => isCameraAuthorizedInSession());

  pausedRef.current = paused;
  onScanRef.current = onScan;

  const stopCamera = async (revokeSessionAuth = false) => {
    if (revokeSessionAuth) {
      setCameraAuthorizedInSession(false);
    }
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
    if (mountedRef.current) {
      setCameraActive(false);
    }
  };

  const startCamera = async () => {
    if (mountedRef.current) {
      setStarting(true);
      setCameraError(null);
    }
    await stopCamera(false);

    try {
      const scanner = new Html5Qrcode(containerId, {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.EAN_13,
        ],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 240, height: 180 },
          aspectRatio: 1.333,
        },
        (decodedText) => {
          if (pausedRef.current) return;
          const now = Date.now();
          const cleaned = decodedText.trim().toUpperCase();
          if (
            cleaned === lastScanRef.current.text &&
            now - lastScanRef.current.time < 2200
          ) {
            return;
          }
          lastScanRef.current = { text: cleaned, time: now };
          onScanRef.current(cleaned);
        },
        () => {
          // Frame decode misses are normal
        }
      );

      setCameraAuthorizedInSession(true);
      if (mountedRef.current) {
        setCameraActive(true);
      }
    } catch {
      setCameraAuthorizedInSession(false);
      if (mountedRef.current) {
        setCameraError(
          'Kamera tidak tersedia atau izin ditolak. Gunakan scanner barcode USB atau input kode manual di bawah.'
        );
        setCameraActive(false);
      }
    } finally {
      if (mountedRef.current) {
        setStarting(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    if (isCameraAuthorizedInSession()) {
      const timer = window.setTimeout(() => {
        if (mountedRef.current) {
          void startCamera();
        }
      }, 60);
      return () => {
        mountedRef.current = false;
        window.clearTimeout(timer);
        void stopCamera(false);
      };
    }
    return () => {
      mountedRef.current = false;
      void stopCamera(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
      <div className="relative flex min-h-[260px] flex-col items-center justify-center">
        <div id={containerId} className="w-full" />

        {!cameraActive && starting && (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <RefreshCw className="mb-3 h-7 w-7 animate-spin text-blue-400" />
            <p className="text-sm font-semibold text-white">
              Menghubungkan Kamera Pemindai...
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Kamera otomatis aktif selama halaman web belum ditutup.
            </p>
          </div>
        )}

        {!cameraActive && !starting && (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-slate-300">
              {cameraError ? <CameraOff className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
            </div>
            <p className="text-sm font-semibold text-white">
              Pemindai Kamera QR &amp; Barcode 1D
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
              {cameraError ||
                'Aktifkan kamera satu kali di awal untuk memindai QR Kartu Siswa maupun Barcode Gantungan Tas.'}
            </p>
            <button
              type="button"
              onClick={startCamera}
              disabled={starting}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              <Camera className="h-3.5 w-3.5" />
              Aktifkan Kamera
            </button>
          </div>
        )}
      </div>

      {cameraActive && (
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900 px-4 py-2.5">
          <span className="text-xs font-medium text-slate-300">
            Arahkan QR atau Barcode ke kotak pemindai
          </span>
          <button
            type="button"
            onClick={() => stopCamera(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700"
          >
            <CameraOff className="h-3.5 w-3.5" />
            Matikan
          </button>
        </div>
      )}
    </div>
  );
}
