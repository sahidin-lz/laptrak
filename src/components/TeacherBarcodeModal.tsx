import { useEffect, useState } from 'react';
import { Download, QrCode, ScanLine, Shield, UserCheck, X } from 'lucide-react';
import { PiketOption, WILAYAH_LABELS } from '../types/models';
import { generateBarcodeDataUrl, generateQrDataUrl } from '../lib/barcode';

interface TeacherBarcodeModalProps {
  piketOptions: PiketOption[];
  initialPiketId?: string;
  onSelectScanNow?: (barcode: string) => void;
  onClose: () => void;
}

export function TeacherBarcodeModal({
  piketOptions,
  initialPiketId,
  onSelectScanNow,
  onClose,
}: TeacherBarcodeModalProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialPiketId || piketOptions[0]?.id || ''
  );
  const [qrUrl, setQrUrl] = useState<string>('');
  const [barcodeUrl, setBarcodeUrl] = useState<string>('');

  const selectedPiket =
    piketOptions.find((p) => p.id === selectedId) || piketOptions[0] || null;
  const tokenCode = selectedPiket?.demo_token || 'PKT-201';

  useEffect(() => {
    let active = true;
    setBarcodeUrl(
      generateBarcodeDataUrl(tokenCode, {
        height: 60,
        width: 2.2,
        fontSize: 15,
      })
    );
    generateQrDataUrl(tokenCode, 220).then((url) => {
      if (active) setQrUrl(url);
    });
    return () => {
      active = false;
    };
  }, [tokenCode]);

  const handleDownloadPng = () => {
    if (!barcodeUrl || !selectedPiket) return;
    const link = document.createElement('a');
    link.href = barcodeUrl;
    link.download = `barcode-login-${selectedPiket.demo_token || selectedPiket.id}.png`;
    link.click();
  };

  if (!selectedPiket) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <QrCode className="h-5 w-5 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold">Kartu Barcode Login Guru Piket</h3>
              <p className="text-[11px] text-slate-300">
                Scan barcode ini di halaman awal untuk langsung masuk Tiket Sesi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Teacher Selector */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Pilih Nama Guru Piket / Petugas
            </label>
            <select
              value={selectedPiket.id}
              onChange={(e) => setSelectedId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-900 outline-none focus:border-blue-600 focus:bg-white"
            >
              {piketOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.demo_token} — {p.name} ({WILAYAH_LABELS[p.wilayah]})
                </option>
              ))}
            </select>
          </div>

          {/* Printable / Scannable Card Preview */}
          <div className="overflow-hidden rounded-2xl border-2 border-slate-900 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-amber-300 uppercase">
                  Tiket Barcode Login Guru Piket
                </p>
                <p className="text-sm font-extrabold">{selectedPiket.name}</p>
              </div>
              <span className="font-mono text-xs font-bold text-slate-200">
                {WILAYAH_LABELS[selectedPiket.wilayah]}
              </span>
            </div>

            <div className="grid grid-cols-1 items-center gap-4 p-5 sm:grid-cols-12">
              <div className="flex flex-col items-center justify-center sm:col-span-5">
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt={`QR Login ${selectedPiket.name}`}
                    className="h-36 w-36 rounded-xl border border-slate-200 p-1.5"
                  />
                ) : (
                  <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-400">
                    Memuat QR...
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center justify-center space-y-2 sm:col-span-7">
                {barcodeUrl && (
                  <img
                    src={barcodeUrl}
                    alt={`Barcode Login ${tokenCode}`}
                    className="max-h-20 w-full object-contain"
                  />
                )}
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-600">
                    {selectedPiket.role === 'admin' ? (
                      <span className="inline-flex items-center gap-1 text-blue-700">
                        <Shield className="h-3.5 w-3.5" />
                        Administrator
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <UserCheck className="h-3.5 w-3.5" />
                        Guru Piket Aktif
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-xs font-bold text-slate-900">
                    Kode Barcode: {tokenCode}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleDownloadPng}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Unduh Barcode (.png)
            </button>

            {onSelectScanNow && (
              <button
                type="button"
                onClick={() => {
                  onSelectScanNow(tokenCode);
                  onClose();
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800"
              >
                <ScanLine className="h-4 w-4" />
                Gunakan Barcode Ini Sekarang
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
