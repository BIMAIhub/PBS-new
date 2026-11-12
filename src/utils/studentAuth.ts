/**
 * Student & Admin Authentication Registry Utility
 * Manages institutional credentials, role detection (Admin vs Student),
 * password verification, password updates, and persistent state.
 */

import { ManagedStudent, pbsAdminStore } from './pbsAdminStore';

export interface StudentAuthRecord {
  studentId: string;
  rollNumber: string;
  fullName: string;
  institutionalEmail: string;
  personalEmail: string;
  phone: string;
  defaultPasswordHint: string;
  hasCustomPassword: boolean;
  lastPasswordChanged: string;
  specializationTrack: string;
  batchMonthYear: string; // e.g. "09/2026"
  attendancePercent: number;
  capstoneStatus: string;
  totalFee: number;
  paidFee: number;
  pendingFee: number;
  iso19650Code: string;
  placementStatus?: string;
  interviewReadiness?: string;
}

export type UserRole = 'student' | 'admin';

export interface AuthResult {
  success: boolean;
  role?: UserRole;
  user?: ActiveSessionUser;
  message: string;
  localOnly?: boolean;
}

export interface ActiveSessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar: string;
  phone?: string;
  studentId?: string;
  rollNumber?: string;
  specialization?: string;
  batch?: string;
  googleEmailId?: string;
}

const DEFAULT_STUDENT_EMAIL = 'student.demo@example.com';
const DEFAULT_STUDENT_PASSWORD = 'DemoStudent2026';

const DEFAULT_ADMIN_EMAIL = 'admin.demo@example.com';
const DEFAULT_ADMIN_PASSWORD = 'DemoAdmin2026';

const STORAGE_STUDENT_PWD_KEY = 'pbs_student_custom_password';
const STORAGE_ADMIN_PWD_KEY = 'pbs_admin_custom_password';
const STORAGE_PWD_CHANGED_KEY = 'pbs_student_password_changed_date';
const STORAGE_AUTH_USER_KEY = 'pbs_active_authenticated_user';
const STORAGE_AUTH_LOGGED_IN_KEY = 'pbs_is_logged_in_state';

function getSessionStorage(): Storage {
  return sessionStorage.getItem(STORAGE_AUTH_LOGGED_IN_KEY) === 'true'
    ? sessionStorage
    : localStorage;
}

function toStudentSession(student: ManagedStudent): ActiveSessionUser {
  return {
    id: student.id || student.studentId,
    studentId: student.studentId,
    rollNumber: student.rollNumber,
    name: student.name,
    email: student.email,
    role: 'student',
    avatar: student.avatar,
    phone: student.phone,
    specialization: student.specialization,
    batch: student.batch,
    googleEmailId: student.googleEmailId,
  };
}

export const studentAuthUtil = {
  defaultEmail: DEFAULT_STUDENT_EMAIL,
  defaultPassword: DEFAULT_STUDENT_PASSWORD,
  adminEmail: DEFAULT_ADMIN_EMAIL,
  adminPassword: DEFAULT_ADMIN_PASSWORD,

  /**
   * Retrieves the active student password (custom if updated, else system default)
   */
  getActivePassword(): string {
    try {
      const customPwd = localStorage.getItem(STORAGE_STUDENT_PWD_KEY);
      if (customPwd && customPwd.trim().length > 0) {
        return customPwd;
      }
    } catch (e) {
      console.warn('Could not read custom password from storage:', e);
    }
    return DEFAULT_STUDENT_PASSWORD;
  },

  /**
   * Retrieves active admin password
   */
  getActiveAdminPassword(): string {
    try {
      const customPwd = localStorage.getItem(STORAGE_ADMIN_PWD_KEY);
      if (customPwd && customPwd.trim().length > 0) {
        return customPwd;
      }
    } catch {
      // fallback
    }
    return DEFAULT_ADMIN_PASSWORD;
  },

  /**
   * Check if the student has set a custom password
   */
  hasCustomPassword(): boolean {
    try {
      const customPwd = localStorage.getItem(STORAGE_STUDENT_PWD_KEY);
      return Boolean(customPwd && customPwd !== DEFAULT_STUDENT_PASSWORD);
    } catch {
      return false;
    }
  },

  /**
   * Returns when the password was last updated
   */
  getLastPasswordChangeDate(): string {
    try {
      const saved = localStorage.getItem(STORAGE_PWD_CHANGED_KEY);
      if (saved) return saved;
    } catch {}
    return 'Default Provisioned (Sept 01, 2026)';
  },

  /**
   * Verify input email & password for either Student or Admin
   */
  verifyCredentials(emailInput: string, passwordInput: string): AuthResult {
    const identifier = emailInput.trim().toLowerCase();
    const password = passwordInput.trim();
    const invalid = { success: false, message: 'Check your sign-in details and try again.' };
    if (!identifier || !password) return invalid;

    if (identifier === DEFAULT_ADMIN_EMAIL) {
      if (password !== this.getActiveAdminPassword()) return { ...invalid, localOnly: true };
      return {
        success: true,
        role: 'admin',
        message: 'Administrator signed in.',
        user: {
          id: 'pbs-admin-super-01',
          name: 'PBS Administrator',
          email: DEFAULT_ADMIN_EMAIL,
          role: 'admin',
          avatar: '',
        },
      };
    }

    const student = pbsAdminStore.getStudents().find(record =>
      [record.email, record.personalEmail, record.googleEmailId, record.studentId, record.rollNumber]
        .some(value => value?.trim().toLowerCase() === identifier)
    ) ?? (identifier.includes('@') ? null : pbsAdminStore.getStudentByQuery(identifier));

    if (student) {
      const isDemo = student.email.toLowerCase() === DEFAULT_STUDENT_EMAIL;
      const localOnly = isDemo && this.hasCustomPassword();
      const expected = localOnly ? this.getActivePassword() :
        student.password || pbsAdminStore.generateStudentDefaultPassword(student.name);
      if (password !== expected) return { ...invalid, localOnly };
      return { success: true, role: 'student', user: toStudentSession(student), message: 'Student signed in.' };
    }

    return invalid;
  },

  /** Verify an account against the server when it is absent from the local store. */
  async verifyCredentialsAsync(emailOrRoll: string, passwordInput: string): Promise<AuthResult> {
    const local = this.verifyCredentials(emailOrRoll, passwordInput);
    if (local.success || local.localOnly || !passwordInput.trim()) return local;

    try {
      const response = await fetch('/api/db/verify-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrRoll, password: passwordInput }),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.passwordValid === true && result.student) {
          return {
            success: true,
            role: 'student',
            user: toStudentSession(result.student),
            message: 'Student signed in.',
          };
        }
      }
    } catch (error) {
      console.warn('Student verification request failed:', error);
    }
    return local;
  },

  /**
   * Update student password and update storage / timestamp
   */
  updatePassword(oldPasswordInput: string, newPasswordInput: string): { success: boolean; message: string } {
    const currentPwd = this.getActivePassword();

    if (oldPasswordInput.trim() !== currentPwd) {
      return {
        success: false,
        message: 'Current password is incorrect. Please re-enter your existing password.'
      };
    }

    if (!newPasswordInput || newPasswordInput.length < 6) {
      return {
        success: false,
        message: 'New password must be at least 6 characters long.'
      };
    }

    try {
      localStorage.setItem(STORAGE_STUDENT_PWD_KEY, newPasswordInput.trim());
      const nowFormatted = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      localStorage.setItem(STORAGE_PWD_CHANGED_KEY, nowFormatted);
      return {
        success: true,
        message: 'Password changed successfully! Stored for future student login.'
      };
    } catch (e) {
      return {
        success: false,
        message: 'Failed to save updated password to local cache.'
      };
    }
  },

  /**
   * Set custom password directly for a student from admin
   */
  setStudentPasswordByAdmin(newPassword: string): boolean {
    try {
      localStorage.setItem(STORAGE_STUDENT_PWD_KEY, newPassword.trim());
      const nowFormatted = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      localStorage.setItem(STORAGE_PWD_CHANGED_KEY, nowFormatted);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Active User Session persistence
   */
  getActiveUser(): ActiveSessionUser {
    try {
      const stored = getSessionStorage().getItem(STORAGE_AUTH_USER_KEY);
      if (stored) return JSON.parse(stored);
    } catch {}
    // Default to the demo student profile
    return {
      id: 'user-student-pravin',
      name: 'Demo Student',
      email: DEFAULT_STUDENT_EMAIL,
      role: 'student',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
      phone: ''
    };
  },

  updateCurrentUser(updates: Partial<ActiveSessionUser>): boolean {
    try {
      const current = this.getActiveUser();
      const updated = { ...current, ...updates };
      getSessionStorage().setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(updated));
      return true;
    } catch (e) {
      console.warn('Failed to update current user session', e);
      return false;
    }
  },

  setActiveUser(user: ActiveSessionUser, rememberSession = true): void {
    try {
      const storage = rememberSession ? localStorage : sessionStorage;
      const otherStorage = rememberSession ? sessionStorage : localStorage;
      otherStorage.removeItem(STORAGE_AUTH_LOGGED_IN_KEY);
      otherStorage.removeItem(STORAGE_AUTH_USER_KEY);
      storage.setItem(STORAGE_AUTH_USER_KEY, JSON.stringify(user));
      storage.setItem(STORAGE_AUTH_LOGGED_IN_KEY, 'true');
      window.dispatchEvent(new CustomEvent('pbs_store_updated', { detail: { eventType: 'auth_changed', user } }));
    } catch {}
  },

  isLoggedIn(): boolean {
    try {
      return getSessionStorage().getItem(STORAGE_AUTH_LOGGED_IN_KEY) === 'true';
    } catch {
      return false;
    }
  },

  setLoggedIn(state: boolean): void {
    try {
      if (state) {
        getSessionStorage().setItem(STORAGE_AUTH_LOGGED_IN_KEY, 'true');
      } else {
        for (const storage of [localStorage, sessionStorage]) {
          storage.removeItem(STORAGE_AUTH_LOGGED_IN_KEY);
          storage.removeItem(STORAGE_AUTH_USER_KEY);
        }
      }
      window.dispatchEvent(new CustomEvent('pbs_store_updated', { detail: { eventType: 'auth_changed', state } }));
    } catch {}
  },

  /**
   * Generate student record for Excel / CSV export and in-app viewing
   */
  getStudentRecord(): StudentAuthRecord {
    const hasCustom = this.hasCustomPassword();
    return {
      studentId: 'PBS-STU-2026-8492',
      rollNumber: 'PBS/2026/BIM-084',
      fullName: 'Demo Student',
      institutionalEmail: DEFAULT_STUDENT_EMAIL,
      personalEmail: 'student.contact@example.com',
      phone: '',
      defaultPasswordHint: hasCustom ? '●●●●●●●● (Custom User Updated)' : 'DemoStudent2026 (Default System)',
      hasCustomPassword: hasCustom,
      lastPasswordChanged: this.getLastPasswordChangeDate(),
      specializationTrack: 'Autodesk Revit MEP Masterclass (LOD 300 - 500)',
      batchMonthYear: '09/2026 (Sept 2026 Weekend Batch)',
      attendancePercent: 96.4,
      capstoneStatus: 'Stage 3: Navisworks Clash Matrix Submitted',
      totalFee: 41997,
      paidFee: 34498,
      pendingFee: 7499,
      iso19650Code: 'PBS-ISO-19650-VERIFIED-2026',
      placementStatus: 'Shortlisted for MNC Interview (Atkins / WSP)',
      interviewReadiness: 'Ready for Senior BIM Coordinator Role'
    };
  },

  /**
   * Export structured Student Record to Excel CSV
   */
  exportToExcelCSV(): void {
    const r = this.getStudentRecord();
    const headers = [
      'Student ID',
      'Roll Number',
      'Full Name',
      'Institutional Email',
      'Personal Email',
      'Phone Number',
      'Password Security Status',
      'Last Password Changed',
      'Specialization Track',
      'Batch Month/Year',
      'Attendance Rate',
      'Capstone Progress',
      'Total Fee (INR)',
      'Paid Fee (INR)',
      'Pending Balance (INR)',
      'ISO 19650 Verification Code',
      'Placement Assistance Status',
      'Interview Readiness'
    ];

    const row = [
      `"${r.studentId}"`,
      `"${r.rollNumber}"`,
      `"${r.fullName}"`,
      `"${r.institutionalEmail}"`,
      `"${r.personalEmail}"`,
      `"${r.phone}"`,
      `"${r.defaultPasswordHint}"`,
      `"${r.lastPasswordChanged}"`,
      `"${r.specializationTrack}"`,
      `"${r.batchMonthYear}"`,
      `"${r.attendancePercent}%"`,
      `"${r.capstoneStatus}"`,
      r.totalFee,
      r.paidFee,
      r.pendingFee,
      `"${r.iso19650Code}"`,
      `"${r.placementStatus || 'In Progress'}"`,
      `"${r.interviewReadiness || 'Level 4'}"`
    ];

    const csvContent = '\uFEFF' + [headers.join(','), row.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `PBS_Student_Registry_${r.studentId}_${r.fullName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

function currentStudentStudentPwd(cleanPwd: string, currentStudentPwd: string): string {
  if (cleanPwd === currentStudentPwd) return cleanPwd;
  if (cleanPwd === DEFAULT_STUDENT_PASSWORD) return cleanPwd;
  return currentStudentPwd;
}
