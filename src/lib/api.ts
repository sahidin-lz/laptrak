import {
  AppStatePayload,
  AuthUser,
  DailySessionConfig,
  DailySessionKey,
  KioskPersistedState,
  LaptopPurpose,
  PiketOption,
  PiketTicket,
  PrintSettings,
  StaffRole,
  StaffWilayah,
  Transaction,
  TransactionType,
  Wilayah,
} from '../types/models';
import { localBackend } from './localBackend';

let authTokenMemory: string | null = null;
let useLocalServerlessFallback = false;

export function setAuthToken(token: string | null): void {
  authTokenMemory = token;
}

export function getAuthToken(): string | null {
  return authTokenMemory;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  correctedSession?: 'siang' | 'sore' | 'malam' | null;
  correctedLabel?: string | null;
  constructor(
    message: string,
    status: number,
    code?: string,
    correctedSession?: 'siang' | 'sore' | 'malam' | null,
    correctedLabel?: string | null
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.correctedSession = correctedSession;
    this.correctedLabel = correctedLabel;
  }
}

async function requestWithFallback<T>(
  url: string,
  options: RequestInit,
  fallbackFn: () => Promise<T>
): Promise<T> {
  if (useLocalServerlessFallback) {
    return fallbackFn();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'LapTrackClient',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (authTokenMemory) {
    headers.Authorization = `Bearer ${authTokenMemory}`;
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    });

    const contentType = res.headers.get('content-type') || '';

    // On static hosts like Vercel (laptrak.vercel.app), /api/* either returns 404/405
    // or returns text/html (index.html SPA rewrite) instead of application/json.
    if (
      res.status === 404 ||
      res.status === 405 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504 ||
      !contentType.includes('application/json')
    ) {
      useLocalServerlessFallback = true;
      return fallbackFn();
    }

    const data = await res.json().catch(() => null);
    if (!data) {
      useLocalServerlessFallback = true;
      return fallbackFn();
    }

    if (!res.ok) {
      throw new ApiError(
        data.error || 'Terjadi kesalahan saat menghubungi server.',
        res.status,
        data.code,
        data.correctedSession,
        data.correctedLabel
      );
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    // Network error or static hosting without Express server -> seamlessly switch to local + Firebase mode
    useLocalServerlessFallback = true;
    return fallbackFn();
  }
}

export interface AuthStatusResponse {
  needsSetup: boolean;
  adminUsernames: Array<{ name: string; username: string }>;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export interface BorrowPayload {
  studentId: string;
  laptopId: string;
  transactionType: TransactionType;
  dailySession?: DailySessionKey;
  customActivity?: string;
  customDeadlineTime?: string;
  wilayah: Wilayah;
  piketId: string;
  piketToken: string;
  plannedReturnDate?: string;
  homeNote?: string;
}

export const api = {
  getAuthStatus: () =>
    requestWithFallback<AuthStatusResponse>('/api/auth/status', {}, () =>
      localBackend.getAuthStatus()
    ),

  getMe: () =>
    requestWithFallback<{ user: AuthUser | null }>('/api/auth/me', {}, () =>
      localBackend.getMe()
    ),

  claimAdmin: (payload: { username: string; password: string; piketPassword?: string }) =>
    requestWithFallback<LoginResponse>(
      '/api/auth/claim-admin',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.claimAdmin(payload)
    ),

  login: (username: string, password: string) =>
    requestWithFallback<LoginResponse>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      },
      () => localBackend.login(username, password)
    ),

  logout: () =>
    requestWithFallback<{ ok: boolean }>(
      '/api/auth/logout',
      { method: 'POST' },
      () => localBackend.logout()
    ),

  getState: () =>
    requestWithFallback<AppStatePayload>('/api/state', {}, () => localBackend.getState()),

  hydrateState: (bundle: Partial<AppStatePayload>) =>
    requestWithFallback<AppStatePayload>(
      '/api/state/hydrate',
      {
        method: 'POST',
        body: JSON.stringify({ bundle }),
      },
      () => localBackend.hydrateState(bundle)
    ),

  updateKioskState: (patch: Partial<KioskPersistedState>) =>
    requestWithFallback<{ kioskState: KioskPersistedState }>(
      '/api/kiosk-state',
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      () => localBackend.updateKioskState(patch)
    ),

  verifyPiketToken: (piketId: string, piketToken: string) =>
    requestWithFallback<{ ok: boolean; piket: PiketOption }>(
      '/api/piket/verify-token',
      {
        method: 'POST',
        body: JSON.stringify({ piketId, piketToken }),
      },
      () => localBackend.verifyPiketToken(piketId, piketToken)
    ),

  loginPiketByBarcode: (barcode: string) =>
    requestWithFallback<{ ok: boolean; ticket: PiketTicket; kioskState: KioskPersistedState }>(
      '/api/piket/barcode-login',
      {
        method: 'POST',
        body: JSON.stringify({ barcode }),
      },
      () => localBackend.loginPiketByBarcode(barcode)
    ),

  borrowLaptop: (payload: BorrowPayload) =>
    requestWithFallback<{ transaction: Transaction; state: AppStatePayload }>(
      '/api/transactions/borrow',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.borrowLaptop(payload)
    ),

  returnLaptop: (
    studentId: string,
    laptopId: string,
    simulateLateMinutes = 0,
    piketId?: string,
    piketToken?: string
  ) =>
    requestWithFallback<{
      transaction: Transaction | null;
      isLate: boolean;
      lateMinutes: number;
      returnedType: TransactionType;
      studentLateCount: number;
      newlySuspended: boolean;
      state: AppStatePayload;
    }>(
      '/api/transactions/return',
      {
        method: 'POST',
        body: JSON.stringify({ studentId, laptopId, simulateLateMinutes, piketId, piketToken }),
      },
      () =>
        localBackend.returnLaptop(
          studentId,
          laptopId,
          simulateLateMinutes,
          piketId,
          piketToken
        )
    ),

  addStudent: (payload: {
    name: string;
    class: string;
    wilayah: Wilayah;
    photo_url: string | null;
  }) =>
    requestWithFallback<{ student: { student_code: string; name: string }; state: AppStatePayload }>(
      '/api/students',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.addStudent(payload)
    ),

  updateStudent: (
    studentId: string,
    payload: {
      name: string;
      class: string;
      wilayah: Wilayah;
      photo_url?: string | null;
    }
  ) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/students/${studentId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      () => localBackend.updateStudent(studentId, payload)
    ),

  bulkAddStudents: (
    rows: Array<{
      name: string;
      class: string;
      wilayah?: Wilayah;
      laptop_code?: string;
      laptop_brand?: string;
      photo_url?: string | null;
    }>
  ) =>
    requestWithFallback<{
      createdStudents: number;
      createdLaptops: number;
      state: AppStatePayload;
    }>(
      '/api/students/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      },
      () => localBackend.bulkAddStudents(rows)
    ),

  suspendStudent: (
    studentId: string,
    payload: { suspended_until: string; reason?: string }
  ) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/students/${studentId}/suspend`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.suspendStudent(studentId, payload)
    ),

  resetStudentSanction: (studentId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/students/${studentId}/reset-sanction`,
      {
        method: 'POST',
      },
      () => localBackend.resetStudentSanction(studentId)
    ),

  deleteStudent: (studentId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/students/${studentId}`,
      {
        method: 'DELETE',
      },
      () => localBackend.deleteStudent(studentId)
    ),

  addLaptop: (payload: {
    asset_code: string;
    brand_model: string;
    assigned_student_id: string | null;
  }) =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/laptops',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.addLaptop(payload)
    ),

  updateLaptop: (
    laptopId: string,
    payload: {
      asset_code: string;
      brand_model: string;
      assigned_student_id: string | null;
    }
  ) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/laptops/${laptopId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      () => localBackend.updateLaptop(laptopId, payload)
    ),

  bulkAddLaptops: (
    rows: Array<{
      asset_code: string;
      brand_model: string;
      student_code?: string;
    }>
  ) =>
    requestWithFallback<{
      createdLaptops: number;
      updatedLaptops: number;
      state: AppStatePayload;
    }>(
      '/api/laptops/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      },
      () => localBackend.bulkAddLaptops(rows)
    ),

  assignLaptop: (laptopId: string, studentId: string | null) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/laptops/${laptopId}/assign`,
      {
        method: 'PATCH',
        body: JSON.stringify({ studentId }),
      },
      () => localBackend.assignLaptop(laptopId, studentId)
    ),

  deleteLaptop: (laptopId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/laptops/${laptopId}`,
      {
        method: 'DELETE',
      },
      () => localBackend.deleteLaptop(laptopId)
    ),

  updateDailySessions: (sessions: DailySessionConfig[]) =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/settings/daily-sessions',
      {
        method: 'PATCH',
        body: JSON.stringify({ sessions }),
      },
      () => localBackend.updateDailySessions(sessions)
    ),

  addSchedule: (payload: {
    purpose: LaptopPurpose;
    target_class: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }) =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/schedules',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.addSchedule(payload)
    ),

  updateSchedule: (
    scheduleId: string,
    payload: {
      purpose: LaptopPurpose;
      target_class: string;
      day_of_week: number;
      start_time: string;
      end_time: string;
    }
  ) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/schedules/${scheduleId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      () => localBackend.updateSchedule(scheduleId, payload)
    ),

  toggleSchedule: (scheduleId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/schedules/${scheduleId}/toggle`,
      {
        method: 'PATCH',
      },
      () => localBackend.toggleSchedule(scheduleId)
    ),

  deleteSchedule: (scheduleId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/schedules/${scheduleId}`,
      {
        method: 'DELETE',
      },
      () => localBackend.deleteSchedule(scheduleId)
    ),

  addStaff: (payload: {
    name: string;
    username: string;
    password: string;
    role: StaffRole;
    wilayah: StaffWilayah;
    piket_token?: string;
  }) =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/staff',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      () => localBackend.addStaff(payload)
    ),

  updateStaff: (
    staffId: string,
    payload: {
      name: string;
      username: string;
      piket_token: string;
      role: StaffRole;
      wilayah: StaffWilayah;
      password?: string;
    }
  ) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/staff/${staffId}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      () => localBackend.updateStaff(staffId, payload)
    ),

  bulkAddStaff: (
    rows: Array<{
      name: string;
      username: string;
      piket_token: string;
      wilayah: StaffWilayah;
      role: StaffRole;
      password?: string;
    }>
  ) =>
    requestWithFallback<{
      createdStaff: number;
      updatedStaff: number;
      state: AppStatePayload;
    }>(
      '/api/staff/bulk',
      {
        method: 'POST',
        body: JSON.stringify({ rows }),
      },
      () => localBackend.bulkAddStaff(rows)
    ),

  updateStaffToken: (staffId: string, piket_token?: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/staff/${staffId}/token`,
      {
        method: 'PATCH',
        body: JSON.stringify({ piket_token }),
      },
      () => localBackend.updateStaffToken(staffId, piket_token)
    ),

  toggleStaff: (staffId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/staff/${staffId}/toggle`,
      {
        method: 'PATCH',
      },
      () => localBackend.toggleStaff(staffId)
    ),

  deleteStaff: (staffId: string) =>
    requestWithFallback<{ state: AppStatePayload }>(
      `/api/staff/${staffId}`,
      {
        method: 'DELETE',
      },
      () => localBackend.deleteStaff(staffId)
    ),

  updatePrintSettings: (patch: Partial<PrintSettings>) =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/settings/print',
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      () => localBackend.updatePrintSettings(patch)
    ),

  resetDemo: () =>
    requestWithFallback<{ state: AppStatePayload }>(
      '/api/admin/reset-demo',
      {
        method: 'POST',
      },
      () => localBackend.resetDemo()
    ),
};
