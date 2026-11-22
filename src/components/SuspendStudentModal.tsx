import { FormEvent, useState } from 'react';
import { Ban, CalendarClock, Loader2, X } from 'lucide-react';
import { Student, WILAYAH_LABELS } from '../types/models';
import { formatDateOnly, getDefaultReturnDateInput } from '../lib/store';

interface SuspendStudentModalProps {
  student: Student;
  onClose: () => void;
  onConfirmSuspend: (
    studentId: string,
    payload: { suspended_until: string; reason: string }
  ) => Promise<void>;
}

export function SuspendStudentModal({
  student,
  onClose,
  onConfirmSuspend,
}: SuspendStudentModalProps) {
  const initialDate = (() => {
    if (student.suspended_until) {
      const d = new Date(student.suspended_until);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    return getDefaultReturnDateInput(7);
  })();

  const [untilDate, setUntilDate] = useState<string>(initialDate);
  const [reason, setReason] = useState<string>(
    student.suspended_reason ||
      (student.late_count > 0
        ? `Terlambat mengembalikan laptop (${student.late_count}×)`
        : 'Pelanggaran tata tertib peminjaman laptop')
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPresetDays = (days: number) => {
    setUntilDate(getDefaultReturnDateInput(days));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!untilDate) {
      setError('Pilih tanggal batas akhir suspend.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirmSuspend(student.id, {
        suspended_until: untilDate,
        reason: reason.trim() || 'Disuspend oleh Administrator',
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan status suspend.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-rose-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Colorful Header */}
        <div className="flex items-center justify-between bg-gradient-to-r from-rose-600 via-red-600 to-amber-600 px-5 py-4 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">
              <Ban className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold tracking-tight">
                Atur Suspend Peminjaman Siswa
              </h3>
              <p className="text-[11px] text-rose-100">
                Tentukan batas waktu suspend sampai kapan
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {/* Student Summary Box */}
          <div className="rounded-xl border border-rose-100 bg-rose-50/70 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono font-bold text-rose-700">{student.student_code}</span>
              <span className="font-semibold text-slate-600">
                {WILAYAH_LABELS[student.wilayah]}
              </span>
            </div>
            <p className="mt-0.5 text-sm font-extrabold text-slate-900">{student.name}</p>
            <p className="text-xs text-slate-600">
              Kelas {student.class} · Catatan Terlambat: {student.late_count} kali
            </p>
          </div>

          {/* Quick Duration Buttons */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Pilih Cepat Durasi Suspend
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: '3 Hari', days: 3 },
                { label: '7 Hari', days: 7 },
                { label: '14 Hari', days: 14 },
                { label: '30 Hari', days: 30 },
              ].map((preset) => {
                const target = getDefaultReturnDateInput(preset.days);
                const active = untilDate === target;
                return (
                  <button
                    key={preset.days}
                    type="button"
                    onClick={() => applyPresetDays(preset.days)}
                    className={`rounded-lg border py-2 text-xs font-bold transition-all ${
                      active
                        ? 'border-rose-600 bg-rose-600 text-white shadow-xs'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-rose-300 hover:bg-rose-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Date Input */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <CalendarClock className="h-3.5 w-3.5 text-rose-600" />
              Suspend Sampai Tanggal
            </label>
            <input
              required
              type="date"
              min={getDefaultReturnDateInput(1)}
              value={untilDate}
              onChange={(e) => setUntilDate(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 font-mono text-sm font-semibold text-slate-900 outline-none focus:border-rose-600"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Siswa tidak dapat meminjam laptop sampai{' '}
              <strong className="font-mono text-rose-700">
                {formatDateOnly(`${untilDate}T23:59:59`)}
              </strong>{' '}
              pukul 23:59.
            </p>
          </div>

          {/* Reason Input */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700">
              Alasan / Keterangan Suspend
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Terlambat mengembalikan laptop sesi malam"
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs text-slate-900 outline-none focus:border-rose-600"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-all hover:from-rose-700 hover:to-red-700 disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Ban className="h-4 w-4" />
              )}
              Simpan Suspend Siswa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
