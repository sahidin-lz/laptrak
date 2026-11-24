import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Ban,
  Check,
  Clock,
  Copy,
  Database,
  Download,
  Edit3,
  FileDown,
  FileSpreadsheet,
  ImagePlus,
  KeyRound,
  Laptop as LaptopIcon,
  Moon,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Shield,
  Sun,
  Sunset,
  Trash2,
  Unlock,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  AuthUser,
  DailySessionConfig,
  DAYS_ID,
  LAPTOP_PURPOSES,
  Laptop,
  LaptopPurpose,
  MAX_LATE_STRIKES,
  PrintSettings,
  Schedule,
  StaffMember,
  StaffRole,
  StaffWilayah,
  Student,
  Wilayah,
  WILAYAH_LABELS,
} from '../types/models';
import {
  BIMBEL_DAY_OPTIONS,
  downloadMultiColumnCsv,
  downloadMultiColumnExcel,
  formatBimbelDays,
  formatDateTimeID,
  getSuggestedTargetClass,
  isStudentCurrentlySuspended,
  parseBimbelDays,
  ParsedLaptopCsvRow,
  ParsedStaffCsvRow,
  ParsedStudentLaptopRow,
  parseLaptopCsv,
  parseStaffCsv,
  parseStudentCsv,
  readSpreadsheetFileToText,
} from '../lib/store';
import { exportBagTagsPdf, exportStudentCardsPdf } from '../lib/pdfGenerator';
import { SUPABASE_SQL_SCHEMA } from '../lib/supabaseSql';
import { CodePreviewModal } from './CodePreviewModal';
import { SuspendStudentModal } from './SuspendStudentModal';
import { TeacherBarcodeModal } from './TeacherBarcodeModal';
import {
  generateAllStaffCardsSheetPngDataUrl,
  generateStaffCardPngDataUrl,
  getInitials,
} from '../lib/barcode';

interface MasterViewProps {
  currentUser: AuthUser;
  students: Student[];
  laptops: Laptop[];
  schedules: Schedule[];
  dailySessions: DailySessionConfig[];
  staff: StaffMember[];
  printSettings: PrintSettings;
  onAddStudent: (data: {
    name: string;
    class: string;
    wilayah: Wilayah;
    photo_url: string | null;
    bimbel_days?: string[];
  }) => Promise<{ ok: boolean; studentCode?: string; error?: string }>;
  onUpdateStudent: (
    studentId: string,
    data: {
      name: string;
      class: string;
      wilayah: Wilayah;
      photo_url?: string | null;
      bimbel_days?: string[];
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onBulkAddStudents: (
    rows: ParsedStudentLaptopRow[]
  ) => Promise<{ ok: boolean; createdStudents?: number; createdLaptops?: number; error?: string }>;
  onBulkSwitchStudentsWilayah: (payload: {
    targetWilayah: Wilayah;
    studentIds?: string[];
  }) => Promise<{ ok: boolean; updatedCount?: number; error?: string }>;
  onSuspendStudent: (
    studentId: string,
    payload: { suspended_until: string; reason: string }
  ) => Promise<void>;
  onResetSanction: (studentId: string) => Promise<void>;
  onDeleteStudent: (studentId: string) => Promise<void>;
  onAddLaptop: (data: {
    asset_code: string;
    brand_model: string;
    assigned_student_id: string | null;
  }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateLaptop: (
    laptopId: string,
    data: {
      asset_code: string;
      brand_model: string;
      assigned_student_id: string | null;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onBulkAddLaptops: (
    rows: ParsedLaptopCsvRow[]
  ) => Promise<{ ok: boolean; createdLaptops?: number; updatedLaptops?: number; error?: string }>;
  onAssignLaptop: (laptopId: string, studentId: string | null) => Promise<void>;
  onDeleteLaptop: (laptopId: string) => Promise<void>;
  onUpdateDailySessions: (sessions: DailySessionConfig[]) => Promise<void>;
  onAddSchedule: (data: {
    purpose: LaptopPurpose;
    target_class: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }) => Promise<void>;
  onUpdateSchedule: (
    scheduleId: string,
    data: {
      purpose: LaptopPurpose;
      target_class: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleSchedule: (scheduleId: string) => Promise<void>;
  onDeleteSchedule: (scheduleId: string) => Promise<void>;
  onAddStaff: (data: {
    name: string;
    username: string;
    password: string;
    role: StaffRole;
    wilayah: StaffWilayah;
    piket_token?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onUpdateStaff: (
    staffId: string,
    data: {
      name: string;
      username: string;
      piket_token: string;
      role: StaffRole;
      wilayah: StaffWilayah;
      password?: string;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onBulkAddStaff: (
    rows: ParsedStaffCsvRow[]
  ) => Promise<{ ok: boolean; createdStaff?: number; updatedStaff?: number; error?: string }>;
  onUpdateStaffToken: (
    staffId: string,
    piket_token?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  onToggleStaff: (staffId: string) => Promise<{ ok: boolean; error?: string }>;
  onDeleteStaff: (staffId: string) => Promise<{ ok: boolean; error?: string }>;
}

export function MasterView({
  currentUser,
  students,
  laptops,
  schedules,
  dailySessions,
  staff,
  printSettings,
  onAddStudent,
  onUpdateStudent,
  onBulkAddStudents,
  onBulkSwitchStudentsWilayah,
  onSuspendStudent,
  onResetSanction,
  onDeleteStudent,
  onAddLaptop,
  onUpdateLaptop,
  onBulkAddLaptops,
  onAssignLaptop,
  onDeleteLaptop,
  onUpdateDailySessions,
  onAddSchedule,
  onUpdateSchedule,
  onToggleSchedule,
  onDeleteSchedule,
  onAddStaff,
  onUpdateStaff,
  onBulkAddStaff,
  onUpdateStaffToken,
  onToggleStaff,
  onDeleteStaff,
}: MasterViewProps) {
  const [activeTab, setActiveTab] = useState<'students' | 'laptops' | 'staff' | 'schedules'>(
    'students'
  );
  const [search, setSearch] = useState('');
  const [wilayahFilter, setWilayahFilter] = useState<'ALL' | Wilayah>('ALL');
  const [uploadTargetWilayah, setUploadTargetWilayah] = useState<'OTOMATIS' | Wilayah>('putri');
  const [formMsg, setFormMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Editable Daily Sessions (Siang, Sore, Malam + Custom Added Session Types)
  const [editableSessions, setEditableSessions] = useState<DailySessionConfig[]>(dailySessions);
  const [newMasterSessionLabel, setNewMasterSessionLabel] = useState('');
  const [newMasterSessionStart, setNewMasterSessionStart] = useState('08:00');
  const [newMasterSessionDeadline, setNewMasterSessionDeadline] = useState('12:00');
  useEffect(() => {
    setEditableSessions(dailySessions);
  }, [dailySessions]);

  // Student CRUD form state
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [studentClass, setStudentClass] = useState('');
  const [studentWilayah, setStudentWilayah] = useState<Wilayah>('putra');
  const [studentBimbelDays, setStudentBimbelDays] = useState<string[]>([]);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);

  // Laptop CRUD form state
  const [editingLaptopId, setEditingLaptopId] = useState<string | null>(null);
  const [assetCode, setAssetCode] = useState('');
  const [brandModel, setBrandModel] = useState('');
  const [assignedStudentId, setAssignedStudentId] = useState('');

  // Schedule CRUD form state
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<LaptopPurpose>('Bimbel Kelas 10');
  const [targetClass, setTargetClass] = useState('10');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('15:30');
  const [endTime, setEndTime] = useState('17:30');

  // Staff / Pegawai CRUD form state
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [staffName, setStaffName] = useState('');
  const [staffUsername, setStaffUsername] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole, setStaffRole] = useState<StaffRole>('piket');
  const [staffWilayah, setStaffWilayah] = useState<StaffWilayah>('putra');
  const [staffTokenInput, setStaffTokenInput] = useState('');

  // Modals
  const [previewModal, setPreviewModal] = useState<{
    mode: 'student' | 'laptop';
    student?: Student;
    laptop?: Laptop;
  } | null>(null);
  const [suspendTargetStudent, setSuspendTargetStudent] = useState<Student | null>(null);
  const [teacherBarcodeStaffId, setTeacherBarcodeStaffId] = useState<string | null>(null);
  const [sqlModalOpen, setSqlModalOpen] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);
  const laptopByStudentMap = useMemo(() => {
    const m = new Map<string, Laptop>();
    laptops.forEach((l) => {
      if (l.assigned_student_id) m.set(l.assigned_student_id, l);
    });
    return m;
  }, [laptops]);

  const unassignedStudents = useMemo(
    () =>
      students.filter(
        (s) =>
          !laptopByStudentMap.has(s.id) ||
          (editingLaptopId && laptopByStudentMap.get(s.id)?.id === editingLaptopId)
      ),
    [students, laptopByStudentMap, editingLaptopId]
  );

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (wilayahFilter !== 'ALL' && s.wilayah !== wilayahFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.student_code.toLowerCase().includes(q) ||
        s.class.toLowerCase().includes(q) ||
        s.wilayah.toLowerCase().includes(q)
      );
    });
  }, [students, search, wilayahFilter]);

  const filteredLaptops = useMemo(() => {
    const q = search.trim().toLowerCase();
    return laptops.filter((l) => {
      const owner = l.assigned_student_id ? studentMap.get(l.assigned_student_id) : undefined;
      if (wilayahFilter !== 'ALL') {
        if (!owner || owner.wilayah !== wilayahFilter) return false;
      }
      if (!q) return true;
      return (
        l.asset_code.toLowerCase().includes(q) ||
        l.brand_model.toLowerCase().includes(q) ||
        (owner?.name.toLowerCase().includes(q) ?? false) ||
        (owner?.student_code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [laptops, search, wilayahFilter, studentMap]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter((stf) => {
      if (wilayahFilter !== 'ALL' && stf.wilayah !== 'semua' && stf.wilayah !== wilayahFilter) {
        return false;
      }
      if (!q) return true;
      return (
        stf.name.toLowerCase().includes(q) ||
        stf.username.toLowerCase().includes(q) ||
        stf.piket_token.toLowerCase().includes(q)
      );
    });
  }, [staff, search, wilayahFilter]);

  const handlePhotoFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoDataUrl(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ============================================================================
  // STUDENT CRUD & CSV TEMPLATE HANDLERS
  // ============================================================================
  const startEditStudent = (st: Student) => {
    setEditingStudentId(st.id);
    setName(st.name);
    setStudentClass(st.class);
    setStudentWilayah(st.wilayah);
    setStudentBimbelDays(parseBimbelDays(st.bimbel_days));
    setPhotoDataUrl(st.photo_url);
    setFormMsg(null);
  };

  const cancelEditStudent = () => {
    setEditingStudentId(null);
    setName('');
    setStudentClass('');
    setStudentWilayah('putra');
    setStudentBimbelDays([]);
    setPhotoDataUrl(null);
  };

  const toggleStudentBimbelDay = (day: string) => {
    setStudentBimbelDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleStudentFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !studentClass.trim()) return;
    setSubmitting(true);
    setFormMsg(null);

    if (editingStudentId) {
      const res = await onUpdateStudent(editingStudentId, {
        name: name.trim(),
        class: studentClass.trim(),
        wilayah: studentWilayah,
        photo_url: photoDataUrl,
        bimbel_days: parseBimbelDays(studentBimbelDays),
      });
      if (res.ok) {
        cancelEditStudent();
        setFormMsg({
          type: 'ok',
          text: 'Data siswa beserta jadwal hari bimbel berhasil diperbarui.',
        });
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Gagal memperbarui data siswa.' });
      }
    } else {
      const res = await onAddStudent({
        name: name.trim(),
        class: studentClass.trim(),
        wilayah: studentWilayah,
        photo_url: photoDataUrl,
        bimbel_days: parseBimbelDays(studentBimbelDays),
      });
      if (res.ok) {
        setName('');
        setStudentClass('');
        setStudentBimbelDays([]);
        setPhotoDataUrl(null);
        setFormMsg({
          type: 'ok',
          text: `Siswa ${WILAYAH_LABELS[studentWilayah]} berhasil ditambahkan dengan kode otomatis ${res.studentCode}.`,
        });
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Gagal menambah siswa.' });
      }
    }
    setSubmitting(false);
  };

  const studentTemplateHeaders = [
    'nama',
    'kelas',
    'wilayah',
    'kode_laptop',
    'merk_laptop',
    'jadwal_bimbel',
    'photo_url',
  ];
  const studentTemplateRows = [
    ['Rina Putri', '10 IPA 2', 'putri', 'LAP-007', 'Lenovo IdeaPad Slim 3', 'Senin, Rabu, Jumat', ''],
    ['Fajar Pratama', '11 IPS 1', 'putra', 'LAP-008', 'Asus Vivobook 14', 'Selasa, Kamis, Sabtu', ''],
    ['Zahra Aulia', '12 IPA 2', 'putri', 'LAP-009', 'HP ProBook 440 G8', 'Semua', ''],
  ];

  const handleDownloadStudentExcelTemplate = () => {
    downloadMultiColumnExcel(
      'template-excel-siswa-dan-laptop.xlsx',
      'Template Siswa & Laptop',
      studentTemplateHeaders,
      studentTemplateRows,
      [24, 14, 12, 16, 26, 24, 28]
    );
  };

  const handleDownloadStudentCsvTemplate = () => {
    downloadMultiColumnCsv(
      'template-csv-siswa-dan-laptop.csv',
      studentTemplateHeaders,
      studentTemplateRows
    );
  };

  const handleStudentCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const text = await readSpreadsheetFileToText(file);
      const defaultWilayah: Wilayah =
        uploadTargetWilayah === 'OTOMATIS'
          ? wilayahFilter === 'putri'
            ? 'putri'
            : 'putra'
          : uploadTargetWilayah;
      let rows = parseStudentCsv(text, defaultWilayah);
      if (uploadTargetWilayah !== 'OTOMATIS') {
        rows = rows.map((r) => ({ ...r, wilayah: uploadTargetWilayah }));
      }
      if (rows.length === 0) {
        setFormMsg({
          type: 'err',
          text: 'File Excel/CSV kosong atau format kolom tidak sesuai (nama | kelas | wilayah | kode_laptop | merk_laptop | photo_url).',
        });
      } else {
        const res = await onBulkAddStudents(rows);
        if (res.ok) {
          if (uploadTargetWilayah !== 'OTOMATIS') {
            setWilayahFilter(uploadTargetWilayah);
          }
          setFormMsg({
            type: 'ok',
            text: `${res.createdStudents} siswa (${
              uploadTargetWilayah === 'OTOMATIS'
                ? 'sesuai kolom wilayah'
                : WILAYAH_LABELS[uploadTargetWilayah]
            }) dan ${res.createdLaptops} unit laptop berhasil diimpor dari template Excel/CSV.`,
          });
        } else {
          setFormMsg({ type: 'err', text: res.error || 'Gagal impor data siswa.' });
        }
      }
    } catch {
      setFormMsg({ type: 'err', text: 'Gagal membaca file Excel/CSV siswa.' });
    } finally {
      e.target.value = '';
      setSubmitting(false);
    }
  };

  const handleQuickMoveStudentsWilayah = async (
    targetWilayah: Wilayah,
    studentIds?: string[],
    labelDesc?: string
  ) => {
    setSubmitting(true);
    setFormMsg(null);
    try {
      const res = await onBulkSwitchStudentsWilayah({ targetWilayah, studentIds });
      if (res.ok) {
        setWilayahFilter(targetWilayah);
        setFormMsg({
          type: 'ok',
          text: `Berhasil memindahkan ${res.updatedCount ?? 0} data siswa ${
            labelDesc || ''
          } ke ${WILAYAH_LABELS[targetWilayah]}!`,
        });
      } else {
        setFormMsg({
          type: 'err',
          text: res.error || 'Gagal memindahkan wilayah siswa.',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // LAPTOP CRUD & EXCEL/CSV TEMPLATE HANDLERS
  // ============================================================================
  const startEditLaptop = (lp: Laptop) => {
    setEditingLaptopId(lp.id);
    setAssetCode(lp.asset_code);
    setBrandModel(lp.brand_model);
    setAssignedStudentId(lp.assigned_student_id || '');
    setFormMsg(null);
  };

  const cancelEditLaptop = () => {
    setEditingLaptopId(null);
    setAssetCode('');
    setBrandModel('');
    setAssignedStudentId('');
  };

  const handleLaptopFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!assetCode.trim() || !brandModel.trim()) return;
    setSubmitting(true);
    setFormMsg(null);

    if (editingLaptopId) {
      const res = await onUpdateLaptop(editingLaptopId, {
        asset_code: assetCode.trim().toUpperCase(),
        brand_model: brandModel.trim(),
        assigned_student_id: assignedStudentId || null,
      });
      if (!res.ok) {
        setFormMsg({ type: 'err', text: res.error || 'Gagal memperbarui unit laptop.' });
      } else {
        cancelEditLaptop();
        setFormMsg({ type: 'ok', text: 'Data unit laptop berhasil diperbarui.' });
      }
    } else {
      const res = await onAddLaptop({
        asset_code: assetCode.trim().toUpperCase(),
        brand_model: brandModel.trim(),
        assigned_student_id: assignedStudentId || null,
      });
      if (!res.ok) {
        setFormMsg({ type: 'err', text: res.error || 'Gagal menambah laptop.' });
      } else {
        setAssetCode('');
        setBrandModel('');
        setAssignedStudentId('');
        setFormMsg({ type: 'ok', text: 'Unit laptop baru berhasil disimpan.' });
      }
    }
    setSubmitting(false);
  };

  const laptopTemplateHeaders = ['kode_laptop', 'merk_laptop', 'kode_siswa', 'wilayah'];
  const laptopTemplateRows = [
    ['LAP-007', 'Lenovo ThinkPad T480', 'SIS-0001', 'putra'],
    ['LAP-008', 'Asus Vivobook 14', 'SIS-0002', 'putri'],
    ['LAP-009', 'Acer TravelMate P2', 'Zahra Aulia', 'putri'],
  ];

  const handleDownloadLaptopExcelTemplate = () => {
    downloadMultiColumnExcel(
      'template-excel-unit-laptop.xlsx',
      'Template Unit Laptop',
      laptopTemplateHeaders,
      laptopTemplateRows,
      [18, 28, 22, 16]
    );
  };

  const handleDownloadLaptopCsvTemplate = () => {
    downloadMultiColumnCsv(
      'template-csv-unit-laptop.csv',
      laptopTemplateHeaders,
      laptopTemplateRows
    );
  };

  const handleLaptopCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const text = await readSpreadsheetFileToText(file);
      const defaultWilayah: Wilayah =
        uploadTargetWilayah === 'OTOMATIS'
          ? wilayahFilter === 'putri'
            ? 'putri'
            : 'putra'
          : uploadTargetWilayah;
      let rows = parseLaptopCsv(text, defaultWilayah);
      if (uploadTargetWilayah !== 'OTOMATIS') {
        rows = rows.map((r) => ({ ...r, wilayah: uploadTargetWilayah }));
      }
      if (rows.length === 0) {
        setFormMsg({
          type: 'err',
          text: 'File Excel/CSV laptop kosong atau format kolom tidak sesuai (kode_laptop | merk_laptop | kode_siswa).',
        });
      } else {
        const res = await onBulkAddLaptops(rows);
        if (res.ok) {
          if (uploadTargetWilayah !== 'OTOMATIS') {
            setWilayahFilter(uploadTargetWilayah);
          }
          setFormMsg({
            type: 'ok',
            text: `Berhasil mengimpor Template Laptop (${
              uploadTargetWilayah === 'OTOMATIS'
                ? 'Sesuai Kolom Wilayah'
                : WILAYAH_LABELS[uploadTargetWilayah]
            }): ${res.createdLaptops} unit baru ditambahkan, ${res.updatedLaptops} unit diperbarui.`,
          });
        } else {
          setFormMsg({ type: 'err', text: res.error || 'Gagal impor file laptop.' });
        }
      }
    } catch {
      setFormMsg({ type: 'err', text: 'Gagal membaca file Excel/CSV laptop.' });
    } finally {
      e.target.value = '';
      setSubmitting(false);
    }
  };

  // ============================================================================
  // STAFF / PEGAWAI & TOKEN BARCODE CRUD + EXCEL/CSV TEMPLATE HANDLERS
  // ============================================================================
  const startEditStaff = (stf: StaffMember) => {
    setEditingStaffId(stf.id);
    setStaffName(stf.name);
    setStaffUsername(stf.username);
    setStaffTokenInput(stf.piket_token);
    setStaffRole(stf.role);
    setStaffWilayah(stf.wilayah);
    setStaffPassword('');
    setFormMsg(null);
  };

  const cancelEditStaff = () => {
    setEditingStaffId(null);
    setStaffName('');
    setStaffUsername('');
    setStaffPassword('');
    setStaffRole('piket');
    setStaffWilayah('putra');
    setStaffTokenInput('');
  };

  const handleStaffFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);

    if (editingStaffId) {
      const res = await onUpdateStaff(editingStaffId, {
        name: staffName.trim(),
        username: staffUsername.trim().toLowerCase(),
        piket_token: staffTokenInput.trim().toUpperCase() || 'PKT-201',
        role: staffRole,
        wilayah: staffWilayah,
        password: staffPassword.trim() ? staffPassword : undefined,
      });
      if (res.ok) {
        cancelEditStaff();
        setFormMsg({
          type: 'ok',
          text: 'Data pegawai / guru piket beserta token barcode login berhasil diperbarui.',
        });
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Gagal memperbarui data pegawai.' });
      }
    } else {
      const res = await onAddStaff({
        name: staffName.trim(),
        username: staffUsername.trim().toLowerCase(),
        password: staffPassword,
        role: staffRole,
        wilayah: staffWilayah,
        piket_token: staffTokenInput.trim().toUpperCase() || undefined,
      });
      if (res.ok) {
        cancelEditStaff();
        setFormMsg({
          type: 'ok',
          text: 'Akun pegawai / guru piket beserta token barcode login berhasil ditambahkan.',
        });
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Gagal menambahkan akun pegawai.' });
      }
    }
    setSubmitting(false);
  };

  const staffTemplateHeaders = [
    'nama',
    'username',
    'token_barcode',
    'wilayah',
    'role',
    'password',
  ];
  const staffTemplateRows = [
    ['Ustadz Fauzan Hakim', 'piket.fauzan', 'PKT-205', 'putra', 'piket', 'Piket@Sekolah26'],
    ['Ustadzah Nisa Rahma', 'piket.nisa', 'PKT-206', 'putri', 'piket', 'Piket@Sekolah26'],
  ];

  const handleDownloadStaffExcelTemplate = () => {
    downloadMultiColumnExcel(
      'template-excel-pegawai-token-barcode-guru.xlsx',
      'Template Pegawai & Token',
      staffTemplateHeaders,
      staffTemplateRows,
      [26, 18, 18, 14, 14, 20]
    );
  };

  const handleDownloadStaffCsvTemplate = () => {
    downloadMultiColumnCsv(
      'template-csv-pegawai-token-barcode-guru.csv',
      staffTemplateHeaders,
      staffTemplateRows
    );
  };

  const handleStaffCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubmitting(true);
    setFormMsg(null);
    try {
      const text = await readSpreadsheetFileToText(file);
      const rows = parseStaffCsv(text);
      if (rows.length === 0) {
        setFormMsg({
          type: 'err',
          text: 'File Excel/CSV pegawai kosong atau format kolom tidak sesuai (nama | username | token_barcode | wilayah | role | password).',
        });
      } else {
        const res = await onBulkAddStaff(rows);
        if (res.ok) {
          setFormMsg({
            type: 'ok',
            text: `Berhasil mengimpor Template Pegawai: ${res.createdStaff} pegawai baru ditambahkan, ${res.updatedStaff} pegawai diperbarui beserta Token Barcode Login.`,
          });
        } else {
          setFormMsg({ type: 'err', text: res.error || 'Gagal impor file pegawai.' });
        }
      }
    } catch {
      setFormMsg({ type: 'err', text: 'Gagal membaca file Excel/CSV pegawai.' });
    } finally {
      e.target.value = '';
      setSubmitting(false);
    }
  };

  // ============================================================================
  // DAILY SESSIONS & SCHEDULE CRUD HANDLERS
  // ============================================================================
  const handleSaveDailySessions = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);
    try {
      await onUpdateDailySessions(editableSessions);
      setFormMsg({
        type: 'ok',
        text: 'Konfigurasi jenis sesi, jam mulai & batas jam terlambat berhasil diperbarui.',
      });
    } catch {
      setFormMsg({
        type: 'err',
        text: 'Gagal menyimpan pengaturan batas jam sesi harian.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddMasterCustomSession = async () => {
    const cleanLabel = newMasterSessionLabel.trim();
    if (!cleanLabel) return;
    const baseKey =
      cleanLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '') || `sesi_${editableSessions.length + 1}`;
    let uniqueKey = baseKey;
    let counter = 2;
    while (
      editableSessions.some((s) => s.key === uniqueKey) ||
      uniqueKey === 'kegiatan_lainnya'
    ) {
      uniqueKey = `${baseKey}_${counter}`;
      counter++;
    }
    const newItem: DailySessionConfig = {
      key: uniqueKey,
      label: cleanLabel,
      start_time: newMasterSessionStart || '08:00',
      deadline_time: newMasterSessionDeadline || '12:00',
      is_active: true,
    };
    const nextList = [...editableSessions, newItem];
    setEditableSessions(nextList);
    setNewMasterSessionLabel('');
    setSubmitting(true);
    try {
      await onUpdateDailySessions(nextList);
      setFormMsg({
        type: 'ok',
        text: `Jenis sesi baru "${cleanLabel}" (${newItem.start_time} – Batas ${newItem.deadline_time}) berhasil ditambahkan.`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMasterSession = async (targetKey: string) => {
    if (editableSessions.length <= 1) return;
    const nextList = editableSessions.filter((s) => s.key !== targetKey);
    setEditableSessions(nextList);
    setSubmitting(true);
    try {
      await onUpdateDailySessions(nextList);
      setFormMsg({
        type: 'ok',
        text: 'Jenis sesi berhasil dihapus.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const startEditSchedule = (sch: Schedule) => {
    setEditingScheduleId(sch.id);
    setPurpose(sch.purpose);
    setTargetClass(sch.target_class);
    setDayOfWeek(sch.day_of_week);
    setStartTime(sch.start_time.slice(0, 5));
    setEndTime(sch.end_time.slice(0, 5));
    setFormMsg(null);
  };

  const cancelEditSchedule = () => {
    setEditingScheduleId(null);
    setPurpose('Bimbel Kelas 10');
    setTargetClass('10');
    setDayOfWeek(1);
    setStartTime('15:30');
    setEndTime('17:30');
  };

  const handleScheduleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);

    if (editingScheduleId) {
      const res = await onUpdateSchedule(editingScheduleId, {
        purpose,
        target_class: targetClass.trim().toUpperCase() || 'SEMUA',
        day_of_week: dayOfWeek,
        start_time: `${startTime}:00`,
        end_time: `${endTime}:00`,
      });
      if (res.ok) {
        cancelEditSchedule();
        setFormMsg({ type: 'ok', text: 'Data jadwal kegiatan berhasil diperbarui.' });
      } else {
        setFormMsg({ type: 'err', text: res.error || 'Gagal memperbarui jadwal.' });
      }
    } else {
      await onAddSchedule({
        purpose,
        target_class: targetClass.trim().toUpperCase() || 'SEMUA',
        day_of_week: dayOfWeek,
        start_time: `${startTime}:00`,
        end_time: `${endTime}:00`,
      });
      setFormMsg({ type: 'ok', text: `Jadwal ${purpose} berhasil ditambahkan.` });
    }
    setSubmitting(false);
  };

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SQL_SCHEMA);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadSql = () => {
    const blob = new Blob([SUPABASE_SQL_SCHEMA], { type: 'text/sql;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'supabase-schema-peminjaman-laptop.sql';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header + 4 CRUD & CSV Tabs */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-900 via-blue-900 to-teal-900 p-5 text-white shadow-md sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-1 text-[11px] font-bold tracking-wider text-teal-200 uppercase backdrop-blur-xs">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Menu Manajemen Data, CRUD &amp; Upload Template Excel / CSV
            </span>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight sm:text-2xl">
              Kelola Siswa, Unit Laptop, Pegawai (Token Barcode Guru) &amp; Sesi Harian
            </h2>
            <p className="mt-1 text-xs text-blue-100/90 sm:text-sm">
              Semua data dilengkapi fitur Tambah, Ubah (Edit), Hapus (CRUD), serta Upload Template Excel/CSV dengan kolom &amp; baris terpisah.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex flex-wrap items-center rounded-xl bg-white/10 p-1 backdrop-blur-xs">
              {(
                [
                  { id: 'students', label: `1. Data Siswa & CSV (${students.length})`, icon: Users },
                  { id: 'laptops', label: `2. Data Laptop & CSV (${laptops.length})`, icon: LaptopIcon },
                  {
                    id: 'staff',
                    label: `3. Data Pegawai & Barcode (${staff.length})`,
                    icon: KeyRound,
                  },
                  { id: 'schedules', label: '4. Sesi Harian & Jadwal', icon: Clock },
                ] as const
              ).map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(t.id);
                      setFormMsg(null);
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold whitespace-nowrap transition-all ${
                      activeTab === t.id
                        ? 'bg-white text-indigo-950 shadow-xs'
                        : 'text-blue-100 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setSqlModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-3.5 py-2 text-xs font-bold whitespace-nowrap text-white transition-colors hover:bg-white/20"
            >
              <Database className="h-3.5 w-3.5" />
              Skrip SQL Supabase
            </button>
          </div>
        </div>
      </div>

      {formMsg && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-bold shadow-xs ${
            formMsg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {formMsg.text}
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 1: DATA SISWA (CRUD + TEMPLATE EXCEL/CSV KOLOM BARIS TERPISAH)  */}
      {/* =================================================================== */}
      {activeTab === 'students' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            {/* Template CSV Siswa & Laptop */}
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  Template Excel / CSV Siswa &amp; Laptop
                </h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Gunakan tabel dengan kolom &amp; baris terpisah berikut (simpan sebagai{' '}
                <strong>.csv</strong> dari Excel):
              </p>

              <div className="mt-2.5 overflow-x-auto rounded-xl border border-emerald-200 bg-white">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-emerald-100 bg-emerald-50 font-extrabold text-emerald-950">
                      <th className="px-2 py-1.5">nama</th>
                      <th className="px-2 py-1.5">kelas</th>
                      <th className="px-2 py-1.5">wilayah</th>
                      <th className="px-2 py-1.5">kode_laptop</th>
                      <th className="px-2 py-1.5">merk_laptop</th>
                      <th className="px-2 py-1.5">jadwal_bimbel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="px-2 py-1">Rina Putri</td>
                      <td className="px-2 py-1">10 IPA 2</td>
                      <td className="px-2 py-1">putri</td>
                      <td className="px-2 py-1">LAP-007</td>
                      <td className="px-2 py-1">Lenovo Slim 3</td>
                      <td className="px-2 py-1 font-bold text-emerald-800">Senin, Rabu, Jumat</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1">Fajar Pratama</td>
                      <td className="px-2 py-1">11 IPS 1</td>
                      <td className="px-2 py-1">putra</td>
                      <td className="px-2 py-1">LAP-008</td>
                      <td className="px-2 py-1">Asus Vivobook</td>
                      <td className="px-2 py-1 font-bold text-emerald-800">Selasa, Kamis, Sabtu</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3.5 space-y-2.5">
                <div className="rounded-xl border border-emerald-200 bg-white p-2.5">
                  <label className="mb-1.5 block text-[11px] font-extrabold text-emerald-950">
                    Target Wilayah Saat Upload File Ini:
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'putri', label: 'Wilayah Putri' },
                        { id: 'putra', label: 'Wilayah Putra' },
                        { id: 'OTOMATIS', label: 'Ikuti Kolom File' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setUploadTargetWilayah(opt.id)}
                        className={`rounded-lg px-2 py-1.5 text-[11px] font-extrabold transition-colors ${
                          uploadTargetWilayah === opt.id
                            ? opt.id === 'putri'
                              ? 'bg-fuchsia-700 text-white shadow-2xs'
                              : opt.id === 'putra'
                              ? 'bg-sky-700 text-white shadow-2xs'
                              : 'bg-emerald-700 text-white shadow-2xs'
                            : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadStudentExcelTemplate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-extrabold text-emerald-800 shadow-2xs transition-colors hover:bg-emerald-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh Template Excel (.xlsx)
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-emerald-700">
                    <Upload className="h-3.5 w-3.5" />
                    Upload Excel / CSV Siswa
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      onChange={handleStudentCsvUpload}
                      disabled={submitting}
                      className="hidden"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadStudentCsvTemplate}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <FileDown className="h-3 w-3" />
                  Alternatif: Unduh Template CSV (Kolom Terpisah Otomatis)
                </button>
              </div>
            </section>

            {/* Form Tambah / Edit Siswa (CRUD) */}
            <form
              onSubmit={handleStudentFormSubmit}
              className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingStudentId ? 'Ubah (Edit) Data Siswa' : 'Tambah Siswa Baru'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {editingStudentId
                      ? 'Perbarui nama, kelas, wilayah, atau foto siswa.'
                      : 'Kode unik kartu SIS-XXXX dihasilkan otomatis.'}
                  </p>
                </div>
                {editingStudentId && (
                  <button
                    type="button"
                    onClick={cancelEditStudent}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Nama Lengkap Siswa
                </label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Muhammad Rizky"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">Kelas</label>
                  <input
                    required
                    type="text"
                    value={studentClass}
                    onChange={(e) => setStudentClass(e.target.value)}
                    placeholder="Contoh: 10 IPA 1"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Wilayah
                  </label>
                  <select
                    value={studentWilayah}
                    onChange={(e) => setStudentWilayah(e.target.value as Wilayah)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-blue-600"
                  >
                    <option value="putra">Wilayah Putra</option>
                    <option value="putri">Wilayah Putri</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">
                    Jadwal Hari Bimbel Siswa (Deteksi Otomatis Saat Scan)
                  </label>
                  <button
                    type="button"
                    onClick={() => setStudentBimbelDays([])}
                    className="text-[11px] font-bold text-blue-700 hover:underline"
                  >
                    Semua Hari (Bebas)
                  </button>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Pilih hari bimbel siswa. Jika siswa men-scan laptop di luar hari yang dipilih, sistem otomatis mendeteksi dan menolak peminjaman.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BIMBEL_DAY_OPTIONS.map((day) => {
                    const active = studentBimbelDays.includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleStudentBimbelDay(day)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-extrabold transition-colors ${
                          active
                            ? 'bg-blue-700 text-white shadow-2xs'
                            : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] font-bold text-indigo-800">
                  Jadwal Aktif: {formatBimbelDays(studentBimbelDays)}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Foto Kartu Siswa (Opsional)
                </label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                    <ImagePlus className="h-3.5 w-3.5" />
                    {photoDataUrl ? 'Ganti Foto' : 'Pilih File Foto'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handlePhotoFileChange}
                      className="hidden"
                    />
                  </label>
                  {photoDataUrl && (
                    <div className="flex items-center gap-2">
                      <img
                        src={photoDataUrl}
                        alt="Pratinjau foto"
                        className="h-8 w-8 rounded object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPhotoDataUrl(null)}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        Hapus
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
              >
                {editingStudentId ? (
                  <>
                    <Save className="h-4 w-4" />
                    Simpan Perubahan Siswa
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Simpan Siswa Baru
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Daftar Siswa ({filteredStudents.length}) — Lengkap dengan Edit, Suspend &amp; Hapus
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">
                      Perbaiki Wilayah Massal ({filteredStudents.length} siswa tampil):
                    </span>
                    <button
                      type="button"
                      disabled={submitting || filteredStudents.length === 0}
                      onClick={() =>
                        handleQuickMoveStudentsWilayah(
                          'putri',
                          filteredStudents.map((s) => s.id),
                          'yang ditampilkan'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-extrabold text-fuchsia-800 transition-colors hover:bg-fuchsia-100 disabled:opacity-50"
                    >
                      Pindahkan ke Wilayah Putri
                    </button>
                    <button
                      type="button"
                      disabled={submitting || filteredStudents.length === 0}
                      onClick={() =>
                        handleQuickMoveStudentsWilayah(
                          'putra',
                          filteredStudents.map((s) => s.id),
                          'yang ditampilkan'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-extrabold text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"
                    >
                      Pindahkan ke Wilayah Putra
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={wilayahFilter}
                    onChange={(e) => setWilayahFilter(e.target.value as 'ALL' | Wilayah)}
                    className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-600"
                  >
                    <option value="ALL">Semua Wilayah</option>
                    <option value="putra">Wilayah Putra</option>
                    <option value="putri">Wilayah Putri</option>
                  </select>
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nama, kode SIS, kelas..."
                      className="w-full rounded-xl border border-slate-200 py-1.5 pr-3 pl-8 text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-5 py-3 font-bold">Siswa &amp; Wilayah</th>
                      <th className="px-4 py-3 font-bold">Kode &amp; Tas</th>
                      <th className="px-4 py-3 font-bold">Status &amp; Batas Suspend</th>
                      <th className="px-5 py-3 text-right font-bold">CRUD, Suspend &amp; Kartu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStudents.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                          Belum ada data siswa sesuai pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredStudents.map((s) => {
                        const owned = laptopByStudentMap.get(s.id);
                        const blocked = isStudentCurrentlySuspended(s);
                        return (
                          <tr key={s.id} className="transition-colors hover:bg-slate-50/70">
                            <td className="px-5 py-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg text-[11px] font-bold text-white ${
                                    s.wilayah === 'putra' ? 'bg-sky-700' : 'bg-fuchsia-700'
                                  }`}
                                >
                                  {s.photo_url ? (
                                    <img
                                      src={s.photo_url}
                                      alt={s.name}
                                      referrerPolicy="no-referrer"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    getInitials(s.name)
                                  )}
                                </div>
                                <div>
                                  <p className="font-bold text-slate-900">{s.name}</p>
                                  <p className="text-[11px] text-slate-500">
                                    Kelas {s.class} ·{' '}
                                    <span
                                      className={`font-bold ${
                                        s.wilayah === 'putra'
                                          ? 'text-sky-700'
                                          : 'text-fuchsia-700'
                                      }`}
                                    >
                                      {WILAYAH_LABELS[s.wilayah]}
                                    </span>
                                  </p>
                                  <p className="mt-0.5 text-[10px] font-bold text-indigo-700">
                                    Jadwal Bimbel: {formatBimbelDays(s.bimbel_days)}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 font-mono">
                              <p className="font-bold text-blue-700">{s.student_code}</p>
                              <p className="text-[11px] text-slate-500">
                                {owned ? `Tas: ${owned.asset_code}` : 'Belum ada tas'}
                              </p>
                            </td>
                            <td className="px-4 py-3">
                              {blocked ? (
                                <div>
                                  <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 font-bold text-rose-800">
                                    <Ban className="h-3 w-3" />
                                    Disuspend ({s.late_count}/3)
                                  </span>
                                  {s.suspended_until && (
                                    <p className="mt-1 text-[11px] font-bold text-rose-700">
                                      Sampai: {formatDateTimeID(s.suspended_until)}
                                    </p>
                                  )}
                                </div>
                              ) : s.late_count > 0 ? (
                                <span className="font-mono font-bold text-amber-700">
                                  {s.late_count}/{MAX_LATE_STRIKES} telat
                                </span>
                              ) : (
                                <span className="font-semibold text-emerald-700">
                                  Tertib (0/3)
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-3">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => startEditStudent(s)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                                  title="Edit / Ubah data siswa"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setSuspendTargetStudent(s)}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100"
                                >
                                  <Ban className="h-3 w-3" />
                                  {blocked ? 'Ubah Suspend' : 'Suspend'}
                                </button>
                                {(blocked || s.late_count > 0) && (
                                  <button
                                    type="button"
                                    onClick={() => onResetSanction(s.id)}
                                    className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                                  >
                                    <Unlock className="h-3 w-3" />
                                    Cabut
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setPreviewModal({ mode: 'student', student: s })}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                                >
                                  <QrCode className="h-3.5 w-3.5" />
                                  Kartu
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    exportStudentCardsPdf([s], laptops, printSettings)
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                                >
                                  <FileDown className="h-3.5 w-3.5" />
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onDeleteStudent(s.id)}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                  title="Hapus siswa"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 2: DATA LAPTOP (CRUD + TEMPLATE EXCEL/CSV KOLOM BARIS TERPISAH) */}
      {/* =================================================================== */}
      {activeTab === 'laptops' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            {/* Template CSV Khusus Unit Laptop */}
            <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-blue-700" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  Template Excel / CSV Khusus Unit Laptop
                </h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Upload daftar kode laptop &amp; merk secara massal dengan kolom terpisah:
              </p>

              <div className="mt-2.5 overflow-x-auto rounded-xl border border-blue-200 bg-white">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-blue-100 bg-blue-50 font-extrabold text-blue-950">
                      <th className="px-2.5 py-1.5">kode_laptop</th>
                      <th className="px-2.5 py-1.5">merk_laptop</th>
                      <th className="px-2.5 py-1.5">kode_siswa</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="px-2.5 py-1">LAP-007</td>
                      <td className="px-2.5 py-1">Lenovo ThinkPad T480</td>
                      <td className="px-2.5 py-1">SIS-0001</td>
                    </tr>
                    <tr>
                      <td className="px-2.5 py-1">LAP-008</td>
                      <td className="px-2.5 py-1">Asus Vivobook 14</td>
                      <td className="px-2.5 py-1">SIS-0002</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3.5 space-y-2.5">
                <div className="rounded-xl border border-blue-200 bg-white p-2.5">
                  <label className="mb-1.5 block text-[11px] font-extrabold text-blue-950">
                    Target Wilayah Pemilik Siswa Saat Upload File Ini:
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { id: 'putri', label: 'Wilayah Putri' },
                        { id: 'putra', label: 'Wilayah Putra' },
                        { id: 'OTOMATIS', label: 'Ikuti Kolom File' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setUploadTargetWilayah(opt.id)}
                        className={`rounded-lg px-2 py-1.5 text-[11px] font-extrabold transition-colors ${
                          uploadTargetWilayah === opt.id
                            ? opt.id === 'putri'
                              ? 'bg-fuchsia-700 text-white shadow-2xs'
                              : opt.id === 'putra'
                              ? 'bg-sky-700 text-white shadow-2xs'
                              : 'bg-blue-700 text-white shadow-2xs'
                            : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadLaptopExcelTemplate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-extrabold text-blue-800 shadow-2xs transition-colors hover:bg-blue-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh Template Excel (.xlsx)
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-blue-700 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-blue-800">
                    <Upload className="h-3.5 w-3.5" />
                    Upload Excel / CSV Laptop
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      onChange={handleLaptopCsvUpload}
                      disabled={submitting}
                      className="hidden"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadLaptopCsvTemplate}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <FileDown className="h-3 w-3" />
                  Alternatif: Unduh Template CSV (Kolom Terpisah Otomatis)
                </button>
              </div>
            </section>

            {/* Form Tambah / Edit Laptop (CRUD) */}
            <form
              onSubmit={handleLaptopFormSubmit}
              className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingLaptopId ? 'Ubah (Edit) Unit Laptop' : 'Tambah Unit Laptop Baru'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Relasi 1-ke-1 pemilik tas laptop dengan siswa.
                  </p>
                </div>
                {editingLaptopId && (
                  <button
                    type="button"
                    onClick={cancelEditLaptop}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Kode Barcode Tas / Aset Laptop
                </label>
                <input
                  required
                  type="text"
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                  placeholder="Contoh: LAP-007"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm uppercase outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Merk / Tipe Laptop
                </label>
                <input
                  required
                  type="text"
                  value={brandModel}
                  onChange={(e) => setBrandModel(e.target.value)}
                  placeholder="Contoh: Lenovo ThinkPad T480"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Pemilik Siswa (Opsional)
                </label>
                <select
                  value={assignedStudentId}
                  onChange={(e) => setAssignedStudentId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-600"
                >
                  <option value="">-- Belum Ditentukan --</option>
                  {unassignedStudents.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.student_code} — {s.name} ({s.class} ·{' '}
                      {s.wilayah === 'putra' ? 'Putra' : 'Putri'})
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
              >
                {editingLaptopId ? (
                  <>
                    <Save className="h-4 w-4" />
                    Simpan Perubahan Laptop
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Simpan Unit Laptop
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Inventaris Unit Laptop &amp; Gantungan Tas ({filteredLaptops.length})
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-500">
                      Perbaiki Wilayah Pemilik ({filteredLaptops.length} unit tampil):
                    </span>
                    <button
                      type="button"
                      disabled={submitting || filteredLaptops.length === 0}
                      onClick={() =>
                        handleQuickMoveStudentsWilayah(
                          'putri',
                          filteredLaptops
                            .map((l) => l.assigned_student_id)
                            .filter(Boolean) as string[],
                          'pemilik laptop yang ditampilkan'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-fuchsia-50 px-2.5 py-1 text-[11px] font-extrabold text-fuchsia-800 transition-colors hover:bg-fuchsia-100 disabled:opacity-50"
                    >
                      Pindahkan ke Wilayah Putri
                    </button>
                    <button
                      type="button"
                      disabled={submitting || filteredLaptops.length === 0}
                      onClick={() =>
                        handleQuickMoveStudentsWilayah(
                          'putra',
                          filteredLaptops
                            .map((l) => l.assigned_student_id)
                            .filter(Boolean) as string[],
                          'pemilik laptop yang ditampilkan'
                        )
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-extrabold text-sky-800 transition-colors hover:bg-sky-100 disabled:opacity-50"
                    >
                      Pindahkan ke Wilayah Putra
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={wilayahFilter}
                    onChange={(e) => setWilayahFilter(e.target.value as 'ALL' | Wilayah)}
                    className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-600"
                  >
                    <option value="ALL">Semua Wilayah</option>
                    <option value="putra">Wilayah Putra</option>
                    <option value="putri">Wilayah Putri</option>
                  </select>
                  <div className="relative w-full sm:w-56">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari kode LAP, merk, pemilik..."
                      className="w-full rounded-xl border border-slate-200 py-1.5 pr-3 pl-8 text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-5 py-3 font-bold">Kode Tas</th>
                      <th className="px-4 py-3 font-bold">Unit Laptop</th>
                      <th className="px-4 py-3 font-bold">Pemilik Siswa</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-5 py-3 text-right font-bold">CRUD &amp; Gantungan PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLaptops.map((l) => {
                      const owner = l.assigned_student_id
                        ? studentMap.get(l.assigned_student_id)
                        : undefined;
                      return (
                        <tr key={l.id} className="transition-colors hover:bg-slate-50/70">
                          <td className="px-5 py-3 font-mono font-bold text-slate-900">
                            {l.asset_code}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{l.brand_model}</td>
                          <td className="px-4 py-3">
                            <select
                              value={l.assigned_student_id || ''}
                              onChange={(e) => onAssignLaptop(l.id, e.target.value || null)}
                              className="max-w-[190px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-blue-600"
                            >
                              <option value="">Belum ditentukan</option>
                              {owner && (
                                <option value={owner.id}>
                                  {owner.student_code} · {owner.name}
                                </option>
                              )}
                              {students
                                .filter((s) => !laptopByStudentMap.has(s.id))
                                .map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.student_code} · {s.name}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`font-bold ${
                                l.status === 'available'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {l.status === 'available' ? 'Tersedia' : 'Dipinjam'}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditLaptop(l)}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                              >
                                <Edit3 className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setPreviewModal({ mode: 'laptop', laptop: l })}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                              >
                                <QrCode className="h-3.5 w-3.5" />
                                Tag
                              </button>
                              <button
                                type="button"
                                onClick={() => exportBagTagsPdf([l], students, printSettings)}
                                className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                              >
                                <FileDown className="h-3.5 w-3.5" />
                                PDF
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteLaptop(l.id)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 3: DATA PEGAWAI / GURU PIKET & TOKEN BARCODE LOGIN + CSV        */}
      {/* =================================================================== */}
      {activeTab === 'staff' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            {/* Template CSV Pegawai & Token Barcode Guru */}
            <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-amber-700" />
                <h3 className="text-sm font-extrabold text-slate-900">
                  Template Excel / CSV Pegawai &amp; Token Barcode
                </h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Upload data pegawai/guru piket beserta <strong>Token Kode Barcode Login</strong> dengan kolom terpisah:
              </p>

              <div className="mt-2.5 overflow-x-auto rounded-xl border border-amber-200 bg-white">
                <table className="w-full text-left font-mono text-[10px]">
                  <thead>
                    <tr className="border-b border-amber-100 bg-amber-50 font-extrabold text-amber-950">
                      <th className="px-2 py-1.5">nama</th>
                      <th className="px-2 py-1.5">username</th>
                      <th className="px-2 py-1.5">token_barcode</th>
                      <th className="px-2 py-1.5">wilayah</th>
                      <th className="px-2 py-1.5">role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="px-2 py-1">Ustadz Fauzan</td>
                      <td className="px-2 py-1">piket.fauzan</td>
                      <td className="px-2 py-1 font-bold text-amber-800">PKT-205</td>
                      <td className="px-2 py-1">putra</td>
                      <td className="px-2 py-1">piket</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1">Ustadzah Nisa</td>
                      <td className="px-2 py-1">piket.nisa</td>
                      <td className="px-2 py-1 font-bold text-amber-800">PKT-206</td>
                      <td className="px-2 py-1">putri</td>
                      <td className="px-2 py-1">piket</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-3.5 space-y-2">
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleDownloadStaffExcelTemplate}
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-extrabold text-amber-900 shadow-2xs transition-colors hover:bg-amber-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh Template Excel (.xlsx)
                  </button>
                  <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-extrabold text-white transition-colors hover:bg-amber-700">
                    <Upload className="h-3.5 w-3.5" />
                    Upload Excel / CSV Pegawai
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      onChange={handleStaffCsvUpload}
                      disabled={submitting}
                      className="hidden"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadStaffCsvTemplate}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  <FileDown className="h-3 w-3" />
                  Alternatif: Unduh Template CSV (Kolom Terpisah Otomatis)
                </button>
              </div>
            </section>

            {/* Form Tambah / Edit Pegawai & Token Barcode (CRUD) */}
            <form
              onSubmit={handleStaffFormSubmit}
              className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    {editingStaffId
                      ? 'Ubah (Edit) Pegawai & Token Barcode'
                      : 'Tambah Pegawai / Guru Piket'}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Berisi Nama Pegawai dan Token Kode Barcode untuk login scan Guru Piket di halaman awal.
                  </p>
                </div>
                {editingStaffId && (
                  <button
                    type="button"
                    onClick={cancelEditStaff}
                    className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
                  >
                    Batal Edit
                  </button>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Nama Lengkap Pegawai / Guru Piket
                </label>
                <input
                  required
                  type="text"
                  value={staffName}
                  onChange={(e) => setStaffName(e.target.value)}
                  placeholder="Contoh: Ustadz Hendra Wijaya"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Username
                  </label>
                  <input
                    required
                    type="text"
                    value={staffUsername}
                    onChange={(e) => setStaffUsername(e.target.value)}
                    placeholder="piket.putra3"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs lowercase outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-amber-800">
                    Token Kode Barcode
                  </label>
                  <input
                    type="text"
                    value={staffTokenInput}
                    onChange={(e) => setStaffTokenInput(e.target.value.toUpperCase())}
                    placeholder="Contoh: PKT-205"
                    className="w-full rounded-xl border border-amber-300 bg-amber-50/50 px-3 py-2 font-mono text-xs font-bold uppercase outline-none focus:border-amber-600"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  {editingStaffId
                    ? 'Password Baru (Kosongkan jika tidak diubah)'
                    : 'Password (Min. 6 Karakter)'}
                </label>
                <input
                  required={!editingStaffId}
                  minLength={6}
                  type="password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  placeholder={editingStaffId ? 'Opsional: isi jika ganti password' : 'Password akun'}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Peran (Role)
                  </label>
                  <select
                    value={staffRole}
                    onChange={(e) => {
                      const nextRole = e.target.value as StaffRole;
                      setStaffRole(nextRole);
                      if (nextRole === 'admin') {
                        setStaffWilayah('semua');
                      } else if (staffWilayah === 'semua') {
                        setStaffWilayah('putra');
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-blue-600"
                  >
                    <option value="piket">Guru Piket</option>
                    <option value="admin">Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Wilayah Tugas
                  </label>
                  <select
                    value={staffWilayah}
                    onChange={(e) => setStaffWilayah(e.target.value as StaffWilayah)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-blue-600"
                  >
                    <option value="putra">Wilayah Putra</option>
                    <option value="putri">Wilayah Putri</option>
                    <option value="semua">Semua Wilayah</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50"
              >
                {editingStaffId ? (
                  <>
                    <Save className="h-4 w-4" />
                    Simpan Perubahan Pegawai &amp; Token
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" />
                    Simpan Pegawai &amp; Token Barcode
                  </>
                )}
              </button>
            </form>
          </div>

          <div className="lg:col-span-8">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Daftar Data Pegawai &amp; Token Kode Barcode Login Guru ({filteredStaff.length})
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Klik <strong>Kartu PNG</strong> untuk mengunduh Kartu ID Barcode Login resolusi tinggi, atau <strong>Unduh Semua Kartu (.PNG)</strong>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const list = filteredStaff.map((s) => ({
                        id: s.id,
                        name: s.name,
                        role: s.role,
                        wilayah: s.wilayah,
                        demo_token: s.piket_token,
                      }));
                      const sheetUrl = await generateAllStaffCardsSheetPngDataUrl(
                        list,
                        printSettings.schoolName
                      );
                      if (sheetUrl) {
                        const link = document.createElement('a');
                        link.href = sheetUrl;
                        link.download = `lembar-semua-kartu-guru-dan-admin-${list.length}-kartu.png`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        setFormMsg({
                          type: 'ok',
                          text: `Lembar Gabungan (${list.length} Kartu Guru Piket & Admin) resolusi tinggi berhasil diunduh dalam format .PNG.`,
                        });
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-1.5 text-xs font-extrabold text-white shadow-2xs transition-all hover:from-emerald-700 hover:to-teal-700"
                    title="Unduh lembar PNG berisi semua kartu Guru Piket & Admin"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Unduh Semua Kartu (.PNG)
                  </button>
                  <div className="relative w-full sm:w-52">
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari nama pegawai, token PKT..."
                      className="w-full rounded-xl border border-slate-200 py-1.5 pr-3 pl-8 text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-5 py-3 font-bold">Nama Pegawai / Guru</th>
                      <th className="px-4 py-3 font-bold">Token &amp; Unduh Kartu Barcode (.PNG)</th>
                      <th className="px-4 py-3 font-bold">Peran &amp; Wilayah</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-5 py-3 text-right font-bold">CRUD &amp; Kartu Barcode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStaff.map((stf) => {
                      const isSelf = stf.id === currentUser.id;
                      return (
                        <tr key={stf.id} className="transition-colors hover:bg-slate-50/70">
                          <td className="px-5 py-3">
                            <p className="font-bold text-slate-900">
                              {stf.name}{' '}
                              {isSelf && (
                                <span className="font-normal text-blue-700">(Anda)</span>
                              )}
                            </p>
                            <p className="font-mono text-[11px] text-slate-500">{stf.username}</p>
                          </td>
                          <td className="px-4 py-3">
                            <div className="inline-flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 font-mono text-xs font-extrabold text-amber-900">
                                <KeyRound className="h-3 w-3 text-amber-600" />
                                {stf.piket_token}
                              </span>
                              <button
                                type="button"
                                onClick={() => setTeacherBarcodeStaffId(stf.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                                title="Lihat Pratinjau & Studio Kartu Barcode Login"
                              >
                                <QrCode className="h-3 w-3" />
                                Lihat Kartu
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const pngUrl = await generateStaffCardPngDataUrl(
                                    {
                                      id: stf.id,
                                      name: stf.name,
                                      role: stf.role,
                                      wilayah: stf.wilayah,
                                      demo_token: stf.piket_token,
                                    },
                                    printSettings.schoolName
                                  );
                                  if (pngUrl) {
                                    const roleSlug = stf.role === 'admin' ? 'admin' : 'guru-piket';
                                    const cleanName = stf.name
                                      .toLowerCase()
                                      .replace(/[^a-z0-9]+/g, '-')
                                      .replace(/^-|-$/g, '');
                                    const link = document.createElement('a');
                                    link.href = pngUrl;
                                    link.download = `kartu-${roleSlug}-${stf.piket_token}-${cleanName}.png`;
                                    document.body.appendChild(link);
                                    link.click();
                                    document.body.removeChild(link);
                                    setFormMsg({
                                      type: 'ok',
                                      text: `Kartu PNG ${stf.name} (${stf.piket_token}) berhasil diunduh.`,
                                    });
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100"
                                title="Unduh langsung Kartu PNG Guru/Admin ini"
                              >
                                <Download className="h-3 w-3" />
                                Kartu .PNG
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await onUpdateStaffToken(stf.id);
                                  if (res.ok) {
                                    setFormMsg({
                                      type: 'ok',
                                      text: `Token barcode untuk ${stf.name} berhasil diacak ulang.`,
                                    });
                                  }
                                }}
                                className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                title="Acak Token Baru"
                              >
                                <RefreshCw className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              {stf.role === 'admin' ? (
                                <span className="inline-flex items-center gap-1 font-bold text-indigo-700">
                                  <Shield className="h-3.5 w-3.5" />
                                  Admin
                                </span>
                              ) : (
                                <span className="font-bold text-slate-700">Guru Piket</span>
                              )}
                              <p className="text-[11px] text-slate-500">
                                {WILAYAH_LABELS[stf.wilayah]}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={async () => {
                                const res = await onToggleStaff(stf.id);
                                if (!res.ok && res.error) {
                                  setFormMsg({ type: 'err', text: res.error });
                                }
                              }}
                              className={`text-xs font-bold disabled:cursor-default ${
                                stf.is_active ? 'text-emerald-700' : 'text-rose-600'
                              }`}
                            >
                              {stf.is_active ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditStaff(stf)}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                              >
                                <Edit3 className="h-3 w-3" />
                                Edit
                              </button>
                              {!isSelf && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const res = await onDeleteStaff(stf.id);
                                    if (!res.ok && res.error) {
                                      setFormMsg({ type: 'err', text: res.error });
                                    }
                                  }}
                                  className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                  title="Hapus akun pegawai"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* TAB 4: KONTROL JENIS & JAM SESI HARIAN & SCHEDULES                  */}
      {/* =================================================================== */}
      {activeTab === 'schedules' && (
        <div className="space-y-6">
          <form
            onSubmit={handleSaveDailySessions}
            className="overflow-hidden rounded-2xl border-2 border-indigo-200 bg-white shadow-sm"
          >
            <div className="flex flex-col gap-3 border-b border-indigo-100 bg-gradient-to-r from-amber-50 via-emerald-50 to-indigo-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-white uppercase">
                  <Clock className="h-3 w-3" />
                  Kontrol Sesi · Ubah &amp; Tambah Jenis dan Jam Sesi Harian
                </span>
                <h3 className="mt-1 text-base font-extrabold text-slate-900">
                  Pengaturan Jenis Sesi, Jam Mulai &amp; Batas Jam Terlambat ({editableSessions.length} Sesi)
                </h3>
                <p className="text-xs text-slate-600">
                  Ubah nama/jenis sesi, jam mulai, dan batas jam telat, atau tambahkan jenis sesi baru di bawah ini.
                </p>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-xs font-extrabold text-white shadow-sm transition-all hover:from-indigo-700 hover:to-blue-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                Simpan Perubahan Sesi
              </button>
            </div>

            {/* Baris Tambah Jenis & Jam Sesi Baru */}
            <div className="border-b border-indigo-100 bg-indigo-50/40 px-5 py-4">
              <p className="text-xs font-extrabold text-indigo-950 uppercase">
                + Tambah Jenis &amp; Jam Sesi Baru
              </p>
              <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                <div className="sm:col-span-5">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Nama / Jenis Sesi Baru
                  </label>
                  <input
                    type="text"
                    value={newMasterSessionLabel}
                    onChange={(e) => setNewMasterSessionLabel(e.target.value)}
                    placeholder="Contoh: Sesi Pagi / Sesi Bimbel Malam"
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-indigo-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Jam Mulai Sesi
                  </label>
                  <input
                    type="time"
                    value={newMasterSessionStart}
                    onChange={(e) => setNewMasterSessionStart(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-900 outline-none focus:border-indigo-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-rose-700">
                    Batas Jam Telat
                  </label>
                  <input
                    type="time"
                    value={newMasterSessionDeadline}
                    onChange={(e) => setNewMasterSessionDeadline(e.target.value)}
                    className="w-full rounded-xl border border-rose-300 bg-rose-50/40 px-3 py-2 font-mono text-xs font-bold text-rose-900 outline-none focus:border-rose-600"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="button"
                    disabled={submitting || !newMasterSessionLabel.trim()}
                    onClick={handleAddMasterCustomSession}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-700 px-3.5 py-2.5 text-xs font-extrabold text-white shadow-xs hover:bg-indigo-800 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Tambah Jenis &amp; Jam Sesi
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
              {editableSessions.map((sess, idx) => {
                const SessionIcon =
                  sess.key === 'siang' ? Sun : sess.key === 'sore' ? Sunset : Moon;
                const badgeGradient =
                  sess.key === 'siang'
                    ? 'from-amber-500 to-orange-500'
                    : sess.key === 'sore'
                    ? 'from-emerald-500 to-teal-600'
                    : 'from-indigo-600 to-violet-600';
                const cardStyle =
                  sess.key === 'siang'
                    ? 'border-amber-200 bg-gradient-to-br from-amber-50/90 to-orange-50/60'
                    : sess.key === 'sore'
                    ? 'border-emerald-200 bg-gradient-to-br from-emerald-50/90 to-teal-50/60'
                    : 'border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-violet-50/60';

                return (
                  <div
                    key={sess.key}
                    className={`rounded-2xl border-2 p-4 transition-all ${cardStyle}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r px-3 py-1 text-xs font-extrabold text-white shadow-xs ${badgeGradient}`}
                      >
                        <SessionIcon className="h-3.5 w-3.5" />
                        {sess.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={sess.is_active}
                            onChange={(e) => {
                              const next = [...editableSessions];
                              next[idx] = { ...sess, is_active: e.target.checked };
                              setEditableSessions(next);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                          Aktif
                        </label>
                        {editableSessions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleDeleteMasterSession(sess.key)}
                            className="rounded-lg border border-rose-200 bg-white/80 p-1 text-rose-600 hover:bg-rose-50"
                            title="Hapus sesi ini"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="mb-1 block text-[11px] font-bold text-slate-600">
                        Nama / Jenis Sesi
                      </label>
                      <input
                        type="text"
                        required
                        value={sess.label}
                        onChange={(e) => {
                          const next = [...editableSessions];
                          next[idx] = { ...sess, label: e.target.value };
                          setEditableSessions(next);
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-extrabold text-slate-900 outline-none focus:border-indigo-600"
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold text-slate-600">
                          Jam Mulai Sesi
                        </label>
                        <input
                          type="time"
                          required
                          value={sess.start_time.slice(0, 5)}
                          onChange={(e) => {
                            const next = [...editableSessions];
                            next[idx] = { ...sess, start_time: e.target.value };
                            setEditableSessions(next);
                          }}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs font-bold text-slate-800 outline-none focus:border-indigo-600"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-extrabold text-rose-700">
                          Batas Jam Telat
                        </label>
                        <input
                          type="time"
                          required
                          value={sess.deadline_time.slice(0, 5)}
                          onChange={(e) => {
                            const next = [...editableSessions];
                            next[idx] = { ...sess, deadline_time: e.target.value };
                            setEditableSessions(next);
                          }}
                          className="w-full rounded-xl border-2 border-rose-300 bg-white px-3 py-2 font-mono text-xs font-extrabold text-rose-800 outline-none focus:border-rose-600"
                        />
                      </div>
                    </div>

                    <p className="mt-3 rounded-lg bg-white/80 px-2.5 py-1.5 text-[11px] font-medium text-slate-600">
                      Kembali lewat pukul{' '}
                      <span className="font-mono font-extrabold text-rose-700">
                        {sess.deadline_time.slice(0, 5)}
                      </span>{' '}
                      otomatis terhitung <strong>Terlambat</strong>.
                    </p>
                  </div>
                );
              })}
            </div>
          </form>

          {/* Regular Activity Schedules CRUD */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <form
                onSubmit={handleScheduleFormSubmit}
                className="space-y-3.5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-extrabold text-slate-900">
                      {editingScheduleId
                        ? 'Ubah (Edit) Jadwal Kegiatan'
                        : 'Tambah Jadwal Kegiatan / Bimbel'}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Daftar kegiatan per kelas untuk referensi peminjaman laptop.
                    </p>
                  </div>
                  {editingScheduleId && (
                    <button
                      type="button"
                      onClick={cancelEditSchedule}
                      className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
                    >
                      Batal Edit
                    </button>
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Peruntukan Kegiatan
                  </label>
                  <select
                    value={purpose}
                    onChange={(e) => {
                      const next = e.target.value as LaptopPurpose;
                      setPurpose(next);
                      setTargetClass(getSuggestedTargetClass(next));
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold outline-none focus:border-blue-600"
                  >
                    {LAPTOP_PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">Hari</label>
                    <select
                      value={dayOfWeek}
                      onChange={(e) => setDayOfWeek(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-blue-600"
                    >
                      {DAYS_ID.map((day, idx) => (
                        <option key={day} value={idx}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Target Kelas
                    </label>
                    <input
                      required
                      type="text"
                      value={targetClass}
                      onChange={(e) => setTargetClass(e.target.value)}
                      placeholder="10 / 11 / 12 / SEMUA"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs uppercase outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Jam Mulai
                    </label>
                    <input
                      required
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Jam Selesai
                    </label>
                    <input
                      required
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:from-blue-700 hover:to-indigo-700"
                >
                  {editingScheduleId ? (
                    <>
                      <Save className="h-4 w-4" />
                      Simpan Perubahan Jadwal
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Simpan Jadwal Kegiatan
                    </>
                  )}
                </button>
              </form>
            </div>

            <div className="lg:col-span-8">
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-extrabold text-slate-900">
                    Jadwal Kegiatan Terdaftar ({schedules.length})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                        <th className="px-5 py-3 font-bold">Peruntukan</th>
                        <th className="px-4 py-3 font-bold">Hari &amp; Jam</th>
                        <th className="px-4 py-3 font-bold">Target Kelas</th>
                        <th className="px-4 py-3 font-bold">Status</th>
                        <th className="px-5 py-3 text-right font-bold">CRUD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {schedules.map((sch) => (
                        <tr key={sch.id} className="transition-colors hover:bg-slate-50/70">
                          <td className="px-5 py-3 font-bold text-slate-900">{sch.purpose}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {DAYS_ID[sch.day_of_week]} ·{' '}
                            <span className="font-mono">
                              {sch.start_time.slice(0, 5)}–{sch.end_time.slice(0, 5)}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700">{sch.target_class}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => onToggleSchedule(sch.id)}
                              className={`text-xs font-bold ${
                                sch.is_active ? 'text-emerald-700' : 'text-slate-400'
                              }`}
                            >
                              {sch.is_active ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => startEditSchedule(sch)}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100"
                              >
                                <Edit3 className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteSchedule(sch.id)}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewModal && (
        <CodePreviewModal
          mode={previewModal.mode}
          student={previewModal.student}
          laptop={previewModal.laptop}
          allStudents={students}
          allLaptops={laptops}
          settings={printSettings}
          onClose={() => setPreviewModal(null)}
        />
      )}

      {suspendTargetStudent && (
        <SuspendStudentModal
          student={suspendTargetStudent}
          onClose={() => setSuspendTargetStudent(null)}
          onConfirmSuspend={onSuspendStudent}
        />
      )}

      {teacherBarcodeStaffId && (
        <TeacherBarcodeModal
          piketOptions={staff.map((stf) => ({
            id: stf.id,
            name: stf.name,
            role: stf.role,
            wilayah: stf.wilayah,
            demo_token: stf.piket_token,
          }))}
          initialPiketId={teacherBarcodeStaffId}
          schoolName={printSettings.schoolName}
          onClose={() => setTeacherBarcodeStaffId(null)}
        />
      )}

      {/* Supabase SQL Script Modal */}
      {sqlModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
          onClick={() => setSqlModalOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  Skrip SQL Database Supabase (Lengkap + 3 Sesi Harian &amp; Token Piket)
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  Mencakup tabel staff (piket_token), students (suspended_until), laptops, daily_sessions (Siang/Sore/Malam), schedules, dan transactions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSqlModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-slate-950 p-4">
              <pre className="font-mono text-xs leading-relaxed text-slate-200">
                {SUPABASE_SQL_SCHEMA}
              </pre>
            </div>
            <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-white px-5 py-3.5">
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {copiedSql ? (
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedSql ? 'Tersalin' : 'Salin SQL'}
              </button>
              <button
                type="button"
                onClick={handleDownloadSql}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800"
              >
                <Download className="h-3.5 w-3.5" />
                Unduh File .sql
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
