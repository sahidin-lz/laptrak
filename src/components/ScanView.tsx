import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Edit3,
  Home,
  Keyboard,
  Laptop as LaptopIcon,
  LogOut,
  MapPin,
  Moon,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  Ticket,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  AuthUser,
  DailySessionConfig,
  DailySessionKey,
  KioskPersistedState,
  KioskWizardStep,
  Laptop,
  MAX_LATE_STRIKES,
  PiketTicket,
  Student,
  Transaction,
  TransactionType,
  Wilayah,
  WILAYAH_LABELS,
} from '../types/models';
import { api, ApiError, BorrowPayload } from '../lib/api';
import {
  formatDateOnly,
  formatTimeOnly,
  getCurrentSuggestedSessionKey,
  getDefaultReturnDateInput,
  isStudentCurrentlySuspended,
  validateDailySessionSelection,
} from '../lib/store';
import { playFeedback } from '../lib/sound';
import { QrScannerBox } from './QrScannerBox';
import { getInitials } from '../lib/barcode';

type StudentScanPhase = 'scan_card' | 'scan_bag';

interface ValidationPanelData {
  status: 'borrowed' | 'returned' | 'warning' | 'error';
  headline: string;
  subheadline: string;
  student: Student | null;
  laptop: Laptop | null;
  sessionLabel: string;
  customActivityText: string | null;
  deadlineLabel: string;
  piketName: string;
  ticketNumber: string;
  timestamp: string;
  kepulanganStatusChanged?: boolean;
}

interface ScanViewProps {
  currentUser: AuthUser | null;
  students: Student[];
  laptops: Laptop[];
  dailySessions: DailySessionConfig[];
  transactions: Transaction[];
  kioskState: KioskPersistedState;
  onUpdateKioskState: (patch: Partial<KioskPersistedState>) => void;
  onBorrow: (
    payload: BorrowPayload
  ) => Promise<{
    ok: boolean;
    transaction?: Transaction;
    code?: string;
    error?: string;
    correctedSession?: 'siang' | 'sore' | 'malam' | null;
    correctedLabel?: string | null;
  }>;
  onReturn: (
    studentId: string,
    laptopId: string,
    simulateLateMinutes?: number,
    piketId?: string,
    piketToken?: string
  ) => Promise<{
    ok: boolean;
    transaction?: Transaction | null;
    isLate?: boolean;
    lateMinutes?: number;
    studentLateCount?: number;
    newlySuspended?: boolean;
    returnedType?: TransactionType;
    error?: string;
  }>;
  onOpenAdminLogin?: () => void;
}

export function ScanView({
  currentUser,
  students,
  laptops,
  dailySessions,
  transactions,
  kioskState,
  onUpdateKioskState,
  onBorrow,
  onReturn,
  onOpenAdminLogin,
}: ScanViewProps) {
  // Single-screen wizard state hydrated from server-persisted kioskState so F5 refresh stays on the last screen & logged in
  const [wizardStep, setWizardStep] = useState<KioskWizardStep>(() => {
    if (kioskState.piketTicket) {
      return kioskState.wizardStep === 'piket_login' ||
        kioskState.wizardStep === 'validation_panel'
        ? 'select_session'
        : kioskState.wizardStep;
    }
    return 'piket_login';
  });

  // Step 1: Guru Piket Barcode Login state -> menghasilkan Tiket yang tahan refresh
  const [piketTicket, setPiketTicket] = useState<PiketTicket | null>(
    () => kioskState.piketTicket
  );
  const [barcodeLoginInput, setBarcodeLoginInput] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Step 2: Wilayah & Sesi / Kegiatan Lainnya / Kepulangan
  const [selectedWilayah, setSelectedWilayah] = useState<Wilayah>(
    () => kioskState.selectedWilayah || 'putra'
  );
  const [scanMode, setScanMode] = useState<TransactionType>(
    () => kioskState.scanMode || 'harian'
  );
  const [selectedSessionKey, setSelectedSessionKey] = useState<DailySessionKey>(
    () => kioskState.selectedSessionKey || getCurrentSuggestedSessionKey()
  );
  const [customActivityInput, setCustomActivityInput] = useState(
    () => kioskState.customActivityInput || ''
  );
  const [customDeadlineTime, setCustomDeadlineTime] = useState(
    () => kioskState.customDeadlineTime || '17:30'
  );
  const [plannedReturnDate, setPlannedReturnDate] = useState<string>(
    () => kioskState.plannedReturnDate || getDefaultReturnDateInput(3)
  );
  const [homeNote, setHomeNote] = useState(() => kioskState.homeNote || '');

  // Automatic Session Time Guard & Correction Alert state
  const [sessionTimeCorrectionAlert, setSessionTimeCorrectionAlert] = useState<{
    attemptedKey: 'siang' | 'sore' | 'malam';
    attemptedLabel: string;
    reason: string;
    correctedSession: 'siang' | 'sore' | 'malam';
    correctedLabel: string;
  } | null>(null);

  // Step 3: 2-Step Scan (1. Scan Kartu Siswa -> 2. Keluar Data Siswa & Masuk Kamera Scan Tas)
  const [scanPhase, setScanPhase] = useState<StudentScanPhase>('scan_card');
  const [scannedStudentId, setScannedStudentId] = useState<string | null>(null);
  const [manualInputCode, setManualInputCode] = useState('');
  const [inlineScanError, setInlineScanError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // Step 4: Large Validation Panel state
  const [validationResult, setValidationResult] = useState<ValidationPanelData | null>(null);

  // Sync from server kioskState when initial state arrives
  useEffect(() => {
    if (kioskState.piketTicket && !piketTicket) {
      setPiketTicket(kioskState.piketTicket);
      setSelectedWilayah(kioskState.selectedWilayah);
      setScanMode(kioskState.scanMode);
      setSelectedSessionKey(kioskState.selectedSessionKey);
      setCustomActivityInput(kioskState.customActivityInput);
      setCustomDeadlineTime(kioskState.customDeadlineTime);
      setPlannedReturnDate(kioskState.plannedReturnDate);
      setHomeNote(kioskState.homeNote);
      const restoredStep =
        kioskState.wizardStep === 'piket_login' ||
        kioskState.wizardStep === 'validation_panel'
          ? 'select_session'
          : kioskState.wizardStep;
      setWizardStep(restoredStep);
    }
  }, [kioskState, piketTicket]);

  const updateStepAndPersist = (
    nextStep: KioskWizardStep,
    extraPatch: Partial<KioskPersistedState> = {}
  ) => {
    setWizardStep(nextStep);
    onUpdateKioskState({
      wizardStep: nextStep === 'validation_panel' ? 'scan_student' : nextStep,
      ...extraPatch,
    });
  };

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const laptopByStudentMap = useMemo(() => {
    const m = new Map<string, Laptop>();
    laptops.forEach((l) => {
      if (l.assigned_student_id) m.set(l.assigned_student_id, l);
    });
    return m;
  }, [laptops]);

  const scannedStudent = useMemo(
    () => (scannedStudentId ? studentMap.get(scannedStudentId) || null : null),
    [studentMap, scannedStudentId]
  );

  const assignedLaptop = useMemo(
    () => (scannedStudent ? laptopByStudentMap.get(scannedStudent.id) || null : null),
    [laptopByStudentMap, scannedStudent]
  );

  // Check if the scanned student currently has an active borrowing transaction (especially Kepulangan)
  const activeBorrowTxForScannedStudent = useMemo(() => {
    if (!scannedStudent || !assignedLaptop) return null;
    return (
      transactions.find(
        (t) =>
          t.status === 'active' &&
          t.student_id === scannedStudent.id &&
          t.laptop_id === assignedLaptop.id
      ) || null
    );
  }, [transactions, scannedStudent, assignedLaptop]);

  const activeDailySession = useMemo(() => {
    if (selectedSessionKey === 'kegiatan_lainnya') {
      return {
        key: 'sore' as const,
        label: 'Kegiatan Lainnya',
        start_time: '07:00',
        deadline_time: customDeadlineTime || '17:30',
        is_active: true,
      };
    }
    return (
      dailySessions.find((s) => s.key === selectedSessionKey) ||
      dailySessions[0] || {
        key: 'siang' as const,
        label: 'Sesi Siang',
        start_time: '12:30',
        deadline_time: '14:30',
        is_active: true,
      }
    );
  }, [dailySessions, selectedSessionKey, customDeadlineTime]);

  const currentSessionTitle =
    scanMode === 'pulang'
      ? 'Membawa Laptop Pulang (Kepulangan)'
      : selectedSessionKey === 'kegiatan_lainnya'
      ? 'Laptop Kegiatan Lainnya'
      : activeDailySession.label;

  // ============================================================================
  // STEP 1 HANDLER: SCAN BARCODE LOGIN GURU PIKET -> LANGSUNG MASUK HASIL TIKET
  // ============================================================================
  const handlePiketBarcodeLogin = async (rawBarcode: string) => {
    const clean = rawBarcode.trim().toUpperCase();
    if (!clean || loginBusy) return;

    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await api.loginPiketByBarcode(clean);
      setPiketTicket(res.ticket);
      setBarcodeLoginInput('');
      const nextWilayah: Wilayah =
        res.ticket.wilayah === 'putra' || res.ticket.wilayah === 'putri'
          ? res.ticket.wilayah
          : selectedWilayah;
      setSelectedWilayah(nextWilayah);
      playFeedback('success');
      updateStepAndPersist('select_session', {
        piketTicket: res.ticket,
        selectedWilayah: nextWilayah,
      });
    } catch (err) {
      playFeedback('error');
      setLoginError(
        err instanceof ApiError
          ? err.message
          : 'Barcode login Guru Piket tidak dikenali.'
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const handlePiketLoginFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!barcodeLoginInput.trim()) return;
    handlePiketBarcodeLogin(barcodeLoginInput);
  };

  // ============================================================================
  // STEP 2 HANDLER: CHOOSE SESSION (WITH AUTOMATIC CLOCK GUARD FOR DAILY SESSIONS)
  // ============================================================================
  const enterStudentScanScreen = (
    nextMode: TransactionType,
    nextSessionKey: DailySessionKey,
    extraPatch: Partial<KioskPersistedState> = {}
  ) => {
    setScanPhase('scan_card');
    setScannedStudentId(null);
    setManualInputCode('');
    setInlineScanError(null);
    setSessionTimeCorrectionAlert(null);
    updateStepAndPersist('scan_student', {
      scanMode: nextMode,
      selectedSessionKey: nextSessionKey,
      ...extraPatch,
    });
  };

  const handleChooseQuickDailySession = (key: 'siang' | 'sore' | 'malam') => {
    const check = validateDailySessionSelection(key, dailySessions, new Date());
    const chosenCfg = dailySessions.find((s) => s.key === key);

    if (!check.allowed) {
      playFeedback('error');
      setSessionTimeCorrectionAlert({
        attemptedKey: key,
        attemptedLabel: chosenCfg?.label || `Sesi ${key}`,
        reason: check.reason,
        correctedSession: check.correctedSession,
        correctedLabel: check.correctedLabel,
      });
      return;
    }

    setScanMode('harian');
    setSelectedSessionKey(key);
    setCustomActivityInput('');
    playFeedback('scan');
    enterStudentScanScreen('harian', key, { customActivityInput: '' });
  };

  const handleApplyAutomaticSessionCorrection = () => {
    if (!sessionTimeCorrectionAlert) return;
    const corrected = sessionTimeCorrectionAlert.correctedSession;
    setScanMode('harian');
    setSelectedSessionKey(corrected);
    setCustomActivityInput('');
    setSessionTimeCorrectionAlert(null);
    playFeedback('success');
    enterStudentScanScreen('harian', corrected, { customActivityInput: '' });
  };

  const handleStartKegiatanLainnya = (e: FormEvent) => {
    e.preventDefault();
    setScanMode('harian');
    setSelectedSessionKey('kegiatan_lainnya');
    playFeedback('scan');
    enterStudentScanScreen('harian', 'kegiatan_lainnya', {
      customActivityInput,
      customDeadlineTime,
    });
  };

  // Kepulangan waktunya bebas 24 jam tanpa penahanan jam sesi
  const handleStartBawaPulang = (e: FormEvent) => {
    e.preventDefault();
    setScanMode('pulang');
    playFeedback('scan');
    enterStudentScanScreen('pulang', selectedSessionKey, {
      plannedReturnDate,
      homeNote,
    });
  };

  // ============================================================================
  // STEP 3 HANDLER:
  // PHASE A -> SCAN KARTU SISWA (SIS-XXXX) -> KELUAR DATA SISWA & MASUK KAMERA TAS
  // PHASE B -> SCAN BARCODE TAS (LAP-XXX) -> PANEL VALIDASI BESAR & TOMBOL OKE
  // ============================================================================
  const handleCameraOrManualScan = async (rawCode: string) => {
    const cleanCode = rawCode.trim().toUpperCase();
    if (!cleanCode || scanBusy || !piketTicket) return;

    setInlineScanError(null);
    const nowTimeStr = formatTimeOnly(new Date().toISOString());

    // -------------------------------------------------------------------------
    // PHASE A: SCAN KARTU SISWA (SIS-XXXX)
    // -------------------------------------------------------------------------
    if (scanPhase === 'scan_card') {
      const student =
        students.find((s) => s.student_code.toUpperCase() === cleanCode) || null;

      if (!student) {
        playFeedback('error');
        setInlineScanError(
          `Kode Kartu Siswa "${cleanCode}" tidak ditemukan. Pastikan men-scan Kartu Siswa (format SIS-XXXX) terlebih dahulu.`
        );
        return;
      }

      if (student.wilayah !== selectedWilayah) {
        playFeedback('error');
        setValidationResult({
          status: 'error',
          headline: 'SALAH WILAYAH POS SCAN',
          subheadline: `${student.name} terdaftar di ${WILAYAH_LABELS[student.wilayah]}, tidak sesuai dengan pos aktif ${WILAYAH_LABELS[selectedWilayah]}.`,
          student,
          laptop: laptopByStudentMap.get(student.id) || null,
          sessionLabel: currentSessionTitle,
          customActivityText: customActivityInput.trim() || null,
          deadlineLabel:
            scanMode === 'pulang'
              ? formatDateOnly(`${plannedReturnDate}T17:00:00`)
              : activeDailySession.deadline_time,
          piketName: piketTicket.name,
          ticketNumber: piketTicket.ticket_number,
          timestamp: nowTimeStr,
        });
        setWizardStep('validation_panel');
        return;
      }

      const laptopJatah = laptopByStudentMap.get(student.id) || null;
      if (!laptopJatah) {
        playFeedback('error');
        setValidationResult({
          status: 'error',
          headline: 'BELUM ADA ALOKASI TAS LAPTOP',
          subheadline: `${student.name} (${student.student_code}) belum memiliki pasangan tas laptop di Data Master.`,
          student,
          laptop: null,
          sessionLabel: currentSessionTitle,
          customActivityText: customActivityInput.trim() || null,
          deadlineLabel: activeDailySession.deadline_time,
          piketName: piketTicket.name,
          ticketNumber: piketTicket.ticket_number,
          timestamp: nowTimeStr,
        });
        setWizardStep('validation_panel');
        return;
      }

      // If student is suspended AND trying to borrow a laptop, block immediately
      if (isStudentCurrentlySuspended(student) && laptopJatah.status === 'available') {
        playFeedback('error');
        const untilText = student.suspended_until
          ? `sampai ${formatDateOnly(student.suspended_until)}`
          : 'sampai dibuka oleh Admin';
        setValidationResult({
          status: 'error',
          headline: 'SISWA SEDANG DI-SUSPEND',
          subheadline: `${student.name} sedang di-suspend ${untilText}. (${
            student.suspended_reason || `Terlambat ${student.late_count} kali`
          })`,
          student,
          laptop: laptopJatah,
          sessionLabel: currentSessionTitle,
          customActivityText: customActivityInput.trim() || null,
          deadlineLabel: untilText,
          piketName: piketTicket.name,
          ticketNumber: piketTicket.ticket_number,
          timestamp: nowTimeStr,
        });
        setWizardStep('validation_panel');
        return;
      }

      // Valid student card! Show student data & switch camera to Phase B (Scan Bag Tag)
      playFeedback('scan');
      setScannedStudentId(student.id);
      setManualInputCode('');
      setScanPhase('scan_bag');
      return;
    }

    // -------------------------------------------------------------------------
    // PHASE B: SCAN BARCODE TAS LAPTOP (LAP-XXX) SETELAH DATA SISWA KELUAR
    // -------------------------------------------------------------------------
    if (scanPhase === 'scan_bag' && scannedStudent) {
      if (
        assignedLaptop?.status === 'available' &&
        scanMode === 'harian' &&
        selectedSessionKey === 'kegiatan_lainnya' &&
        !customActivityInput.trim()
      ) {
        playFeedback('error');
        setInlineScanError(
          'Wajib diisi: Silakan tulis nama Kegiatan Lainnya pada kolom kegiatan siswa di atas sebelum scan tas laptop.'
        );
        return;
      }

      const scannedLaptop =
        laptops.find((l) => l.asset_code.toUpperCase() === cleanCode) || null;

      if (!scannedLaptop) {
        playFeedback('error');
        setInlineScanError(
          `Kode Barcode Tas "${cleanCode}" tidak terdaftar. Silakan scan barcode Gantungan Tas Laptop (${
            assignedLaptop?.asset_code || 'LAP-XXX'
          }).`
        );
        return;
      }

      // Ownership validation: does this bag belong to the scanned student?
      if (scannedLaptop.assigned_student_id !== scannedStudent.id) {
        playFeedback('error');
        const realOwner = scannedLaptop.assigned_student_id
          ? studentMap.get(scannedLaptop.assigned_student_id)
          : undefined;
        const ownerDesc = realOwner
          ? `${realOwner.name} (${realOwner.class} · ${WILAYAH_LABELS[realOwner.wilayah]})`
          : 'belum dialokasikan ke siswa manapun';

        setValidationResult({
          status: 'error',
          headline: 'SALAH TAS LAPTOP!',
          subheadline: `Barcode tas ${scannedLaptop.asset_code} adalah milik ${ownerDesc}, BUKAN milik ${scannedStudent.name} (Jatah: ${
            assignedLaptop?.asset_code || '—'
          }).`,
          student: scannedStudent,
          laptop: scannedLaptop,
          sessionLabel: currentSessionTitle,
          customActivityText: customActivityInput.trim() || null,
          deadlineLabel: 'Kepemilikan Tidak Cocok',
          piketName: piketTicket.name,
          ticketNumber: piketTicket.ticket_number,
          timestamp: nowTimeStr,
        });
        setWizardStep('validation_panel');
        return;
      }

      setScanBusy(true);
      try {
        // CASE 1: BORROWING LAPTOP
        if (scannedLaptop.status === 'available') {
          const res = await onBorrow({
            studentId: scannedStudent.id,
            laptopId: scannedLaptop.id,
            transactionType: scanMode,
            dailySession: scanMode === 'harian' ? selectedSessionKey : undefined,
            customActivity: customActivityInput.trim() || undefined,
            customDeadlineTime:
              selectedSessionKey === 'kegiatan_lainnya' ? customDeadlineTime : undefined,
            wilayah: selectedWilayah,
            piketId: piketTicket.id,
            piketToken: piketTicket.piket_token,
            plannedReturnDate: scanMode === 'pulang' ? plannedReturnDate : undefined,
            homeNote: scanMode === 'pulang' ? homeNote.trim() : undefined,
          });

          if (!res.ok) {
            playFeedback('error');
            if (res.code === 'OUT_OF_SCHEDULE' && res.correctedSession) {
              setSelectedSessionKey(res.correctedSession);
              onUpdateKioskState({ selectedSessionKey: res.correctedSession });
            }
            setValidationResult({
              status: 'error',
              headline:
                res.code === 'SUSPENDED_3X_LATE'
                  ? 'SISWA SEDANG DI-SUSPEND'
                  : res.code === 'OUT_OF_SCHEDULE'
                  ? 'SESI TIDAK SESUAI JAM — DIKOREKSI OTOMATIS'
                  : 'PEMINJAMAN DITOLAK',
              subheadline: res.error || 'Peminjaman laptop ditolak oleh sistem.',
              student: scannedStudent,
              laptop: scannedLaptop,
              sessionLabel: res.correctedLabel
                ? `Dikoreksi ke ${res.correctedLabel}`
                : currentSessionTitle,
              customActivityText: customActivityInput.trim() || null,
              deadlineLabel:
                scanMode === 'pulang'
                  ? formatDateOnly(`${plannedReturnDate}T17:00:00`)
                  : activeDailySession.deadline_time,
              piketName: piketTicket.name,
              ticketNumber: piketTicket.ticket_number,
              timestamp: nowTimeStr,
            });
            setWizardStep('validation_panel');
            return;
          }

          playFeedback('success');
          setValidationResult({
            status: 'borrowed',
            headline:
              scanMode === 'pulang'
                ? 'VALIDASI BERHASIL — IZIN KEPULANGAN (BAWA PULANG)'
                : selectedSessionKey === 'kegiatan_lainnya'
                ? 'VALIDASI BERHASIL — KEGIATAN LAINNYA'
                : `VALIDASI BERHASIL — ${activeDailySession.label.toUpperCase()}`,
            subheadline:
              scanMode === 'pulang'
                ? `Status Kepulangan Aktif: ${scannedStudent.name} resmi membawa pulang ${scannedLaptop.asset_code}. Status akan otomatis berubah setelah laptop di-scan kembali.`
                : `Kartu Siswa & Tas Laptop cocok! ${scannedStudent.name} resmi meminjam ${scannedLaptop.asset_code} (${scannedLaptop.brand_model}).`,
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: currentSessionTitle,
            customActivityText:
              customActivityInput.trim() ||
              (scanMode === 'pulang' ? homeNote.trim() || null : null),
            deadlineLabel:
              scanMode === 'pulang'
                ? `Waktu Bebas · Kembali s/d ${formatDateOnly(`${plannedReturnDate}T17:00:00`)}`
                : `Batas Jam Telat: ${activeDailySession.deadline_time}`,
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
          });
          setWizardStep('validation_panel');
          return;
        }

        // CASE 2: RETURNING LAPTOP (INCLUDING RETURN FROM KEPULANGAN)
        const retRes = await onReturn(
          scannedStudent.id,
          scannedLaptop.id,
          0,
          piketTicket.id,
          piketTicket.piket_token
        );

        if (!retRes.ok) {
          playFeedback('error');
          setValidationResult({
            status: 'error',
            headline: 'GAGAL MEMPROSES PENGEMBALIAN',
            subheadline: retRes.error || 'Terjadi kesalahan saat mencatat pengembalian.',
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: currentSessionTitle,
            customActivityText: null,
            deadlineLabel: activeDailySession.deadline_time,
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
          });
          setWizardStep('validation_panel');
          return;
        }

        const returnedTx = retRes.transaction;
        const wasKepulangan =
          retRes.returnedType === 'pulang' || returnedTx?.transaction_type === 'pulang';
        const returnedSessionLabel = wasKepulangan
          ? 'Pengembalian dari Kepulangan (Bawa Pulang)'
          : returnedTx?.purpose || currentSessionTitle;

        if (retRes.newlySuspended) {
          playFeedback('error');
          setValidationResult({
            status: 'warning',
            headline: 'TERLAMBAT 3× — OTOMATIS DI-SUSPEND',
            subheadline: `${scannedStudent.name} mengembalikan ${scannedLaptop.asset_code} terlambat ${retRes.lateMinutes} menit (${retRes.studentLateCount}/${MAX_LATE_STRIKES}× telat) dan otomatis di-suspend.`,
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: returnedSessionLabel,
            customActivityText: returnedTx?.custom_activity || returnedTx?.home_note || null,
            deadlineLabel: `Terlambat ${retRes.lateMinutes} Menit`,
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
            kepulanganStatusChanged: wasKepulangan,
          });
        } else if (retRes.isLate) {
          playFeedback('return');
          setValidationResult({
            status: 'warning',
            headline: wasKepulangan
              ? 'KEPULANGAN SELESAI — DIKEMBALIKAN TERLAMBAT'
              : `DIKEMBALIKAN TERLAMBAT (${retRes.studentLateCount}/${MAX_LATE_STRIKES})`,
            subheadline: `Kartu & Tas cocok, namun ${scannedLaptop.asset_code} melewati batas waktu kembali (terlambat ${retRes.lateMinutes} menit).`,
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: returnedSessionLabel,
            customActivityText: returnedTx?.custom_activity || returnedTx?.home_note || null,
            deadlineLabel: `Terlambat ${retRes.lateMinutes} Menit`,
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
            kepulanganStatusChanged: wasKepulangan,
          });
        } else {
          playFeedback('return');
          setValidationResult({
            status: 'returned',
            headline: wasKepulangan
              ? 'STATUS KEPULANGAN BERUBAH: SUDAH DIKEMBALIKAN'
              : 'VALIDASI PENGEMBALIAN TEPAT WAKTU',
            subheadline: wasKepulangan
              ? `Laptop ${scannedLaptop.asset_code} milik ${scannedStudent.name} yang dibawa pulang kini telah di-scan kembali dan statusnya resmi berubah menjadi Tersedia di Lab.`
              : `Kartu Siswa & Tas Laptop cocok! ${scannedLaptop.asset_code} milik ${scannedStudent.name} berhasil dikembalikan tepat waktu.`,
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: returnedSessionLabel,
            customActivityText: returnedTx?.custom_activity || returnedTx?.home_note || null,
            deadlineLabel: wasKepulangan ? 'Sudah Kembali ke Lab' : 'Tepat Waktu',
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
            kepulanganStatusChanged: wasKepulangan,
          });
        }

        setWizardStep('validation_panel');
      } finally {
        setScanBusy(false);
      }
    }
  };

  const handleManualSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!manualInputCode.trim()) return;
    const code = manualInputCode;
    setManualInputCode('');
    handleCameraOrManualScan(code);
  };

  // Klik tombol OKE pada Panel Validasi Besar -> langsung kembali ke kamera awal Scan Kartu Siswa
  const handleValidationOkNextStudent = () => {
    setValidationResult(null);
    setScannedStudentId(null);
    setScanPhase('scan_card');
    setManualInputCode('');
    setInlineScanError(null);
    if (selectedSessionKey === 'kegiatan_lainnya') {
      setCustomActivityInput('');
    }
    updateStepAndPersist('scan_student');
  };

  const handleResetToInitialGuruLogin = () => {
    setValidationResult(null);
    setPiketTicket(null);
    setScannedStudentId(null);
    setScanPhase('scan_card');
    setCustomActivityInput('');
    setManualInputCode('');
    setInlineScanError(null);
    setSessionTimeCorrectionAlert(null);
    updateStepAndPersist('piket_login', {
      piketTicket: null,
      customActivityInput: '',
    });
  };

  return (
    <div className="mx-auto w-full max-w-4xl py-1 sm:py-3">
      {/* Compact Step Progress Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-2.5 text-xs font-bold text-slate-700">
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-extrabold ${
              wizardStep === 'piket_login'
                ? 'bg-blue-700 text-white'
                : 'bg-emerald-600 text-white'
            }`}
          >
            {wizardStep === 'piket_login'
              ? '1'
              : wizardStep === 'select_session'
              ? '2'
              : wizardStep === 'scan_student'
              ? '3'
              : '✓'}
          </span>
          <span className="text-xs font-extrabold text-slate-900 sm:text-sm">
            {wizardStep === 'piket_login' && 'Tahap 1: Scan Barcode Login Guru Piket'}
            {wizardStep === 'select_session' && 'Tahap 2: Pilih Wilayah & Sesi Pemakaian'}
            {wizardStep === 'scan_student' &&
              (scanPhase === 'scan_card'
                ? 'Tahap 3 (1/2): Scan Kartu Siswa'
                : 'Tahap 3 (2/2): Data Siswa & Scan Barcode Tas Laptop')}
            {wizardStep === 'validation_panel' && 'Tahap 4: Validasi Selesai'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {piketTicket && (
            <button
              type="button"
              onClick={handleResetToInitialGuruLogin}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
            >
              <LogOut className="h-3.5 w-3.5" />
              Selesai Piket
            </button>
          )}
          {!currentUser && onOpenAdminLogin && (
            <button
              type="button"
              onClick={onOpenAdminLogin}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-800 hover:bg-indigo-100"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Login Admin
            </button>
          )}
        </div>
      </div>

      {/* =================================================================== */}
      {/* LAYAR 1: SCAN BARCODE LOGIN GURU PIKET                              */}
      {/* =================================================================== */}
      {wizardStep === 'piket_login' && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
          <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 px-5 py-5 text-white sm:px-7">
            <p className="text-xs font-bold tracking-wider text-amber-300 uppercase">
              Pos Validasi Peminjaman &amp; Pengembalian Laptop
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
              Scan Barcode Login Guru Piket
            </h2>
            <p className="mt-1 text-xs text-slate-300 sm:text-sm">
              Arahkan Kartu Barcode / QR Guru Piket ke kamera atau ketik Token Barcode Guru untuk langsung membuka Tiket Sesi.
            </p>
          </div>

          <div className="space-y-5 p-5 sm:p-7">
            <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-950">
              <QrScannerBox onScan={handlePiketBarcodeLogin} paused={loginBusy} />
            </div>

            <form
              onSubmit={handlePiketLoginFormSubmit}
              className="mx-auto flex max-w-xl flex-col gap-2.5 sm:flex-row"
            >
              <div className="relative flex-1">
                <Keyboard className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={barcodeLoginInput}
                  onChange={(e) => {
                    setBarcodeLoginInput(e.target.value.toUpperCase());
                    setLoginError(null);
                  }}
                  placeholder="Scan / ketik kode barcode Guru Piket (cth: PKT-201)..."
                  className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 pr-3 pl-10 font-mono text-sm font-bold uppercase outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={loginBusy}
                className="min-h-[48px] rounded-xl bg-blue-700 px-6 text-xs font-extrabold whitespace-nowrap text-white shadow-xs hover:bg-blue-800 disabled:opacity-50"
              >
                {loginBusy ? 'Memverifikasi...' : 'Masuk Tiket Piket'}
              </button>
            </form>

            {loginError && (
              <div className="mx-auto max-w-xl rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center text-xs font-bold text-rose-700">
                {loginError}
              </div>
            )}
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* LAYAR 2: HASIL TIKET GURU PIKET & PILIH SESI (DENGAN KOREKSI JAM)   */}
      {/* =================================================================== */}
      {wizardStep === 'select_session' && piketTicket && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
          <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-800 px-5 py-5 text-white sm:px-7">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-xs">
                <Ticket className="h-6 w-6 text-amber-300" />
              </div>
              <div>
                <span className="font-mono text-xs font-extrabold text-amber-300">
                  TIKET PIKET AKTIF (TETAP LOGIN SAAT REFRESH): {piketTicket.ticket_number}
                </span>
                <h2 className="text-lg font-extrabold sm:text-xl">{piketTicket.name}</h2>
                <p className="text-xs text-emerald-100">
                  Pilih Wilayah &amp; Sesi di bawah. Sesi Harian dikawal otomatis sesuai jam saat ini, sedangkan Kepulangan waktunya bebas.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            {/* Wilayah Switcher */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700 uppercase">
                <MapPin className="h-3.5 w-3.5 text-blue-600" />
                1. Pilih Wilayah Pos Scan
              </label>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWilayah('putra');
                    onUpdateKioskState({ selectedWilayah: 'putra' });
                  }}
                  className={`min-h-[48px] rounded-xl border-2 px-4 py-2.5 text-xs font-extrabold transition-all sm:text-sm ${
                    selectedWilayah === 'putra'
                      ? 'border-sky-600 bg-sky-600 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-sky-300'
                  }`}
                >
                  Wilayah Putra
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedWilayah('putri');
                    onUpdateKioskState({ selectedWilayah: 'putri' });
                  }}
                  className={`min-h-[48px] rounded-xl border-2 px-4 py-2.5 text-xs font-extrabold transition-all sm:text-sm ${
                    selectedWilayah === 'putri'
                      ? 'border-fuchsia-600 bg-fuchsia-600 text-white shadow-xs'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-fuchsia-300'
                  }`}
                >
                  Wilayah Putri
                </button>
              </div>
            </div>

            {/* Penahanan & Koreksi Otomatis Jam Sesi Alert Box */}
            {sessionTimeCorrectionAlert && (
              <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-600 text-white">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-amber-700 px-2 py-0.5 text-[10px] font-extrabold text-white uppercase">
                        Penahanan &amp; Koreksi Jam Otomatis
                      </span>
                      <span className="text-xs font-extrabold text-amber-950">
                        Pilihan &ldquo;{sessionTimeCorrectionAlert.attemptedLabel}&rdquo; Ditahan Sistem
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-amber-900">
                      {sessionTimeCorrectionAlert.reason}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleApplyAutomaticSessionCorrection}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-800"
                      >
                        <Sparkles className="h-4 w-4 text-amber-300" />
                        Koreksi Otomatis &amp; Masuk ke {sessionTimeCorrectionAlert.correctedLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSessionTimeCorrectionAlert(null)}
                        className="inline-flex min-h-[42px] items-center rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100"
                      >
                        Tutup
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3 Sesi Penggunaan Harian (Tetap Diberikan Pilihan oleh Guru + Dikawal Jam Otomatis) */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-extrabold text-slate-700 uppercase">
                  2. Pilih Sesi Harian (Sistem Menahan &amp; Mengoreksi Otomatis Jika Jam Tidak Sesuai)
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <Clock className="h-3.5 w-3.5" />
                  Sesi Sesuai Jam Saat Ini:{' '}
                  {dailySessions.find((s) => s.key === getCurrentSuggestedSessionKey())?.label ||
                    'Sesi Harian'}
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {dailySessions.map((sess) => {
                  const SessionIcon =
                    sess.key === 'siang' ? Sun : sess.key === 'sore' ? Sunset : Moon;
                  const checkNow = validateDailySessionSelection(
                    sess.key,
                    dailySessions,
                    new Date()
                  );
                  const cardColor =
                    sess.key === 'siang'
                      ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-amber-950'
                      : sess.key === 'sore'
                      ? 'border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-950'
                      : 'border-indigo-300 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-950';

                  return (
                    <button
                      key={sess.key}
                      type="button"
                      onClick={() => handleChooseQuickDailySession(sess.key)}
                      className={`flex min-h-[108px] flex-col justify-between rounded-2xl border-2 p-4 text-left transition-all ${cardColor}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-extrabold">{sess.label}</span>
                        <SessionIcon className="h-5 w-5 shrink-0" />
                      </div>
                      <div className="mt-2 space-y-1">
                        <p className="font-mono text-xs text-slate-600">
                          Mulai: {sess.start_time}
                        </p>
                        <p className="font-mono text-xs font-extrabold text-rose-700">
                          Batas Telat: {sess.deadline_time}
                        </p>
                        <span
                          className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-extrabold ${
                            checkNow.allowed
                              ? 'bg-emerald-700 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {checkNow.allowed ? 'SESUAI JAM SEKARANG' : 'DITAHAN DI LUAR JAM'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Option: Laptop Kegiatan Lainnya (Bisa Ditulis Siswa) */}
            <form
              onSubmit={handleStartKegiatanLainnya}
              className="rounded-2xl border-2 border-cyan-200 bg-cyan-50/50 p-4"
            >
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-cyan-700" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  Laptop Kegiatan Lainnya (Bisa Ditulis Siswa)
                </h3>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-7">
                  <label className="mb-1 block text-[11px] font-bold text-slate-700">
                    Nama Kegiatan (Bisa juga ditulis siswa setelah scan kartu)
                  </label>
                  <input
                    type="text"
                    value={customActivityInput}
                    onChange={(e) => {
                      setCustomActivityInput(e.target.value);
                      onUpdateKioskState({ customActivityInput: e.target.value });
                    }}
                    placeholder="Contoh: Lomba Karya Ilmiah / Tugas Kelompok"
                    className="min-h-[46px] w-full rounded-xl border border-cyan-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-cyan-700"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-bold text-slate-700">
                    Batas Jam
                  </label>
                  <input
                    type="time"
                    value={customDeadlineTime}
                    onChange={(e) => {
                      setCustomDeadlineTime(e.target.value);
                      onUpdateKioskState({ customDeadlineTime: e.target.value });
                    }}
                    className="min-h-[46px] w-full rounded-xl border border-cyan-300 bg-white px-2.5 py-2 font-mono text-xs font-bold text-slate-900 outline-none focus:border-cyan-700"
                  />
                </div>
                <div className="flex items-end sm:col-span-3">
                  <button
                    type="submit"
                    className="min-h-[46px] w-full rounded-xl bg-cyan-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-cyan-800"
                  >
                    Buka Scan Kegiatan
                  </button>
                </div>
              </div>
            </form>

            {/* Option: Membawa Laptop Pulang (Waktunya Bebas 24 Jam) */}
            <form
              onSubmit={handleStartBawaPulang}
              className="rounded-2xl border-2 border-violet-200 bg-violet-50/50 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Home className="h-4 w-4 text-violet-700" />
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Scan Membawa Laptop Pulang (Kepulangan)
                  </h3>
                </div>
                <span className="rounded-md bg-violet-700 px-2.5 py-0.5 text-[10px] font-extrabold text-white uppercase">
                  WAKTU BEBAS 24 JAM · TANPA BATAS JAM SESI
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Waktu kepulangan maupun kembalinya siswa bebas kapan saja. Status kepulangan otomatis berubah menjadi <strong>Sudah Kembali</strong> saat laptop di-scan lagi di sini.
              </p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <label className="mb-1 block text-[11px] font-bold text-slate-700">
                    Tanggal Estimasi Kembali
                  </label>
                  <input
                    type="date"
                    value={plannedReturnDate}
                    min={getDefaultReturnDateInput(0)}
                    onChange={(e) => {
                      setPlannedReturnDate(e.target.value);
                      onUpdateKioskState({ plannedReturnDate: e.target.value });
                    }}
                    className="min-h-[46px] w-full rounded-xl border border-violet-300 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900 outline-none focus:border-violet-700"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-[11px] font-bold text-slate-700">
                    Keterangan Izin / Penjemput
                  </label>
                  <input
                    type="text"
                    value={homeNote}
                    onChange={(e) => {
                      setHomeNote(e.target.value);
                      onUpdateKioskState({ homeNote: e.target.value });
                    }}
                    placeholder="Contoh: Pulang akhir pekan · Dijemput Ayah"
                    className="min-h-[46px] w-full rounded-xl border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none focus:border-violet-700"
                  />
                </div>
                <div className="flex items-end sm:col-span-3">
                  <button
                    type="submit"
                    className="min-h-[46px] w-full rounded-xl bg-violet-700 px-3 py-2 text-xs font-extrabold text-white hover:bg-violet-800"
                  >
                    Buka Scan Kepulangan
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* LAYAR 3: SESI SCAN 2-LANGKAH (1. KARTU SISWA -> 2. DATA + SCAN TAS) */}
      {/* =================================================================== */}
      {wizardStep === 'scan_student' && piketTicket && (
        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md">
          {/* Active Session Top Banner */}
          <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 px-5 py-4 text-white sm:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono font-bold text-amber-300">
                    {piketTicket.ticket_number}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-bold text-cyan-200">
                    {WILAYAH_LABELS[selectedWilayah]}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-300">Piket: {piketTicket.name}</span>
                </div>
                <h2 className="mt-1 text-base font-extrabold sm:text-xl">
                  {scanMode === 'pulang'
                    ? `Scan Kepulangan / Bawa Pulang (Waktu Bebas · Estimasi Kembali ${formatDateOnly(
                        `${plannedReturnDate}T17:00:00`
                      )})`
                    : selectedSessionKey === 'kegiatan_lainnya'
                    ? `Laptop Kegiatan Lainnya (Batas ${customDeadlineTime})`
                    : `${activeDailySession.label} (Batas Telat ${activeDailySession.deadline_time})`}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => updateStepAndPersist('select_session')}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/20"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Ubah Sesi
              </button>
            </div>
          </div>

          <div className="space-y-5 p-5 sm:p-7">
            {/* Single Sequential Scan Indicator: Scan 1 (Kartu Siswa) -> Scan 2 (Gantungan Tas) */}
            {scanPhase === 'scan_card' ? (
              <div className="flex items-center justify-between rounded-2xl border-2 border-blue-600 bg-blue-50 px-4 py-3.5 text-blue-950 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-extrabold tracking-wider text-blue-700 uppercase">
                      Scan Pertama · Kartu Siswa
                    </p>
                    <p className="text-xs font-extrabold sm:text-sm">
                      Silakan Scan QR / Barcode Kartu Siswa (SIS-XXXX)
                    </p>
                  </div>
                </div>
                <span className="hidden rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-extrabold text-white sm:inline-block">
                  TAHAP 1
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border-2 border-indigo-600 bg-indigo-50 px-4 py-3.5 text-indigo-950 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
                    <LaptopIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider text-emerald-700 uppercase">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Scan Pertama Selesai · Lanjut Scan Kedua (Gantungan Tas)
                    </p>
                    <p className="text-xs font-extrabold sm:text-sm">
                      Sekarang Scan Barcode Gantungan Tas Laptop ({assignedLaptop ? assignedLaptop.asset_code : 'LAP-XXX'})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScannedStudentId(null);
                    setScanPhase('scan_card');
                    setInlineScanError(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-100 px-3 py-1.5 text-xs font-extrabold text-rose-700 transition-colors hover:bg-rose-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Ulang Scan Kartu
                </button>
              </div>
            )}

            {/* Responsive Split on Laptop / Stacked on HP when Student Card has been scanned */}
            <div
              className={`grid grid-cols-1 gap-5 ${
                scanPhase === 'scan_bag' && scannedStudent
                  ? 'lg:grid-cols-12 lg:items-start'
                  : ''
              }`}
            >
              {/* KELUAR DATA SISWA (Appears after Step 1 Scan Kartu Siswa succeeds) */}
              {scanPhase === 'scan_bag' && scannedStudent && (
                <div className="space-y-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50/50 p-4 sm:p-5 lg:col-span-5">
                  <div className="flex items-center justify-between border-b border-emerald-200 pb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-emerald-800 uppercase">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      Data Siswa Terverifikasi
                    </span>
                    <span
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-extrabold ${
                        assignedLaptop?.status === 'borrowed'
                          ? activeBorrowTxForScannedStudent?.transaction_type === 'pulang'
                            ? 'bg-violet-700 text-white'
                            : 'bg-amber-600 text-white'
                          : 'bg-blue-700 text-white'
                      }`}
                    >
                      {assignedLaptop?.status === 'borrowed'
                        ? activeBorrowTxForScannedStudent?.transaction_type === 'pulang'
                          ? 'PENGEMBALIAN DARI KEPULANGAN'
                          : 'MODE PENGEMBALIAN'
                        : 'MODE PEMINJAMAN'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3.5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-900 text-base font-extrabold text-white">
                      {scannedStudent.photo_url ? (
                        <img
                          src={scannedStudent.photo_url}
                          alt={scannedStudent.name}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        getInitials(scannedStudent.name)
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-base font-extrabold text-slate-900">
                        {scannedStudent.name}
                      </p>
                      <p className="font-mono text-xs font-bold text-blue-700">
                        {scannedStudent.student_code}
                      </p>
                      <p className="text-xs font-semibold text-slate-600">
                        Kelas {scannedStudent.class} ·{' '}
                        {WILAYAH_LABELS[scannedStudent.wilayah]}
                      </p>
                    </div>
                  </div>

                  {/* Paired Laptop Bag Tag Info to Scan Next */}
                  <div className="rounded-xl border border-emerald-200 bg-white p-3.5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase">
                      Lanjutkan Scan Barcode Tas Laptop Ini:
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-lg font-extrabold text-slate-900">
                        {assignedLaptop?.asset_code || '—'}
                      </span>
                      <span className="text-xs font-semibold text-slate-600">
                        {assignedLaptop?.brand_model || ''}
                      </span>
                    </div>
                  </div>

                  {/* Notice if Student is Returning from Kepulangan */}
                  {assignedLaptop?.status === 'borrowed' &&
                    activeBorrowTxForScannedStudent?.transaction_type === 'pulang' && (
                      <div className="rounded-xl border border-violet-300 bg-violet-50 p-3 text-xs font-semibold text-violet-950">
                        <p className="font-extrabold text-violet-900 uppercase">
                          Status Saat Ini: Sedang Dibawa Pulang
                        </p>
                        <p className="mt-0.5 text-violet-800">
                          Scan Barcode Tas <strong>{assignedLaptop.asset_code}</strong> sekarang untuk mengubah status kepulangan menjadi <strong>Sudah Dikembalikan ke Lab</strong>.
                        </p>
                      </div>
                    )}

                  {/* Input Kegiatan Lainnya oleh Siswa (when borrowing) */}
                  {assignedLaptop?.status === 'available' && scanMode === 'harian' && (
                    <div className="rounded-xl border border-cyan-300 bg-white p-3.5">
                      <label
                        htmlFor="student-activity-input"
                        className="flex items-center gap-1.5 text-xs font-extrabold text-slate-900"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-cyan-700" />
                        {selectedSessionKey === 'kegiatan_lainnya'
                          ? 'Wajib: Tulis Kegiatan Lainnya Siswa'
                          : 'Catatan Kegiatan Siswa (Opsional)'}
                      </label>
                      <input
                        id="student-activity-input"
                        type="text"
                        value={customActivityInput}
                        onChange={(e) => {
                          setCustomActivityInput(e.target.value);
                          onUpdateKioskState({ customActivityInput: e.target.value });
                        }}
                        placeholder="Ketik nama kegiatan siswa..."
                        className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* BAGIAN KAMERA SCANNER (Tetap Aktif untuk Kartu Siswa lalu Barcode Tas) */}
              <div
                className={`space-y-4 ${
                  scanPhase === 'scan_bag' && scannedStudent
                    ? 'lg:col-span-7'
                    : 'mx-auto w-full max-w-xl'
                }`}
              >
                <div className="rounded-2xl border-2 border-blue-600 bg-blue-950 px-4 py-2.5 text-center text-white">
                  <p className="flex items-center justify-center gap-2 text-xs font-extrabold sm:text-sm">
                    <ScanLine className="h-4 w-4 text-amber-300" />
                    {scanPhase === 'scan_card'
                      ? `Arahkan Kamera ke Kartu Siswa (${WILAYAH_LABELS[selectedWilayah]})`
                      : `Sekarang Arahkan Kamera ke Barcode Tas Laptop (${
                          assignedLaptop?.asset_code || 'LAP-XXX'
                        })`}
                  </p>
                </div>

                <div className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-950">
                  <QrScannerBox onScan={handleCameraOrManualScan} paused={scanBusy} />
                </div>

                {/* Manual / USB Scanner Input */}
                <form
                  onSubmit={handleManualSubmit}
                  className="flex flex-col gap-2.5 sm:flex-row"
                >
                  <div className="relative flex-1">
                    <Keyboard className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={manualInputCode}
                      onChange={(e) => {
                        setManualInputCode(e.target.value.toUpperCase());
                        setInlineScanError(null);
                      }}
                      placeholder={
                        scanPhase === 'scan_card'
                          ? 'Scan / ketik kode Kartu Siswa (cth: SIS-0001)...'
                          : `Scan / ketik kode Barcode Tas (${
                              assignedLaptop?.asset_code || 'LAP-001'
                            })...`
                      }
                      className="min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 pr-3 pl-10 font-mono text-sm font-bold uppercase outline-none focus:border-blue-600 focus:bg-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={scanBusy}
                    className="min-h-[48px] rounded-xl bg-blue-700 px-6 text-xs font-extrabold whitespace-nowrap text-white hover:bg-blue-800 disabled:opacity-50"
                  >
                    {scanBusy
                      ? 'Memproses...'
                      : scanPhase === 'scan_card'
                      ? 'Verifikasi Kartu'
                      : 'Verifikasi Tas'}
                  </button>
                </form>

                {inlineScanError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700">
                    {inlineScanError}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* =================================================================== */}
      {/* LAYAR 4: PANEL VALIDASI BESAR & TOMBOL OKE -> KEMBALI KE KAMERA     */}
      {/* =================================================================== */}
      {wizardStep === 'validation_panel' && validationResult && (
        <section className="overflow-hidden rounded-3xl border-2 border-slate-900 bg-white shadow-2xl">
          <div
            className={`px-6 py-7 text-center text-white sm:py-8 ${
              validationResult.status === 'borrowed'
                ? 'bg-gradient-to-br from-emerald-600 to-teal-700'
                : validationResult.status === 'returned'
                ? 'bg-gradient-to-br from-blue-600 to-indigo-700'
                : validationResult.status === 'warning'
                ? 'bg-gradient-to-br from-amber-500 to-orange-600'
                : 'bg-gradient-to-br from-rose-600 to-red-700'
            }`}
          >
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-white/20 backdrop-blur-xs">
              {validationResult.status === 'error' ? (
                <XCircle className="h-12 w-12 text-white" />
              ) : validationResult.status === 'warning' ? (
                <AlertTriangle className="h-12 w-12 text-white" />
              ) : (
                <CheckCircle2 className="h-12 w-12 text-white" />
              )}
            </div>
            <p className="mt-3 font-mono text-xs font-extrabold tracking-widest text-white/80 uppercase">
              PANEL VALIDASI · PUKUL {validationResult.timestamp}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              {validationResult.headline}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm font-medium text-white/95">
              {validationResult.subheadline}
            </p>
          </div>

          <div className="space-y-5 p-5 sm:p-7">
            {validationResult.kepulanganStatusChanged && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3 text-xs font-extrabold text-emerald-950">
                <span>STATUS KEPULANGAN DIPERBARUI OTOMATIS:</span>
                <span className="rounded-lg bg-emerald-700 px-3 py-1 text-white">
                  SEDANG DIBAWA PULANG ➔ SUDAH DIKEMBALIKAN KE LAB
                </span>
              </div>
            )}

            {validationResult.student && (
              <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:grid-cols-2">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-base font-extrabold text-white">
                    {getInitials(validationResult.student.name)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-500 uppercase">
                      Data Siswa
                    </p>
                    <p className="truncate text-base font-extrabold text-slate-900">
                      {validationResult.student.name}
                    </p>
                    <p className="text-xs font-semibold text-slate-600">
                      {validationResult.student.student_code} · Kelas{' '}
                      {validationResult.student.class} ·{' '}
                      {WILAYAH_LABELS[validationResult.student.wilayah]}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3.5 border-t border-slate-200 pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
                    <LaptopIcon className="h-7 w-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-slate-500 uppercase">
                      Tas &amp; Unit Laptop
                    </p>
                    <p className="font-mono text-base font-extrabold text-slate-900">
                      {validationResult.laptop?.asset_code || '—'}
                    </p>
                    <p className="truncate text-xs font-semibold text-slate-600">
                      {validationResult.laptop?.brand_model || 'Tidak ada unit'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="font-bold text-slate-400 uppercase">Sesi / Jenis</p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  {validationResult.sessionLabel}
                </p>
                {validationResult.customActivityText && (
                  <p className="mt-0.5 font-semibold text-cyan-700">
                    Keterangan: &ldquo;{validationResult.customActivityText}&rdquo;
                  </p>
                )}
              </div>
              <div>
                <p className="font-bold text-slate-400 uppercase">Batas / Status Waktu</p>
                <p className="mt-1 font-mono text-sm font-extrabold text-rose-700">
                  {validationResult.deadlineLabel}
                </p>
              </div>
              <div>
                <p className="font-bold text-slate-400 uppercase">Guru Piket</p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  {validationResult.piketName}
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  {validationResult.ticketNumber}
                </p>
              </div>
            </div>

            <div className="space-y-2.5 pt-2">
              <button
                type="button"
                onClick={handleValidationOkNextStudent}
                className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-6 py-4 text-base font-extrabold text-white shadow-lg transition-transform active:scale-[0.99] hover:bg-slate-800"
              >
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                OKE — LANJUT KE KAMERA SCAN SISWA BERIKUTNYA
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
