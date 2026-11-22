import { useEffect, useMemo, useState } from 'react';
import { CARD_THEMES, Laptop, PrintSettings, Student } from '../types/models';
import { generateBarcodeDataUrl, generateQrDataUrl, getInitials } from '../lib/barcode';

function useQrDataUrl(value: string): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let active = true;
    generateQrDataUrl(value, 220).then((res) => {
      if (active) setUrl(res);
    });
    return () => {
      active = false;
    };
  }, [value]);
  return url;
}

interface StudentCardPreviewProps {
  student: Student;
  assignedLaptop?: Laptop;
  settings: PrintSettings;
}

export function StudentCardPreview({
  student,
  assignedLaptop,
  settings,
}: StudentCardPreviewProps) {
  const theme = CARD_THEMES[settings.theme];
  const qrUrl = useQrDataUrl(student.student_code);
  const barcodeUrl = useMemo(
    () =>
      settings.includeBarcodeOnCard
        ? generateBarcodeDataUrl(student.student_code, {
            width: 2,
            height: 44,
            displayValue: true,
            fontSize: 13,
            margin: 2,
          })
        : '',
    [student.student_code, settings.includeBarcodeOnCard]
  );

  const initials = getInitials(student.name);

  if (settings.cardOrientation === 'portrait') {
    return (
      <div className="relative mx-auto w-[216px] overflow-hidden rounded-[10px] border border-slate-300 bg-white shadow-sm select-none">
        {/* Header */}
        <div
          className="px-3 py-2.5 text-center text-white"
          style={{ backgroundColor: theme.primaryHex }}
        >
          <p className="truncate text-[10px] font-bold tracking-wide uppercase">
            {settings.schoolName}
          </p>
          <p className="mt-0.5 text-[8px] text-white/80">
            Kartu Laptop · {settings.academicYear}
          </p>
        </div>
        <div className="h-[3px]" style={{ backgroundColor: theme.accentHex }} />

        {/* Photo */}
        <div className="flex flex-col items-center px-3 pt-3 pb-2.5 text-center">
          <div className="h-[74px] w-[64px] overflow-hidden rounded border border-slate-300 bg-slate-100">
            {student.photo_url ? (
              <img
                src={student.photo_url}
                alt={student.name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-lg font-bold text-white"
                style={{ backgroundColor: theme.primaryHex }}
              >
                {initials}
              </div>
            )}
          </div>

          <h4 className="mt-2 w-full truncate text-[12px] font-bold text-slate-900">
            {student.name}
          </h4>
          <p className="text-[10px] text-slate-500">
            Kelas {student.class} · {student.wilayah === 'putri' ? 'Putri' : 'Putra'}
          </p>
          <p
            className="mt-0.5 font-mono text-[11px] font-bold"
            style={{ color: theme.primaryHex }}
          >
            {student.student_code}
          </p>
          <p
            className="font-mono text-[9px] font-semibold"
            style={{ color: theme.accentHex }}
          >
            {assignedLaptop ? `Tas Laptop: ${assignedLaptop.asset_code}` : 'Tas Laptop: —'}
          </p>

          {/* QR */}
          <div className="mt-2 flex flex-col items-center">
            {qrUrl && (
              <img
                src={qrUrl}
                alt={`QR ${student.student_code}`}
                className={settings.includeBarcodeOnCard ? 'h-14 w-14' : 'h-20 w-20'}
              />
            )}
          </div>

          {/* 1D Barcode */}
          {settings.includeBarcodeOnCard && barcodeUrl && (
            <div className="mt-1 w-full border-t border-slate-100 pt-1">
              <img
                src={barcodeUrl}
                alt={`Barcode ${student.student_code}`}
                className="mx-auto h-10 w-full object-contain"
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Landscape CR80 (85.6mm x 54mm -> scaled 4x = 342px x 216px)
  return (
    <div className="relative mx-auto w-full max-w-[342px] overflow-hidden rounded-[10px] border border-slate-300 bg-white shadow-sm select-none">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2.5 text-white"
        style={{ backgroundColor: theme.primaryHex }}
      >
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold tracking-wide uppercase">
            {settings.schoolName}
          </p>
          <p className="text-[8px] text-white/80">KARTU AKSES PEMINJAMAN LAPTOP</p>
        </div>
        <span className="shrink-0 font-mono text-[9px] font-bold text-white/95">
          {settings.academicYear}
        </span>
      </div>
      <div className="h-[3px]" style={{ backgroundColor: theme.accentHex }} />

      {/* Body */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        {/* Photo */}
        <div className="h-[74px] w-[62px] shrink-0 overflow-hidden rounded border border-slate-300 bg-slate-100">
          {student.photo_url ? (
            <img
              src={student.photo_url}
              alt={student.name}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-base font-bold text-white"
              style={{ backgroundColor: theme.primaryHex }}
            >
              {initials}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <p
            className="font-mono text-[11px] font-bold"
            style={{ color: theme.primaryHex }}
          >
            {student.student_code}
          </p>
          <h4 className="mt-0.5 line-clamp-2 text-[12px] leading-tight font-bold text-slate-900">
            {student.name}
          </h4>
          <p className="mt-1 text-[10px] text-slate-600">
            Kelas {student.class} · {student.wilayah === 'putri' ? 'Putri' : 'Putra'}
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[10px] font-semibold"
            style={{ color: theme.accentHex }}
          >
            {assignedLaptop ? `Tas: ${assignedLaptop.asset_code}` : 'Tas: Belum Ditentukan'}
          </p>
        </div>

        {/* QR Code */}
        <div className="flex shrink-0 flex-col items-center">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={`QR ${student.student_code}`}
              className="h-[64px] w-[64px]"
            />
          ) : (
            <div className="h-[64px] w-[64px] bg-slate-100" />
          )}
          <span className="mt-0.5 text-[7px] font-bold tracking-wider text-slate-500">
            SCAN KARTU
          </span>
        </div>
      </div>

      {/* Bottom Barcode or Footer */}
      {settings.includeBarcodeOnCard && barcodeUrl ? (
        <div className="border-t border-slate-200 px-3 py-1.5">
          <img
            src={barcodeUrl}
            alt={`Barcode ${student.student_code}`}
            className="mx-auto h-[46px] max-w-[220px] object-contain"
          />
        </div>
      ) : (
        <div
          className="border-t border-slate-200 px-3 py-2 text-center"
          style={{ backgroundColor: theme.tintHex }}
        >
          <p className="truncate text-[9px] text-slate-600">{settings.schoolSubtext}</p>
          <p
            className="mt-0.5 text-[8.5px] font-semibold"
            style={{ color: theme.primaryHex }}
          >
            Wajib dibawa saat mengambil &amp; mengembalikan laptop
          </p>
        </div>
      )}
    </div>
  );
}

interface BagTagPreviewProps {
  laptop: Laptop;
  owner?: Student;
  settings: PrintSettings;
}

export function BagHangTagPreview({ laptop, owner, settings }: BagTagPreviewProps) {
  const theme = CARD_THEMES[settings.theme];
  const qrUrl = useQrDataUrl(laptop.asset_code);
  const barcodeUrl = useMemo(
    () =>
      generateBarcodeDataUrl(laptop.asset_code, {
        width: 2.3,
        height: 66,
        displayValue: true,
        fontSize: 16,
        margin: 4,
      }),
    [laptop.asset_code]
  );

  const PunchHole = () => (
    <div
      className="flex flex-col items-center justify-center py-2.5"
      style={{ backgroundColor: theme.tintHex }}
    >
      {settings.showPunchHole ? (
        <>
          <div className="relative flex h-7 w-7 items-center justify-center rounded-full border border-slate-400 bg-white">
            <div className="h-4 w-4 rounded-full border border-slate-600 bg-slate-50" />
            <div className="pointer-events-none absolute h-[1px] w-2.5 bg-slate-400" />
            <div className="pointer-events-none absolute h-2.5 w-[1px] bg-slate-400" />
          </div>
          <span className="mt-0.5 text-[7px] font-semibold tracking-wider text-slate-500">
            LUBANG TALI
          </span>
        </>
      ) : (
        <div className="h-7" />
      )}
    </div>
  );

  if (settings.bagTagStyle === 'foldable') {
    return (
      <div className="mx-auto grid w-full max-w-[448px] grid-cols-2 overflow-hidden rounded-[12px] border border-slate-300 bg-white shadow-sm select-none">
        {/* LEFT HALF: FRONT */}
        <div className="flex flex-col border-r border-dashed border-slate-400">
          <PunchHole />
          <div
            className="px-3 py-2 text-center text-white"
            style={{ backgroundColor: theme.primaryHex }}
          >
            <p className="text-[7.5px] font-bold tracking-wider text-white/80">
              GANTUNGAN TAS · DEPAN
            </p>
            <p className="truncate text-[10px] font-bold uppercase">
              {settings.schoolName}
            </p>
          </div>
          <div className="flex flex-1 flex-col items-center px-3 py-3 text-center">
            <p
              className="font-mono text-[22px] leading-none font-bold tracking-tight"
              style={{ color: theme.primaryHex }}
            >
              {laptop.asset_code}
            </p>
            <p className="mt-1 truncate text-[10px] text-slate-500">
              {laptop.brand_model}
            </p>

            <div className="mt-2.5 w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
              <p className="text-[7.5px] font-bold tracking-wider text-slate-400">
                PEMILIK LAPTOP
              </p>
              <p className="mt-0.5 truncate text-[11px] font-bold text-slate-900">
                {owner ? owner.name : 'Belum Dialokasikan'}
              </p>
              <p className="truncate text-[9.5px] text-slate-600">
                {owner
                  ? `Kelas ${owner.class} · ${owner.wilayah === 'putra' ? 'Putra' : 'Putri'} · ${owner.student_code}`
                  : 'Belum terhubung siswa'}
              </p>
            </div>

            {qrUrl && (
              <img
                src={qrUrl}
                alt={`QR ${laptop.asset_code}`}
                className="mt-2.5 h-[72px] w-[72px]"
              />
            )}
          </div>
        </div>

        {/* RIGHT HALF: BACK */}
        <div className="flex flex-col">
          <PunchHole />
          <div className="bg-slate-900 px-3 py-2 text-center text-white">
            <p className="text-[7.5px] font-bold tracking-wider text-slate-300">
              BARCODE SCANNER · BELAKANG
            </p>
            <p className="text-[10px] font-bold">{settings.academicYear}</p>
          </div>
          <div className="flex flex-1 flex-col justify-between px-3 py-3">
            <div className="flex flex-1 items-center justify-center">
              {barcodeUrl && (
                <img
                  src={barcodeUrl}
                  alt={`Barcode ${laptop.asset_code}`}
                  className="max-h-[92px] w-full object-contain"
                />
              )}
            </div>

            <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-left">
              <p
                className="text-[8.5px] font-bold"
                style={{ color: theme.primaryHex }}
              >
                KETENTUAN PEMAKAIAN
              </p>
              <ol className="mt-1 space-y-0.5 text-[8.5px] leading-snug text-slate-600">
                <li>1. Hanya boleh diambil pemilik sesuai jadwal.</li>
                <li>2. Wajib scan kartu siswa + gantungan tas.</li>
                <li>3. Jika ditemukan, kembalikan ke Ruang Lab.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single-sided Vertical Hang Tag (58mm x 94mm -> scaled ~4x = 232px x 376px)
  return (
    <div className="mx-auto flex w-[232px] flex-col overflow-hidden rounded-[12px] border border-slate-300 bg-white shadow-sm select-none">
      <PunchHole />

      {/* Header Band */}
      <div
        className="px-3 py-2 text-center text-white"
        style={{ backgroundColor: theme.primaryHex }}
      >
        <p className="text-[8px] font-bold tracking-wider text-white/80">
          GANTUNGAN TAS LAPTOP
        </p>
        <p className="truncate text-[10.5px] font-bold uppercase">
          {settings.schoolName}
        </p>
      </div>
      <div className="h-[3px]" style={{ backgroundColor: theme.accentHex }} />

      {/* Asset Code + QR */}
      <div className="px-3 pt-3 pb-2">
        {settings.includeQrOnTag ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p
                className="font-mono text-[19px] leading-none font-bold"
                style={{ color: theme.primaryHex }}
              >
                {laptop.asset_code}
              </p>
              <p className="mt-1 line-clamp-2 text-[9.5px] leading-tight text-slate-500">
                {laptop.brand_model}
              </p>
            </div>
            {qrUrl && (
              <img
                src={qrUrl}
                alt={`QR ${laptop.asset_code}`}
                className="h-[58px] w-[58px] shrink-0"
              />
            )}
          </div>
        ) : (
          <div className="text-center">
            <p
              className="font-mono text-[22px] leading-none font-bold"
              style={{ color: theme.primaryHex }}
            >
              {laptop.asset_code}
            </p>
            <p className="mt-1 truncate text-[10px] text-slate-500">
              {laptop.brand_model}
            </p>
          </div>
        )}
      </div>

      {/* Owner Box */}
      <div className="px-3 pb-2">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
          <p className="text-[7.5px] font-bold tracking-wider text-slate-400">
            PEMILIK TERDAFTAR
          </p>
          <p className="mt-0.5 truncate text-[12px] font-bold text-slate-900">
            {owner ? owner.name : 'Belum Dialokasikan'}
          </p>
          <div className="mt-0.5 flex items-center justify-between text-[9.5px]">
            <span className="truncate text-slate-600">
              {owner
                ? `Kelas ${owner.class} · ${owner.wilayah === 'putra' ? 'Putra' : 'Putri'}`
                : 'Hubungi Petugas Lab'}
            </span>
            {owner && (
              <span
                className="shrink-0 font-mono font-bold"
                style={{ color: theme.accentHex }}
              >
                {owner.student_code}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Large 1D Barcode */}
      <div className="px-3 pt-1 pb-2.5">
        {barcodeUrl && (
          <img
            src={barcodeUrl}
            alt={`Barcode ${laptop.asset_code}`}
            className="mx-auto h-[72px] w-full object-contain"
          />
        )}
        <p className="mt-1 text-center text-[7.5px] text-slate-400">
          Scan barcode ini bersama kartu siswa saat pinjam / kembali
        </p>
      </div>
    </div>
  );
}
