import { useState } from 'react';
import { Download, FileImage, Loader2, X } from 'lucide-react';
import { Laptop, PrintSettings, Student } from '../types/models';
import { BagHangTagPreview, StudentCardPreview } from './CardPreview';
import { exportBagTagsPdf, exportStudentCardsPdf } from '../lib/pdfGenerator';
import { generateStudentOrLaptopCardPngDataUrl } from '../lib/barcode';

interface CodePreviewModalProps {
  mode: 'student' | 'laptop';
  student?: Student;
  laptop?: Laptop;
  allStudents: Student[];
  allLaptops: Laptop[];
  settings: PrintSettings;
  onClose: () => void;
}

export function CodePreviewModal({
  mode,
  student,
  laptop,
  allStudents,
  allLaptops,
  settings,
  onClose,
}: CodePreviewModalProps) {
  const [exporting, setExporting] = useState(false);
  const [exportingPng, setExportingPng] = useState(false);

  const assignedLaptop =
    mode === 'student' && student
      ? allLaptops.find((l) => l.assigned_student_id === student.id)
      : laptop;

  const ownerStudent =
    mode === 'laptop' && laptop
      ? allStudents.find((s) => s.id === laptop.assigned_student_id)
      : student;

  const handleDownloadSinglePdf = async () => {
    setExporting(true);
    try {
      if (mode === 'student' && student) {
        await exportStudentCardsPdf([student], allLaptops, settings);
      } else if (mode === 'laptop' && laptop) {
        await exportBagTagsPdf([laptop], allStudents, settings);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadSinglePng = async () => {
    setExportingPng(true);
    try {
      const dataUrl = await generateStudentOrLaptopCardPngDataUrl({
        mode,
        student: ownerStudent,
        laptop: assignedLaptop,
        schoolName: settings.schoolName,
        academicYear: settings.academicYear,
      });
      if (!dataUrl) return;
      const link = document.createElement('a');
      link.href = dataUrl;
      if (mode === 'student' && student) {
        link.download = `kartu-siswa-${student.student_code}-${student.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')}.png`;
      } else if (mode === 'laptop' && laptop) {
        link.download = `gantungan-tas-${laptop.asset_code}.png`;
      }
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      setExportingPng(false);
    }
  };

  const title =
    mode === 'student' && student
      ? `Kartu Siswa — ${student.name}`
      : mode === 'laptop' && laptop
      ? `Gantungan Barcode Tas — ${laptop.asset_code}`
      : 'Pratinjau Cetak';

  const subtitle =
    mode === 'student' && student
      ? `${student.student_code} · Kelas ${student.class}`
      : mode === 'laptop' && laptop
      ? `${laptop.brand_model}`
      : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center bg-slate-50/80 px-6 py-7">
          {mode === 'student' && student && (
            <StudentCardPreview
              student={student}
              assignedLaptop={assignedLaptop}
              settings={settings}
            />
          )}
          {mode === 'laptop' && laptop && (
            <BagHangTagPreview
              laptop={laptop}
              owner={ownerStudent}
              settings={settings}
            />
          )}
          <p className="mt-4 text-center text-xs text-slate-500">
            Siap dipindai menggunakan kamera QR maupun scanner barcode 1D (Code-128).
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-slate-200 bg-white px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Tutup
          </button>
          <button
            type="button"
            onClick={handleDownloadSinglePng}
            disabled={exportingPng}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-60"
          >
            {exportingPng ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileImage className="h-4 w-4" />
            )}
            Unduh PNG ({mode === 'student' ? 'Kartu' : 'Gantungan'})
          </button>
          <button
            type="button"
            onClick={handleDownloadSinglePdf}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Unduh PDF ({mode === 'student' ? 'Kartu' : 'Gantungan'})
          </button>
        </div>
      </div>
    </div>
  );
}
