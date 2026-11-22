import { useMemo, useState } from 'react';
import {
  CheckSquare,
  CreditCard,
  Download,
  FileStack,
  Loader2,
  Search,
  Square,
  Tag,
} from 'lucide-react';
import {
  CARD_THEMES,
  CardThemeKey,
  Laptop,
  PrintSettings,
  Student,
} from '../types/models';
import { BagHangTagPreview, StudentCardPreview } from './CardPreview';
import {
  exportBagTagsPdf,
  exportCombinedBundlePdf,
  exportStudentCardsPdf,
} from '../lib/pdfGenerator';

type PrintMode = 'cards' | 'tags' | 'bundle';

interface PrintStudioViewProps {
  students: Student[];
  laptops: Laptop[];
  settings: PrintSettings;
  onUpdateSettings: (patch: Partial<PrintSettings>) => void;
}

export function PrintStudioView({
  students,
  laptops,
  settings,
  onUpdateSettings,
}: PrintStudioViewProps) {
  const [mode, setMode] = useState<PrintMode>('tags');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [wilayahFilter, setWilayahFilter] = useState<'ALL' | 'putra' | 'putri'>('ALL');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(() =>
    students.map((s) => s.id)
  );
  const [selectedLaptopIds, setSelectedLaptopIds] = useState<string[]>(() =>
    laptops.map((l) => l.id)
  );
  const [exporting, setExporting] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const studentMap = useMemo(
    () => new Map(students.map((s) => [s.id, s])),
    [students]
  );
  const laptopByStudentMap = useMemo(() => {
    const m = new Map<string, Laptop>();
    laptops.forEach((l) => {
      if (l.assigned_student_id) m.set(l.assigned_student_id, l);
    });
    return m;
  }, [laptops]);

  // Keep selections synced if new records are added
  const validSelectedStudentIds = useMemo(
    () => selectedStudentIds.filter((id) => studentMap.has(id)),
    [selectedStudentIds, studentMap]
  );
  const laptopIdsSet = useMemo(() => new Set(laptops.map((l) => l.id)), [laptops]);
  const validSelectedLaptopIds = useMemo(
    () => selectedLaptopIds.filter((id) => laptopIdsSet.has(id)),
    [selectedLaptopIds, laptopIdsSet]
  );

  // Filter lists
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (wilayahFilter !== 'ALL' && s.wilayah !== wilayahFilter) return false;
      if (classFilter !== 'ALL' && !s.class.toUpperCase().startsWith(classFilter)) {
        return false;
      }
      if (!q) return true;
      const lap = laptopByStudentMap.get(s.id);
      return (
        s.name.toLowerCase().includes(q) ||
        s.student_code.toLowerCase().includes(q) ||
        s.class.toLowerCase().includes(q) ||
        (lap?.asset_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [students, search, classFilter, wilayahFilter, laptopByStudentMap]);

  const filteredLaptops = useMemo(() => {
    const q = search.trim().toLowerCase();
    return laptops.filter((l) => {
      const owner = l.assigned_student_id ? studentMap.get(l.assigned_student_id) : undefined;
      if (wilayahFilter !== 'ALL') {
        if (!owner || owner.wilayah !== wilayahFilter) return false;
      }
      if (classFilter !== 'ALL') {
        if (!owner || !owner.class.toUpperCase().startsWith(classFilter)) return false;
      }
      if (!q) return true;
      return (
        l.asset_code.toLowerCase().includes(q) ||
        l.brand_model.toLowerCase().includes(q) ||
        (owner?.name.toLowerCase().includes(q) ?? false) ||
        (owner?.student_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [laptops, search, classFilter, wilayahFilter, studentMap]);

  const selectedStudents = useMemo(
    () => students.filter((s) => validSelectedStudentIds.includes(s.id)),
    [students, validSelectedStudentIds]
  );
  const selectedLaptops = useMemo(
    () => laptops.filter((l) => validSelectedLaptopIds.includes(l.id)),
    [laptops, validSelectedLaptopIds]
  );

  const toggleStudent = (id: string) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleLaptop = (id: string) => {
    setSelectedLaptopIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllFiltered = () => {
    if (mode === 'tags') {
      const ids = filteredLaptops.map((l) => l.id);
      const allSelected = ids.every((id) => validSelectedLaptopIds.includes(id));
      if (allSelected) {
        setSelectedLaptopIds((prev) => prev.filter((id) => !ids.includes(id)));
      } else {
        setSelectedLaptopIds((prev) => Array.from(new Set([...prev, ...ids])));
      }
    } else {
      const sIds = filteredStudents.map((s) => s.id);
      const allSelected = sIds.every((id) => validSelectedStudentIds.includes(id));
      if (allSelected) {
        setSelectedStudentIds((prev) => prev.filter((id) => !sIds.includes(id)));
        if (mode === 'bundle') {
          const linkedLapIds = sIds
            .map((id) => laptopByStudentMap.get(id)?.id)
            .filter(Boolean) as string[];
          setSelectedLaptopIds((prev) => prev.filter((id) => !linkedLapIds.includes(id)));
        }
      } else {
        setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...sIds])));
        if (mode === 'bundle') {
          const linkedLapIds = sIds
            .map((id) => laptopByStudentMap.get(id)?.id)
            .filter(Boolean) as string[];
          setSelectedLaptopIds((prev) => Array.from(new Set([...prev, ...linkedLapIds])));
        }
      }
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    setExportSuccessMsg(null);
    try {
      if (mode === 'cards') {
        await exportStudentCardsPdf(selectedStudents, laptops, settings);
        setExportSuccessMsg(
          `PDF Kartu Siswa (${selectedStudents.length} kartu) berhasil diunduh.`
        );
      } else if (mode === 'tags') {
        await exportBagTagsPdf(selectedLaptops, students, settings);
        setExportSuccessMsg(
          `PDF Gantungan Barcode Tas (${selectedLaptops.length} unit) berhasil diunduh.`
        );
      } else {
        await exportCombinedBundlePdf(
          selectedStudents,
          selectedLaptops,
          students,
          laptops,
          settings
        );
        setExportSuccessMsg(
          `PDF Paket Lengkap (${selectedStudents.length} kartu + ${selectedLaptops.length} gantungan) berhasil diunduh.`
        );
      }
    } finally {
      setExporting(false);
    }
  };

  // Layout math info for operator
  const cardPerPage = settings.cardOrientation === 'landscape' ? 8 : 9;
  const tagPerPage = settings.bagTagStyle === 'foldable' ? 3 : 6;
  const cardPages = Math.ceil(selectedStudents.length / cardPerPage);
  const tagPages = Math.ceil(selectedLaptops.length / tagPerPage);

  const exportCount =
    mode === 'cards'
      ? selectedStudents.length
      : mode === 'tags'
      ? selectedLaptops.length
      : selectedStudents.length + selectedLaptops.length;

  const totalPagesEstimate =
    mode === 'cards'
      ? cardPages
      : mode === 'tags'
      ? tagPages
      : cardPages + tagPages;

  return (
    <div className="space-y-6">
      {/* Top Mode Bar & Summary Strip */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">
            Studio Cetak Kartu Siswa &amp; Gantungan Barcode Tas
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Atur identitas sekolah, pilih data siswa atau tas laptop, lalu unduh dokumen A4 PDF siap potong &amp; laminating.
          </p>
        </div>

        {/* Segmented Print Mode Control */}
        <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('tags');
              setExportSuccessMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              mode === 'tags'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            Gantungan Tas
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('cards');
              setExportSuccessMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              mode === 'cards'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            Kartu Siswa
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('bundle');
              setExportSuccessMsg(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              mode === 'bundle'
                ? 'bg-white text-blue-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileStack className="h-3.5 w-3.5" />
            Paket Lengkap
          </button>
        </div>
      </div>

      {/* Main 2-Column Studio Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* LEFT COLUMN: Configuration + Selection Checklist */}
        <div className="space-y-5 xl:col-span-4">
          {/* Panel 1: Print Layout & School Identity */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900">Pengaturan Desain PDF</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Diterapkan langsung pada pratinjau dan file A4 PDF.
            </p>

            <div className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  Nama Sekolah / Instansi
                </label>
                <input
                  type="text"
                  value={settings.schoolName}
                  onChange={(e) => onUpdateSettings({ schoolName: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Tahun Ajaran
                  </label>
                  <input
                    type="text"
                    value={settings.academicYear}
                    onChange={(e) => onUpdateSettings({ academicYear: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    Tema Warna
                  </label>
                  <select
                    value={settings.theme}
                    onChange={(e) =>
                      onUpdateSettings({ theme: e.target.value as CardThemeKey })
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-900 outline-none focus:border-blue-600"
                  >
                    {Object.values(CARD_THEMES).map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Format-specific Controls */}
              {(mode === 'cards' || mode === 'bundle') && (
                <div className="border-t border-slate-100 pt-3.5">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Orientasi Kartu Siswa (CR80)
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ cardOrientation: 'landscape' })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        settings.cardOrientation === 'landscape'
                          ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block">Landscape</span>
                      <span className="mt-0.5 block font-mono text-[10px] opacity-75">
                        85.6×54mm · 8/hal
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ cardOrientation: 'portrait' })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        settings.cardOrientation === 'portrait'
                          ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block">Portrait</span>
                      <span className="mt-0.5 block font-mono text-[10px] opacity-75">
                        54×85.6mm · 9/hal
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {(mode === 'tags' || mode === 'bundle') && (
                <div className="border-t border-slate-100 pt-3.5">
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                    Model Gantungan Tas Laptop
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ bagTagStyle: 'single' })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        settings.bagTagStyle === 'single'
                          ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block">1 Sisi (Ringkas)</span>
                      <span className="mt-0.5 block font-mono text-[10px] opacity-75">
                        58×94mm · 6/hal
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateSettings({ bagTagStyle: 'foldable' })}
                      className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        settings.bagTagStyle === 'foldable'
                          ? 'border-blue-600 bg-blue-50/70 font-semibold text-blue-800'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className="block">Lipat 2 Sisi</span>
                      <span className="mt-0.5 block font-mono text-[10px] opacity-75">
                        116×84mm · 3/hal
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Toggle Switches */}
              <div className="space-y-2 border-t border-slate-100 pt-3.5">
                <label className="flex cursor-pointer items-center justify-between text-xs text-slate-700">
                  <span>Garis potong (crop marks A4)</span>
                  <input
                    type="checkbox"
                    checked={settings.showCutGuides}
                    onChange={(e) => onUpdateSettings({ showCutGuides: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                  />
                </label>

                {(mode === 'tags' || mode === 'bundle') && (
                  <>
                    <label className="flex cursor-pointer items-center justify-between text-xs text-slate-700">
                      <span>Tanda lubang tali gantungan (Ø 5mm)</span>
                      <input
                        type="checkbox"
                        checked={settings.showPunchHole}
                        onChange={(e) => onUpdateSettings({ showPunchHole: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                      />
                    </label>
                    {settings.bagTagStyle === 'single' && (
                      <label className="flex cursor-pointer items-center justify-between text-xs text-slate-700">
                        <span>Sertakan QR Code selain Barcode 1D</span>
                        <input
                          type="checkbox"
                          checked={settings.includeQrOnTag}
                          onChange={(e) =>
                            onUpdateSettings({ includeQrOnTag: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                        />
                      </label>
                    )}
                  </>
                )}

                {(mode === 'cards' || mode === 'bundle') && (
                  <label className="flex cursor-pointer items-center justify-between text-xs text-slate-700">
                    <span>Sertakan Barcode 1D di kartu siswa</span>
                    <input
                      type="checkbox"
                      checked={settings.includeBarcodeOnCard}
                      onChange={(e) =>
                        onUpdateSettings({ includeBarcodeOnCard: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 accent-blue-700"
                    />
                  </label>
                )}
              </div>
            </div>
          </section>

          {/* Panel 2: Select Items to Print */}
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                {mode === 'tags' ? 'Pilih Tas Laptop' : 'Pilih Data Siswa'}
              </h3>
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800"
              >
                Pilih / Batal Semua
              </button>
            </div>

            {/* Search, Wilayah & Class Filter */}
            <div className="mt-3 space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama, kode..."
                  className="w-full rounded-lg border border-slate-200 py-1.5 pr-3 pl-8 text-xs text-slate-900 outline-none focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={wilayahFilter}
                  onChange={(e) =>
                    setWilayahFilter(e.target.value as 'ALL' | 'putra' | 'putri')
                  }
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-600"
                >
                  <option value="ALL">Semua Wilayah</option>
                  <option value="putra">Wilayah Putra</option>
                  <option value="putri">Wilayah Putri</option>
                </select>
                <select
                  value={classFilter}
                  onChange={(e) => setClassFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-blue-600"
                >
                  <option value="ALL">Semua Kelas</option>
                  <option value="10">Kelas 10</option>
                  <option value="11">Kelas 11</option>
                  <option value="12">Kelas 12</option>
                </select>
              </div>
            </div>

            {/* Checklist */}
            <div className="mt-3 max-h-[300px] divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {mode === 'tags' ? (
                filteredLaptops.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">
                    Tidak ada laptop sesuai filter.
                  </p>
                ) : (
                  filteredLaptops.map((laptop) => {
                    const checked = validSelectedLaptopIds.includes(laptop.id);
                    const owner = laptop.assigned_student_id
                      ? studentMap.get(laptop.assigned_student_id)
                      : undefined;
                    return (
                      <button
                        key={laptop.id}
                        type="button"
                        onClick={() => toggleLaptop(laptop.id)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                      >
                        {checked ? (
                          <CheckSquare className="h-4 w-4 shrink-0 text-blue-700" />
                        ) : (
                          <Square className="h-4 w-4 shrink-0 text-slate-300" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {laptop.asset_code}
                            </span>
                            <span className="truncate text-[11px] text-slate-500">
                              {owner
                                ? `${owner.class} · ${owner.wilayah === 'putra' ? 'Putra' : 'Putri'}`
                                : 'Belum terpasang'}
                            </span>
                          </div>
                          <p className="truncate text-xs text-slate-600">
                            {owner ? owner.name : 'Tanpa pemilik'} · {laptop.brand_model}
                          </p>
                        </div>
                      </button>
                    );
                  })
                )
              ) : filteredStudents.length === 0 ? (
                <p className="p-4 text-center text-xs text-slate-400">
                  Tidak ada siswa sesuai filter.
                </p>
              ) : (
                filteredStudents.map((student) => {
                  const checked = validSelectedStudentIds.includes(student.id);
                  const assigned = laptopByStudentMap.get(student.id);
                  return (
                    <button
                      key={student.id}
                      type="button"
                      onClick={() => {
                        toggleStudent(student.id);
                        if (mode === 'bundle' && assigned) {
                          toggleLaptop(assigned.id);
                        }
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
                    >
                      {checked ? (
                        <CheckSquare className="h-4 w-4 shrink-0 text-blue-700" />
                      ) : (
                        <Square className="h-4 w-4 shrink-0 text-slate-300" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-bold text-slate-900">
                            {student.name}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] font-semibold text-blue-700">
                            {student.student_code}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-slate-500">
                          Kelas {student.class} · {student.wilayah === 'putra' ? 'Putra' : 'Putri'} ·{' '}
                          {assigned ? `Tas ${assigned.asset_code}` : 'Belum ada laptop'}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN: Live True-to-Scale Preview Canvas + PDF Export CTA */}
        <div className="xl:col-span-8">
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
            {/* Preview Toolbar */}
            <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Pratinjau Cetak A4 Siap Potong
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                  {mode === 'cards' &&
                    `${selectedStudents.length} kartu dipilih · ${cardPerPage} kartu/halaman · ${cardPages} halaman A4`}
                  {mode === 'tags' &&
                    `${selectedLaptops.length} gantungan dipilih · ${tagPerPage} gantungan/halaman · ${tagPages} halaman A4`}
                  {mode === 'bundle' &&
                    `${selectedStudents.length} kartu + ${selectedLaptops.length} gantungan · Estimasi ${totalPagesEstimate} halaman A4`}
                </p>
              </div>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={exporting || exportCount === 0}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting
                  ? 'Menyusun PDF...'
                  : mode === 'cards'
                  ? 'Unduh PDF Kartu Siswa'
                  : mode === 'tags'
                  ? 'Unduh PDF Gantungan Tas'
                  : 'Unduh PDF Paket Lengkap'}
              </button>
            </div>

            {exportSuccessMsg && (
              <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2.5 text-xs font-medium text-emerald-800">
                {exportSuccessMsg}
              </div>
            )}

            {/* Drafting Surface */}
            <div className="flex-1 bg-slate-100/80 p-6">
              {exportCount === 0 ? (
                <div className="flex min-h-[380px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/70 p-8 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    Belum ada item dipilih untuk dicetak
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">
                    Centang minimal satu siswa atau laptop pada daftar di sebelah kiri untuk melihat pratinjau dan mengunduh PDF.
                  </p>
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Section: Bag Hang Tags Preview */}
                  {(mode === 'tags' || mode === 'bundle') && selectedLaptops.length > 0 && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                          Gantungan Barcode Tas Laptop ({selectedLaptops.length} unit)
                        </h4>
                        <span className="text-xs text-slate-500">
                          {settings.bagTagStyle === 'foldable'
                            ? 'Model Lipat 2 Sisi — cetak, lipat tengah, laminating, lubangi atas'
                            : 'Model 1 Sisi — cetak kertas tebal/art carton, laminating, lubangi atas'}
                        </span>
                      </div>
                      <div
                        className={`grid gap-6 ${
                          settings.bagTagStyle === 'foldable'
                            ? 'grid-cols-1'
                            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                        }`}
                      >
                        {selectedLaptops.map((laptop) => (
                          <div key={laptop.id} className="flex flex-col items-center">
                            <BagHangTagPreview
                              laptop={laptop}
                              owner={
                                laptop.assigned_student_id
                                  ? studentMap.get(laptop.assigned_student_id)
                                  : undefined
                              }
                              settings={settings}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section: Student ID Cards Preview */}
                  {(mode === 'cards' || mode === 'bundle') && selectedStudents.length > 0 && (
                    <div
                      className={
                        mode === 'bundle' && selectedLaptops.length > 0
                          ? 'border-t border-slate-200 pt-7'
                          : ''
                      }
                    >
                      <div className="mb-4 flex items-center justify-between">
                        <h4 className="text-xs font-bold tracking-wide text-slate-700 uppercase">
                          Kartu Identitas Siswa ({selectedStudents.length} kartu)
                        </h4>
                        <span className="text-xs text-slate-500">
                          Ukuran standar kartu PVC / ID Card CR80
                        </span>
                      </div>
                      <div
                        className={`grid gap-6 ${
                          settings.cardOrientation === 'landscape'
                            ? 'grid-cols-1 md:grid-cols-2'
                            : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                        }`}
                      >
                        {selectedStudents.map((student) => (
                          <div key={student.id} className="flex flex-col items-center">
                            <StudentCardPreview
                              student={student}
                              assignedLaptop={laptopByStudentMap.get(student.id)}
                              settings={settings}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
