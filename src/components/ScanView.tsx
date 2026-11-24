import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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
  findLaptopBagStrict,
  findStudentCardStrict,
  formatBimbelDays,
  formatDateOnly,
  formatTimeOnly,
  getCurrentSuggestedSessionKey,
  getDefaultReturnDateInput,
  isStudentCurrentlySuspended,
  normalizeCodeCompact,
  validateDailySessionSelection,
  validateStudentBimbelSchedule,
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
  onUpdateKioskState: (patch: Partial<KioskPersistedState>, syncToCloud?: boolean) => void;
  onBorrow: (
    payload: BorrowPayload
  ) => Promise<{
    ok: boolean;
    transaction?: Transaction;
    code?: string;
    error?: string;
    correctedSession?: string | null;
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
  // Live clock to keep automatic session selection & verification up-to-date
  const [nowClock, setNowClock] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowClock(new Date());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const autoSuggestedSessionKey = useMemo(
    () => getCurrentSuggestedSessionKey(dailySessions, nowClock),
    [dailySessions, nowClock]
  );

  const autoSuggestedSessionConfig = useMemo(
    () =>
      dailySessions.find((s) => s.key === autoSuggestedSessionKey) ||
      dailySessions[0] || {
        key: 'siang' as const,
        label: 'Sesi Siang',
        start_time: '12:30',
        deadline_time: '14:30',
        is_active: true,
      },
    [dailySessions, autoSuggestedSessionKey]
  );

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
  const [selectedSessionKey, setSelectedSessionKey] = useState<DailySessionKey>(() => {
    const saved = kioskState.selectedSessionKey;
    if (saved === 'kegiatan_lainnya') return saved;
    const autoKey = getCurrentSuggestedSessionKey(dailySessions, new Date());
    if (!saved) return autoKey;
    const check = validateDailySessionSelection(saved, dailySessions, new Date());
    return check.allowed ? saved : check.correctedSession;
  });
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
    attemptedKey: string;
    attemptedLabel: string;
    reason: string;
    correctedSession: string;
    correctedLabel: string;
  } | null>(null);
  const [liveSessionAutoAdjustedBanner, setLiveSessionAutoAdjustedBanner] = useState<string | null>(
    null
  );

  // Step 3: Strict 2-Step Sequential Scan (1. Kartu Siswa -> 2. Gantungan Tas Laptop)
  const [scanPhase, setScanPhase] = useState<StudentScanPhase>('scan_card');
  const [scannedStudentId, setScannedStudentId] = useState<string | null>(null);
  const [manualInputCode, setManualInputCode] = useState('');
  const [inlineScanError, setInlineScanError] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // Guard ref to prevent leftover camera frame of Kartu Siswa from immediately triggering an error in Phase 2
  const lastVerifiedCardRef = useRef<{
    rawCode: string;
    studentCode: string;
    verifiedAtMs: number;
  }>({
    rawCode: '',
    studentCode: '',
    verifiedAtMs: 0,
  });

  // Step 4: Large Validation Panel state
  const [validationResult, setValidationResult] = useState<ValidationPanelData | null>(null);

  // Sync from server kioskState when initial state arrives, while ensuring daily session matches current system clock
  useEffect(() => {
    if (kioskState.piketTicket && !piketTicket) {
      setPiketTicket(kioskState.piketTicket);
      setSelectedWilayah(kioskState.selectedWilayah);
      setScanMode(kioskState.scanMode);

      const incomingSession = kioskState.selectedSessionKey;
      if (incomingSession === 'kegiatan_lainnya') {
        setSelectedSessionKey('kegiatan_lainnya');
      } else {
        const check = validateDailySessionSelection(
          incomingSession || autoSuggestedSessionKey,
          dailySessions,
          new Date()
        );
        const verifiedKey = check.allowed
          ? incomingSession || autoSuggestedSessionKey
          : check.correctedSession;
        setSelectedSessionKey(verifiedKey);
      }

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
  }, [kioskState, piketTicket, dailySessions, autoSuggestedSessionKey]);

  // Ensure daily session (siang/sore/malam) is always automatically adjusted & verified by the system
  // when entering select_session or while on scan_student in harian mode
  useEffect(() => {
    if (scanMode !== 'harian' || selectedSessionKey === 'kegiatan_lainnya') {
      return;
    }
    const check = validateDailySessionSelection(selectedSessionKey, dailySessions, nowClock);
    if (!check.allowed) {
      setSelectedSessionKey(check.correctedSession);
      onUpdateKioskState({ selectedSessionKey: check.correctedSession }, false);
      if (wizardStep === 'scan_student') {
        setLiveSessionAutoAdjustedBanner(
          `Sistem otomatis menyesuaikan sesi aktif ke ${check.correctedLabel} sesuai waktu saat ini (${check.currentTimeStr}).`
        );
      }
    }
  }, [nowClock, dailySessions, scanMode, selectedSessionKey, wizardStep, onUpdateKioskState]);

  const updateStepAndPersist = (
    nextStep: KioskWizardStep,
    extraPatch: Partial<KioskPersistedState> = {},
    syncToCloud = true
  ) => {
    setWizardStep(nextStep);
    onUpdateKioskState(
      {
        wizardStep: nextStep === 'validation_panel' ? 'scan_student' : nextStep,
        ...extraPatch,
      },
      syncToCloud
    );
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
      autoSuggestedSessionConfig
    );
  }, [dailySessions, selectedSessionKey, customDeadlineTime, autoSuggestedSessionConfig]);

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
      const autoKey = getCurrentSuggestedSessionKey(dailySessions, new Date());
      setSelectedWilayah(nextWilayah);
      setScanMode('harian');
      setSelectedSessionKey(autoKey);
      playFeedback('success');
      updateStepAndPersist(
        'select_session',
        {
          piketTicket: res.ticket,
          selectedWilayah: nextWilayah,
          scanMode: 'harian',
          selectedSessionKey: autoKey,
        },
        true
      );
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
  // STEP 2 HANDLER: CHOOSE SESSION (AUTO-SELECTED BY SYSTEM & VERIFIED ON CLICK)
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
    setLiveSessionAutoAdjustedBanner(null);
    lastVerifiedCardRef.current = { rawCode: '', studentCode: '', verifiedAtMs: 0 };
    updateStepAndPersist(
      'scan_student',
      {
        scanMode: nextMode,
        selectedSessionKey: nextSessionKey,
        ...extraPatch,
      },
      true
    );
  };

  const handleChooseQuickDailySession = (key: string) => {
    const check = validateDailySessionSelection(key, dailySessions, new Date());
    const chosenCfg = dailySessions.find((s) => s.key === key);

    if (!check.allowed) {
      playFeedback('error');
      // Automatically adjust selectedSessionKey to the system-verified session while displaying the explanation
      setSelectedSessionKey(check.correctedSession);
      onUpdateKioskState({ selectedSessionKey: check.correctedSession }, false);
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
  // STEP 3 HANDLER (STRICT SEQUENTIAL SCAN):
  // TAHAP 1 (scan_card): WAJIB KARTU SISWA (SIS-XXXX) -> KELUAR DATA SISWA
  // TAHAP 2 (scan_bag):  WAJIB BARCODE GANTUNGAN TAS (LAP-XXX) -> VALIDASI
  // ============================================================================
  const handleCameraOrManualScan = async (rawCode: string, isFromCamera = true) => {
    const cleanCode = rawCode.trim().toUpperCase();
    if (!cleanCode || scanBusy || !piketTicket) return;

    const now = new Date();
    const nowTimeStr = formatTimeOnly(now.toISOString());

    // -------------------------------------------------------------------------
    // TAHAP 1 (scan_card): WAJIB SCAN KARTU SISWA TERLEBIH DAHULU
    // -------------------------------------------------------------------------
    if (scanPhase === 'scan_card') {
      setInlineScanError(null);

      // 1. Check if the user accidentally scanned a Laptop Bag Tag (LAP-XXX / TAS-XXX) first!
      const strictStudent = findStudentCardStrict(cleanCode, students);
      const strictBag = findLaptopBagStrict(cleanCode, laptops);

      const isExplicitBagPrefix = /^LAP|^TAS/i.test(cleanCode);
      const isExactBagAssetOnly =
        strictBag &&
        (!strictStudent ||
          normalizeCodeCompact(strictBag.asset_code) === normalizeCodeCompact(cleanCode));

      if (isExplicitBagPrefix || (isExactBagAssetOnly && !strictStudent)) {
        playFeedback('error');
        const bagLabel = strictBag ? `${strictBag.asset_code} (${strictBag.brand_model})` : cleanCode;
        setInlineScanError(
          `Urutan Scan Ketat — Tahap 1 Wajib Kartu Siswa: Anda men-scan Gantungan Tas Laptop "${bagLabel}". Silakan scan KARTU SISWA (SIS-XXXX) terlebih dahulu!`
        );
        return;
      }

      if (!strictStudent) {
        playFeedback('error');
        setInlineScanError(
          `Kode Kartu Siswa "${cleanCode}" tidak ditemukan. Pastikan men-scan Kartu Siswa yang terdaftar (format SIS-XXXX) pada Tahap 1.`
        );
        return;
      }

      const student = strictStudent;

      if (student.wilayah !== selectedWilayah) {
        setSelectedWilayah(student.wilayah);
        onUpdateKioskState({ selectedWilayah: student.wilayah }, false);
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

      // If student is borrowing in Harian mode, verify that today matches their Jadwal Bimbel
      if (laptopJatah.status === 'available' && scanMode === 'harian') {
        const bimbelCheck = validateStudentBimbelSchedule(student, now);
        if (!bimbelCheck.allowedToday) {
          playFeedback('error');
          setValidationResult({
            status: 'error',
            headline: 'JADWAL BIMBEL / PENGGUNAAN TIDAK SESUAI HARI INI',
            subheadline: bimbelCheck.reason,
            student,
            laptop: laptopJatah,
            sessionLabel: currentSessionTitle,
            customActivityText: customActivityInput.trim() || null,
            deadlineLabel: `Jadwal: ${bimbelCheck.scheduleLabel}`,
            piketName: piketTicket.name,
            ticketNumber: piketTicket.ticket_number,
            timestamp: nowTimeStr,
          });
          setWizardStep('validation_panel');
          return;
        }
      }

      // Valid student card! Record timestamp to debounce leftover camera frames & advance to Phase 2 (scan_bag)
      lastVerifiedCardRef.current = {
        rawCode: cleanCode,
        studentCode: student.student_code.trim().toUpperCase(),
        verifiedAtMs: Date.now(),
      };
      playFeedback('scan');
      setScannedStudentId(student.id);
      setManualInputCode('');
      setInlineScanError(null);
      setScanPhase('scan_bag');
      return;
    }

    // -------------------------------------------------------------------------
    // TAHAP 2 (scan_bag): WAJIB SCAN BARCODE GANTUNGAN TAS LAPTOP (LAP-XXX)
    // -------------------------------------------------------------------------
    if (scanPhase === 'scan_bag' && scannedStudent) {
      const elapsedSinceCardScan = Date.now() - lastVerifiedCardRef.current.verifiedAtMs;
      const compactClean = normalizeCodeCompact(cleanCode);
      const isSameCardAsStep1 =
        cleanCode === lastVerifiedCardRef.current.rawCode ||
        cleanCode === lastVerifiedCardRef.current.studentCode ||
        compactClean === normalizeCodeCompact(scannedStudent.student_code);

      // Ignore leftover camera frames of the Kartu Siswa for 2.5 seconds while student moves card away
      if (isFromCamera && isSameCardAsStep1 && elapsedSinceCardScan < 2500) {
        return;
      }

      setInlineScanError(null);

      // Check if user scanned a Student Card (SIS-XXXX) instead of the Laptop Bag Tag (LAP-XXX)
      const isExplicitStudentCardPrefix = /^SIS/i.test(cleanCode);
      const matchedCardInStep2 = findStudentCardStrict(cleanCode, students);
      const matchedBagInStep2 = findLaptopBagStrict(cleanCode, laptops, scannedStudent);

      const isStudentCardNotBag =
        isExplicitStudentCardPrefix ||
        isSameCardAsStep1 ||
        (matchedCardInStep2 &&
          (!matchedBagInStep2 ||
            normalizeCodeCompact(matchedCardInStep2.student_code) === compactClean));

      if (isStudentCardNotBag) {
        playFeedback('error');
        if (matchedCardInStep2 && matchedCardInStep2.id !== scannedStudent.id) {
          setInlineScanError(
            `Urutan Scan Ketat: Anda men-scan Kartu Siswa lain (${matchedCardInStep2.name} · ${matchedCardInStep2.student_code}). Saat ini sistem sedang menunggu Scan BARCODE GANTUNGAN TAS (${
              assignedLaptop?.asset_code || 'LAP-XXX'
            }) milik ${scannedStudent.name}!`
          );
        } else {
          setInlineScanError(
            `Urutan Scan Ketat — Tahap 2 Wajib Gantungan Tas: Kartu Siswa ${scannedStudent.student_code} sudah terverifikasi. Sekarang wajib Scan BARCODE GANTUNGAN TAS LAPTOP (${
              assignedLaptop?.asset_code || 'LAP-XXX'
            })!`
          );
        }
        return;
      }

      if (
        assignedLaptop?.status === 'available' &&
        scanMode === 'harian' &&
        selectedSessionKey === 'kegiatan_lainnya' &&
        !customActivityInput.trim()
      ) {
        playFeedback('error');
        setInlineScanError(
          'Wajib diisi: Silakan tulis nama Kegiatan Lainnya pada kolom kegiatan siswa di samping sebelum scan gantungan tas laptop.'
        );
        return;
      }

      const scannedLaptop = matchedBagInStep2;

      if (!scannedLaptop) {
        playFeedback('error');
        setInlineScanError(
          `Kode Barcode Gantungan Tas "${cleanCode}" tidak terdaftar. Silakan scan Barcode Gantungan Tas Laptop (${
            assignedLaptop?.asset_code || 'LAP-XXX'
          }).`
        );
        return;
      }

      // Strict 1-to-1 ownership validation: does this bag belong to the scanned student?
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
          subheadline: `Barcode gantungan tas ${scannedLaptop.asset_code} adalah milik ${ownerDesc}, BUKAN milik ${scannedStudent.name} (Jatah Tas: ${
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
          // Ensure daily session is verified & synchronized with system clock right before borrowing
          let effectiveSessionKey: DailySessionKey = selectedSessionKey;
          let effectiveSessionCfg = activeDailySession;

          if (scanMode === 'harian' && selectedSessionKey !== 'kegiatan_lainnya') {
            const check = validateDailySessionSelection(selectedSessionKey, dailySessions, now);
            if (!check.allowed) {
              effectiveSessionKey = check.correctedSession;
              setSelectedSessionKey(check.correctedSession);
              onUpdateKioskState({ selectedSessionKey: check.correctedSession }, false);
              effectiveSessionCfg =
                dailySessions.find((s) => s.key === check.correctedSession) || activeDailySession;
            }
          }

          const effectiveSessionTitle =
            scanMode === 'pulang'
              ? 'Membawa Laptop Pulang (Kepulangan)'
              : effectiveSessionKey === 'kegiatan_lainnya'
              ? 'Laptop Kegiatan Lainnya'
              : effectiveSessionCfg.label;

          const res = await onBorrow({
            studentId: scannedStudent.id,
            laptopId: scannedLaptop.id,
            transactionType: scanMode,
            dailySession: scanMode === 'harian' ? effectiveSessionKey : undefined,
            customActivity: customActivityInput.trim() || undefined,
            customDeadlineTime:
              effectiveSessionKey === 'kegiatan_lainnya' ? customDeadlineTime : undefined,
            wilayah: scannedStudent.wilayah || selectedWilayah,
            piketId: piketTicket.id,
            piketToken: piketTicket.piket_token,
            plannedReturnDate: scanMode === 'pulang' ? plannedReturnDate : undefined,
            homeNote: scanMode === 'pulang' ? homeNote.trim() : undefined,
          });

          if (!res.ok) {
            playFeedback('error');
            if (res.code === 'OUT_OF_SCHEDULE' && res.correctedSession) {
              setSelectedSessionKey(res.correctedSession);
              onUpdateKioskState({ selectedSessionKey: res.correctedSession }, false);
            }
            setValidationResult({
              status: 'error',
              headline:
                res.code === 'SUSPENDED_3X_LATE'
                  ? 'SISWA SEDANG DI-SUSPEND'
                  : res.code === 'OUT_OF_BIMBEL_SCHEDULE'
                  ? 'JADWAL BIMBEL / PENGGUNAAN TIDAK SESUAI HARI INI'
                  : res.code === 'OUT_OF_SCHEDULE'
                  ? 'SESI TIDAK SESUAI JAM — DIKOREKSI OTOMATIS'
                  : 'PEMINJAMAN DITOLAK',
              subheadline: res.error || 'Peminjaman laptop ditolak oleh sistem.',
              student: scannedStudent,
              laptop: scannedLaptop,
              sessionLabel: res.correctedLabel
                ? `Dikoreksi ke ${res.correctedLabel}`
                : effectiveSessionTitle,
              customActivityText: customActivityInput.trim() || null,
              deadlineLabel:
                scanMode === 'pulang'
                  ? formatDateOnly(`${plannedReturnDate}T17:00:00`)
                  : effectiveSessionCfg.deadline_time,
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
                : effectiveSessionKey === 'kegiatan_lainnya'
                ? 'VALIDASI BERHASIL — KEGIATAN LAINNYA'
                : `VALIDASI BERHASIL — ${effectiveSessionCfg.label.toUpperCase()}`,
            subheadline:
              scanMode === 'pulang'
                ? `Status Kepulangan Aktif: ${scannedStudent.name} resmi membawa pulang ${scannedLaptop.asset_code}. Status akan otomatis berubah setelah laptop di-scan kembali.`
                : `Urutan Kartu Siswa & Gantungan Tas cocok! ${scannedStudent.name} resmi meminjam ${scannedLaptop.asset_code} (${scannedLaptop.brand_model}).`,
            student: scannedStudent,
            laptop: scannedLaptop,
            sessionLabel: effectiveSessionTitle,
            customActivityText:
              customActivityInput.trim() ||
              (scanMode === 'pulang' ? homeNote.trim() || null : null),
            deadlineLabel:
              scanMode === 'pulang'
                ? `Waktu Bebas · Kembali s/d ${formatDateOnly(`${plannedReturnDate}T17:00:00`)}`
                : `Batas Jam Telat: ${effectiveSessionCfg.deadline_time}`,
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
            subheadline: `Kartu & Gantungan Tas cocok, namun ${scannedLaptop.asset_code} melewati batas waktu kembali (terlambat ${retRes.lateMinutes} menit).`,
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
              : `Urutan Kartu Siswa & Gantungan Tas cocok! ${scannedLaptop.asset_code} milik ${scannedStudent.name} berhasil dikembalikan tepat waktu.`,
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
    handleCameraOrManualScan(code, false);
  };

  // Support USB / Wireless Hardware Barcode Scanners even when manual input is not focused
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTime > 250) {
        buffer = '';
      }
      lastKeyTime = now;

      if (e.key === 'Enter') {
        const scanned = buffer.trim();
        buffer = '';
        if (scanned.length >= 2) {
          e.preventDefault();
          if (wizardStep === 'piket_login') {
            handlePiketBarcodeLogin(scanned);
          } else if (wizardStep === 'scan_student') {
            handleCameraOrManualScan(scanned, false);
          }
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Klik tombol OKE pada Panel Validasi Besar -> langsung kembali ke kamera awal Scan Kartu Siswa
  const handleValidationOkNextStudent = () => {
    setValidationResult(null);
    setScannedStudentId(null);
    setScanPhase('scan_card');
    setManualInputCode('');
    setInlineScanError(null);
    lastVerifiedCardRef.current = { rawCode: '', studentCode: '', verifiedAtMs: 0 };
    if (selectedSessionKey === 'kegiatan_lainnya') {
      setCustomActivityInput('');
    }
    updateStepAndPersist('scan_student', {}, false);
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
    setLiveSessionAutoAdjustedBanner(null);
    lastVerifiedCardRef.current = { rawCode: '', studentCode: '', verifiedAtMs: 0 };
    updateStepAndPersist(
      'piket_login',
      {
        piketTicket: null,
        customActivityInput: '',
      },
      true
    );
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
                    onUpdateKioskState({ selectedWilayah: 'putra' }, true);
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
                    onUpdateKioskState({ selectedWilayah: 'putri' }, true);
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

            {/* Banner Sesi Otomatis Dipilih & Dipastikan Sistem */}
            <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/90 p-4 shadow-xs">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-emerald-700 px-2 py-0.5 text-[10px] font-extrabold text-white uppercase">
                        Otomatis Dipilih &amp; Dipastikan Sistem
                      </span>
                      <span className="font-mono text-xs font-extrabold text-emerald-950">
                        Jam Sekarang:{' '}
                        {nowClock.toLocaleTimeString('id-ID', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-emerald-950 sm:text-sm">
                      Sesi Aktif Otomatis: <span className="underline">{autoSuggestedSessionConfig.label}</span>{' '}
                      (Mulai {autoSuggestedSessionConfig.start_time} · Batas Kembali{' '}
                      {autoSuggestedSessionConfig.deadline_time})
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-emerald-800">
                      Sesi sudah disesuaikan otomatis oleh sistem, namun Guru Piket tetap dapat memilih kartu sesi di bawah.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleChooseQuickDailySession(autoSuggestedSessionKey)}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-extrabold text-white shadow-xs hover:bg-emerald-800"
                >
                  <CheckCircle2 className="h-4 w-4 text-amber-300" />
                  Lanjut {autoSuggestedSessionConfig.label}
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
                  2. Pilih Sesi Harian (Tetap Bisa Dipilih &amp; Dipastikan Sesuai Jam Sistem)
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <Clock className="h-3.5 w-3.5" />
                  Sesi Otomatis Saat Ini: {autoSuggestedSessionConfig.label}
                </span>
              </div>
              <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {dailySessions.map((sess) => {
                  const SessionIcon =
                    sess.key === 'siang' ? Sun : sess.key === 'sore' ? Sunset : Moon;
                  const checkNow = validateDailySessionSelection(
                    sess.key,
                    dailySessions,
                    nowClock
                  );
                  const isAutoSelected =
                    sess.key === autoSuggestedSessionKey ||
                    (selectedSessionKey === sess.key && checkNow.allowed);
                  const cardColor = isAutoSelected
                    ? 'border-emerald-600 ring-2 ring-emerald-500/30 bg-emerald-50/90 hover:bg-emerald-100 text-emerald-950 shadow-sm'
                    : sess.key === 'siang'
                    ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-amber-950'
                    : sess.key === 'sore'
                    ? 'border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-950'
                    : 'border-indigo-300 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-950';

                  return (
                    <button
                      key={sess.key}
                      type="button"
                      onClick={() => handleChooseQuickDailySession(sess.key)}
                      className={`flex min-h-[118px] flex-col justify-between rounded-2xl border-2 p-4 text-left transition-all ${cardColor}`}
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
                            sess.is_active === false
                              ? 'bg-rose-200 text-rose-900'
                              : checkNow.allowed
                              ? 'bg-emerald-700 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {sess.is_active === false
                            ? 'SESI DINONAKTIFKAN ADMIN'
                            : checkNow.allowed
                            ? isAutoSelected
                              ? '✓ OTOMATIS DIPILIH SISTEM'
                              : 'SESUAI JAM SEKARANG'
                            : 'DITAHAN DI LUAR JAM'}
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
                    }}
                    onBlur={() => {
                      onUpdateKioskState({ customActivityInput }, false);
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
                      onUpdateKioskState({ customDeadlineTime: e.target.value }, false);
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
                      onUpdateKioskState({ plannedReturnDate: e.target.value }, false);
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
                    }}
                    onBlur={() => {
                      onUpdateKioskState({ homeNote }, false);
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

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (scanMode === 'pulang') {
                      const nextKey = autoSuggestedSessionKey;
                      setScanMode('harian');
                      setSelectedSessionKey(nextKey);
                      onUpdateKioskState({ scanMode: 'harian', selectedSessionKey: nextKey }, true);
                      playFeedback('scan');
                    } else {
                      const defaultDate = plannedReturnDate || getDefaultReturnDateInput(3);
                      setPlannedReturnDate(defaultDate);
                      setScanMode('pulang');
                      onUpdateKioskState({ scanMode: 'pulang', plannedReturnDate: defaultDate }, true);
                      playFeedback('scan');
                    }
                  }}
                  className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-extrabold transition-colors ${
                    scanMode === 'pulang'
                      ? 'border-amber-300 bg-amber-400 text-slate-950 hover:bg-amber-300'
                      : 'border-violet-300/40 bg-violet-600/80 text-white hover:bg-violet-500'
                  }`}
                >
                  <Home className="h-3.5 w-3.5" />
                  {scanMode === 'pulang'
                    ? 'Pindah ke Scan Sesi Harian'
                    : 'Mode Pengambilan Laptop Kepulangan'}
                </button>
                <button
                  type="button"
                  onClick={() => updateStepAndPersist('select_session', {}, false)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/20"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Ubah Sesi
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-5 sm:p-7">
            {/* Live Auto-Adjusted Session Notice */}
            {liveSessionAutoAdjustedBanner && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-950">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>{liveSessionAutoAdjustedBanner}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setLiveSessionAutoAdjustedBanner(null)}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-extrabold text-amber-900 hover:bg-amber-100"
                >
                  Mengerti
                </button>
              </div>
            )}

            {/* 2-Step Strict Sequence Progress Bar: 1. Kartu Siswa -> 2. Gantungan Tas */}
            <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <div
                className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 transition-all ${
                  scanPhase === 'scan_card'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'bg-emerald-600 text-white'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/20 font-mono text-xs font-extrabold">
                  {scanPhase === 'scan_card' ? '1' : '✓'}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-extrabold tracking-wider uppercase opacity-90">
                    Langkah 1 (Wajib Pertama)
                  </p>
                  <p className="truncate text-xs font-extrabold">
                    Scan Kartu Siswa (SIS-XXXX)
                  </p>
                </div>
              </div>

              <div
                className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 transition-all ${
                  scanPhase === 'scan_bag'
                    ? 'bg-indigo-700 text-white shadow-xs'
                    : 'bg-slate-200/80 text-slate-500'
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white/20 font-mono text-xs font-extrabold">
                  2
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[10px] font-extrabold tracking-wider uppercase opacity-90">
                    Langkah 2 (Setelah Kartu)
                  </p>
                  <p className="truncate text-xs font-extrabold">
                    Scan Gantungan Tas ({assignedLaptop ? assignedLaptop.asset_code : 'LAP-XXX'})
                  </p>
                </div>
              </div>
            </div>

            {/* Single Sequential Scan Indicator: Scan 1 (Kartu Siswa) -> Scan 2 (Gantungan Tas) */}
            {scanPhase === 'scan_card' ? (
              <div className="flex items-center justify-between rounded-2xl border-2 border-blue-600 bg-blue-50 px-4 py-3.5 text-blue-950 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] font-extrabold tracking-wider text-blue-700 uppercase">
                      Urutan 1 dari 2 · Kartu Siswa Terlebih Dahulu
                    </p>
                    <p className="text-xs font-extrabold sm:text-sm">
                      Silakan Scan QR / Barcode Kartu Siswa (SIS-XXXX). Gantungan Tas ditolak sebelum Kartu Siswa di-scan.
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
                      Urutan 2 dari 2 · Kartu Siswa Terverifikasi · Lanjut Scan Gantungan Tas
                    </p>
                    <p className="text-xs font-extrabold sm:text-sm">
                      Sekarang Scan Barcode Gantungan Tas Laptop ({assignedLaptop ? assignedLaptop.asset_code : 'LAP-XXX'}) milik {scannedStudent?.name}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setScannedStudentId(null);
                    setScanPhase('scan_card');
                    setInlineScanError(null);
                    lastVerifiedCardRef.current = { rawCode: '', studentCode: '', verifiedAtMs: 0 };
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-rose-100 px-3 py-1.5 text-xs font-extrabold text-rose-700 transition-colors hover:bg-rose-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Ganti / Ulang Kartu Siswa
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
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-extrabold text-indigo-800">
                        Jadwal Bimbel: {formatBimbelDays(scannedStudent.bimbel_days)}
                      </p>
                    </div>
                  </div>

                  {/* Paired Laptop Bag Tag Info to Scan Next */}
                  <div className="rounded-xl border border-emerald-200 bg-white p-3.5">
                    <p className="text-[11px] font-bold text-slate-500 uppercase">
                      Lanjutkan Scan Barcode Gantungan Tas Ini:
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
                        }}
                        onBlur={() => {
                          onUpdateKioskState({ customActivityInput }, false);
                        }}
                        placeholder="Ketik nama kegiatan siswa..."
                        className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-blue-600"
                      />
                    </div>
                  )}

                  {/* Form Detail Pengambilan Laptop Kepulangan (Bawa Pulang) */}
                  {assignedLaptop?.status === 'available' && scanMode === 'pulang' && (
                    <div className="space-y-2.5 rounded-xl border-2 border-violet-300 bg-violet-50/70 p-3.5">
                      <div className="flex items-center gap-1.5 text-xs font-extrabold text-violet-950">
                        <Home className="h-4 w-4 text-violet-700" />
                        Detail Pengambilan Laptop Kepulangan (Bawa Pulang)
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-violet-900">
                            Estimasi Tanggal Kembali ke Sekolah
                          </label>
                          <input
                            type="date"
                            value={plannedReturnDate}
                            min={getDefaultReturnDateInput(0)}
                            onChange={(e) => {
                              setPlannedReturnDate(e.target.value);
                              onUpdateKioskState({ plannedReturnDate: e.target.value }, false);
                            }}
                            className="min-h-[40px] w-full rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 font-mono text-xs font-bold text-slate-900 outline-none focus:border-violet-700"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold text-violet-900">
                            Keterangan Izin Kepulangan / Penjemput
                          </label>
                          <input
                            type="text"
                            value={homeNote}
                            onChange={(e) => {
                              setHomeNote(e.target.value);
                            }}
                            onBlur={() => {
                              onUpdateKioskState({ homeNote }, false);
                            }}
                            placeholder="Contoh: Izin pulang akhir pekan · Dijemput orang tua"
                            className="min-h-[40px] w-full rounded-lg border border-violet-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 outline-none focus:border-violet-700"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] font-semibold text-violet-800">
                        Sekarang scan barcode Gantungan Tas <strong>{assignedLaptop.asset_code}</strong> untuk mencatat pengambilan laptop kepulangan.
                      </p>
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
                      ? `1. Arahkan Kamera ke Kartu Siswa (${WILAYAH_LABELS[selectedWilayah]})`
                      : `2. Sekarang Arahkan Kamera ke Gantungan Tas Laptop (${
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
                          ? 'Langkah 1: Scan / ketik kode Kartu Siswa (cth: SIS-0001)...'
                          : `Langkah 2: Scan / ketik kode Gantungan Tas (${
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
                      ? 'Verifikasi Kartu (1/2)'
                      : 'Verifikasi Tas (2/2)'}
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
