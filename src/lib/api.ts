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

let authTokenMemory: string | null = null;

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

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'LapTrackClient',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (authTokenMemory) {
    headers.Authorization = `Bearer ${authTokenMemory}`;
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
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
  getAuthStatus: () => request<AuthStatusResponse>('/api/auth/status'),

  getMe: () => request<{ user: AuthUser | null }>('/api/auth/me'),

  claimAdmin: (payload: { username: string; password: string; piketPassword?: string }) =>
    request<LoginResponse>('/api/auth/claim-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (username: string, password: string) =>
    request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  getState: () => request<AppStatePayload>('/api/state'),

  hydrateState: (bundle: Partial<AppStatePayload>) =>
    request<AppStatePayload>('/api/state/hydrate', {
      method: 'POST',
      body: JSON.stringify({ bundle }),
    }),

  updateKioskState: (patch: Partial<KioskPersistedState>) =>
    request<{ kioskState: KioskPersistedState }>('/api/kiosk-state', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  verifyPiketToken: (piketId: string, piketToken: string) =>
    request<{ ok: boolean; piket: PiketOption }>('/api/piket/verify-token', {
      method: 'POST',
      body: JSON.stringify({ piketId, piketToken }),
    }),

  loginPiketByBarcode: (barcode: string) =>
    request<{ ok: boolean; ticket: PiketTicket; kioskState: KioskPersistedState }>(
      '/api/piket/barcode-login',
      {
        method: 'POST',
        body: JSON.stringify({ barcode }),
      }
    ),

  borrowLaptop: (payload: BorrowPayload) =>
    request<{ transaction: Transaction; state: AppStatePayload }>('/api/transactions/borrow', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  returnLaptop: (
    studentId: string,
    laptopId: string,
    simulateLateMinutes = 0,
    piketId?: string,
    piketToken?: string
  ) =>
    request<{
      transaction: Transaction | null;
      isLate: boolean;
      lateMinutes: number;
      returnedType: TransactionType;
      studentLateCount: number;
      newlySuspended: boolean;
      state: AppStatePayload;
    }>('/api/transactions/return', {
      method: 'POST',
      body: JSON.stringify({ studentId, laptopId, simulateLateMinutes, piketId, piketToken }),
    }),

  addStudent: (payload: {
    name: string;
    class: string;
    wilayah: Wilayah;
    photo_url: string | null;
  }) =>
    request<{ student: { student_code: string; name: string }; state: AppStatePayload }>(
      '/api/students',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
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
    request<{ state: AppStatePayload }>(`/api/students/${studentId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

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
    request<{
      createdStudents: number;
      createdLaptops: number;
      state: AppStatePayload;
    }>('/api/students/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),

  suspendStudent: (
    studentId: string,
    payload: { suspended_until: string; reason?: string }
  ) =>
    request<{ state: AppStatePayload }>(`/api/students/${studentId}/suspend`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resetStudentSanction: (studentId: string) =>
    request<{ state: AppStatePayload }>(`/api/students/${studentId}/reset-sanction`, {
      method: 'POST',
    }),

  deleteStudent: (studentId: string) =>
    request<{ state: AppStatePayload }>(`/api/students/${studentId}`, {
      method: 'DELETE',
    }),

  addLaptop: (payload: {
    asset_code: string;
    brand_model: string;
    assigned_student_id: string | null;
  }) =>
    request<{ state: AppStatePayload }>('/api/laptops', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateLaptop: (
    laptopId: string,
    payload: {
      asset_code: string;
      brand_model: string;
      assigned_student_id: string | null;
    }
  ) =>
    request<{ state: AppStatePayload }>(`/api/laptops/${laptopId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  bulkAddLaptops: (
    rows: Array<{
      asset_code: string;
      brand_model: string;
      student_code?: string;
    }>
  ) =>
    request<{
      createdLaptops: number;
      updatedLaptops: number;
      state: AppStatePayload;
    }>('/api/laptops/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),

  assignLaptop: (laptopId: string, studentId: string | null) =>
    request<{ state: AppStatePayload }>(`/api/laptops/${laptopId}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ studentId }),
    }),

  deleteLaptop: (laptopId: string) =>
    request<{ state: AppStatePayload }>(`/api/laptops/${laptopId}`, {
      method: 'DELETE',
    }),

  updateDailySessions: (sessions: DailySessionConfig[]) =>
    request<{ state: AppStatePayload }>('/api/settings/daily-sessions', {
      method: 'PATCH',
      body: JSON.stringify({ sessions }),
    }),

  addSchedule: (payload: {
    purpose: LaptopPurpose;
    target_class: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }) =>
    request<{ state: AppStatePayload }>('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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
    request<{ state: AppStatePayload }>(`/api/schedules/${scheduleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggleSchedule: (scheduleId: string) =>
    request<{ state: AppStatePayload }>(`/api/schedules/${scheduleId}/toggle`, {
      method: 'PATCH',
    }),

  deleteSchedule: (scheduleId: string) =>
    request<{ state: AppStatePayload }>(`/api/schedules/${scheduleId}`, {
      method: 'DELETE',
    }),

  addStaff: (payload: {
    name: string;
    username: string;
    password: string;
    role: StaffRole;
    wilayah: StaffWilayah;
    piket_token?: string;
  }) =>
    request<{ state: AppStatePayload }>('/api/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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
    request<{ state: AppStatePayload }>(`/api/staff/${staffId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

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
    request<{
      createdStaff: number;
      updatedStaff: number;
      state: AppStatePayload;
    }>('/api/staff/bulk', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),

  updateStaffToken: (staffId: string, piket_token?: string) =>
    request<{ state: AppStatePayload }>(`/api/staff/${staffId}/token`, {
      method: 'PATCH',
      body: JSON.stringify({ piket_token }),
    }),

  toggleStaff: (staffId: string) =>
    request<{ state: AppStatePayload }>(`/api/staff/${staffId}/toggle`, {
      method: 'PATCH',
    }),

  deleteStaff: (staffId: string) =>
    request<{ state: AppStatePayload }>(`/api/staff/${staffId}`, {
      method: 'DELETE',
    }),

  updatePrintSettings: (patch: Partial<PrintSettings>) =>
    request<{ state: AppStatePayload }>('/api/settings/print', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  resetDemo: () =>
    request<{ state: AppStatePayload }>('/api/admin/reset-demo', {
      method: 'POST',
    }),
};
