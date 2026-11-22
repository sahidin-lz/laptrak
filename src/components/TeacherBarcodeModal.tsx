import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileImage,
  Layers,
  Loader2,
  QrCode,
  ScanLine,
  Shield,
  UserCheck,
  X,
} from 'lucide-react';
import { PiketOption, WILAYAH_LABELS } from '../types/models';
import {
  generateAllStaffCardsSheetPngDataUrl,
  generateStaffCardPngDataUrl,
} from '../lib/barcode';

interface TeacherBarcodeModalProps {
  piketOptions: PiketOption[];
  initialPiketId?: string;
  schoolName?: string;
  onSelectScanNow?: (barcode: string) => void;
  onClose: () => void;
}

export function TeacherBarcodeModal({
  piketOptions,
  initialPiketId,
  schoolName = 'SMA NEGERI 1 NUSANTARA',
  onSelectScanNow,
  onClose,
}: TeacherBarcodeModalProps) {
  const [selectedId, setSelectedId] = useState<string>(
    initialPiketId || piketOptions[0]?.id || ''
  );
  const [cardPngUrl, setCardPngUrl] = useState<string>('');
  const [generatingCard, setGeneratingCard] = useState<boolean>(true);
  const [downloadingBatch, setDownloadingBatch] = useState<'sheet' | 'individual' | null>(null);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  const selectedPiket =
    piketOptions.find((p) => p.id === selectedId) || piketOptions[0] || null;
  const tokenCode = selectedPiket?.demo_token || 'PKT-201';

  useEffect(() => {
    if (!selectedPiket) return;
    let active = true;
    setGeneratingCard(true);
    generateStaffCardPngDataUrl(selectedPiket, schoolName).then((url) => {
      if (active) {
        setCardPngUrl(url);
        setGeneratingCard(false);
      }
    });
    return () => {
      active = false;
    };
  }, [selectedPiket, schoolName]);

  const triggerDownload = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadSingleCardPng = async () => {
    if (!selectedPiket) return;
    const url = cardPngUrl || (await generateStaffCardPngDataUrl(selectedPiket, schoolName));
    if (!url) return;
    const roleSlug = selectedPiket.role === 'admin' ? 'admin' : 'guru-piket';
    const cleanName = selectedPiket.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    triggerDownload(
      url,
      `kartu-${roleSlug}-${selectedPiket.demo_token || selectedPiket.id}-${cleanName}.png`
    );
    setDownloadMsg(`Kartu PNG ${selectedPiket.name} (${tokenCode}) berhasil diunduh.`);
  };

  const handleDownloadAllSheetPng = async () => {
    if (piketOptions.length === 0) return;
    setDownloadingBatch('sheet');
    setDownloadMsg(null);
    try {
      const sheetUrl = await generateAllStaffCardsSheetPngDataUrl(piketOptions, schoolName);
      if (sheetUrl) {
        triggerDownload(sheetUrl, `lembar-semua-kartu-guru-dan-admin-${piketOptions.length}-kartu.png`);
        setDownloadMsg(
          `Lembar Gabungan (${piketOptions.length} Kartu Guru & Admin) resolusi tinggi berhasil diunduh.`
        );
      }
    } finally {
      setDownloadingBatch(null);
    }
  };

  const handleDownloadAllIndividualPngs = async () => {
    if (piketOptions.length === 0) return;
    setDownloadingBatch('individual');
    setDownloadMsg(null);
    try {
      for (let i = 0; i < piketOptions.length; i++) {
        const p = piketOptions[i];
        const url = await generateStaffCardPngDataUrl(p, schoolName);
        if (url) {
          const roleSlug = p.role === 'admin' ? 'admin' : 'guru-piket';
          const cleanName = p.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          triggerDownload(url, `kartu-${roleSlug}-${p.demo_token || p.id}-${cleanName}.png`);
          // Brief pause so browser allows multiple sequential file downloads
          await new Promise((r) => setTimeout(r, 240));
        }
      }
      setDownloadMsg(
        `Berhasil mengunduh ${piketOptions.length} file PNG kartu Guru Piket & Admin satu per satu.`
      );
    } finally {
      setDownloadingBatch(null);
    }
  };

  if (!selectedPiket) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold">
                Studio Kartu Barcode Login Guru Piket &amp; Administrator (.PNG)
              </h3>
              <p className="text-[11px] text-slate-300">
                Desain ID Card CR80 Resolusi Tinggi lengkap dengan Nama, Jabatan, Wilayah, QR &amp; Barcode 1D
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
          {/* Teacher / Admin Selector + Role indicator */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-8">
              <label className="mb-1.5 block text-xs font-extrabold text-slate-700">
                Pilih Guru Piket atau Administrator ({piketOptions.length} Akun Terdaftar)
              </label>
              <select
                value={selectedPiket.id}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setDownloadMsg(null);
                }}
                className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-extrabold text-slate-900 outline-none focus:border-indigo-600 focus:bg-white"
              >
                {piketOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.role === 'admin' ? 'ADMIN' : 'GURU PIKET'}] {p.demo_token} — {p.name} (
                    {WILAYAH_LABELS[p.wilayah]})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-4">
              <div
                className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-extrabold ${
                  selectedPiket.role === 'admin'
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-800'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {selectedPiket.role === 'admin' ? (
                  <>
                    <Shield className="h-4 w-4 text-indigo-600" />
                    Kartu Administrator
                  </>
                ) : (
                  <>
                    <UserCheck className="h-4 w-4 text-emerald-600" />
                    Kartu Guru Piket
                  </>
                )}
              </div>
            </div>
          </div>

          {/* High-Res Full PNG Card Preview */}
          <div className="rounded-2xl border border-slate-200 bg-slate-100/90 p-4 text-center">
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold text-slate-500">
              <span>PRATINJAU HASIL UNDUH PNG (1000 × 630 PX · SIAP CETAK ID CARD)</span>
              <span className="font-mono font-extrabold text-slate-800">
                Token: {tokenCode}
              </span>
            </div>

            {generatingCard || !cardPngUrl ? (
              <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-500">
                <Loader2 className="mb-2 h-6 w-6 animate-spin text-indigo-600" />
                Menyusun Desain Kartu Resolusi Tinggi...
              </div>
            ) : (
              <img
                src={cardPngUrl}
                alt={`Kartu Barcode Login ${selectedPiket.name}`}
                className="mx-auto w-full max-w-[540px] rounded-xl shadow-md ring-1 ring-slate-900/10"
              />
            )}
          </div>

          {downloadMsg && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-bold text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{downloadMsg}</span>
            </div>
          )}

          {/* Download Action Buttons: Single PNG, All Sheet PNG, All Individual PNGs */}
          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-3.5">
            <p className="mb-2.5 text-[11px] font-extrabold tracking-wide text-indigo-950 uppercase">
              Pilihan Unduh Kartu PNG Guru Piket &amp; Admin
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={handleDownloadSingleCardPng}
                disabled={generatingCard}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs transition-all hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50"
              >
                <Download className="h-4 w-4 shrink-0" />
                <span>Unduh Kartu Ini (.png)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadAllSheetPng}
                disabled={downloadingBatch !== null}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-extrabold text-white shadow-xs transition-all hover:from-emerald-700 hover:to-teal-700 disabled:opacity-50"
                title="Unduh 1 lembar poster PNG berisi seluruh kartu Guru Piket & Admin siap cetak"
              >
                {downloadingBatch === 'sheet' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Layers className="h-4 w-4 shrink-0" />
                )}
                <span>Lembar Semua ({piketOptions.length} Kartu .png)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadAllIndividualPngs}
                disabled={downloadingBatch !== null}
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-indigo-300 bg-white px-3.5 py-2 text-xs font-extrabold text-indigo-800 shadow-2xs transition-colors hover:bg-indigo-50 disabled:opacity-50"
                title="Unduh semua file PNG kartu Guru Piket & Admin satu per satu"
              >
                {downloadingBatch === 'individual' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <FileImage className="h-4 w-4 shrink-0" />
                )}
                <span>Semua File Satu-Satu (.png)</span>
              </button>
            </div>
          </div>

          {onSelectScanNow && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => {
                  onSelectScanNow(tokenCode);
                  onClose();
                }}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-extrabold text-white hover:bg-slate-800"
              >
                <ScanLine className="h-4 w-4 text-amber-400" />
                Gunakan Barcode Ini Sekarang
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
