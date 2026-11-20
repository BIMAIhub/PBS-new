export type AttendanceStatus = 'pending' | 'present' | 'partial' | 'absent' | 'excused';
export interface ClassAttendance {
  firstJoinedAt: string; lastJoinedAt: string; joinCount: number;
  status: AttendanceStatus; minutes: number; points: number; verifiedAt: string; source: string;
}
export interface LiveClass {
  id: string; courseId: string; courseTitle: string; title: string; description: string;
  startsAt: string; endsAt: string; joinBefore: number; points: number; minimumMinutes: number;
  status: 'scheduled' | 'cancelled'; published: boolean; accessConfirmed: boolean; revision: string;
  state: 'upcoming' | 'open' | 'ended' | 'cancelled' | 'unavailable'; joinOpensAt: string;
  attendance?: ClassAttendance; meetUrl?: string; enrolled?: number; portalJoins?: number; confirmed?: number;
}
export interface StudentLiveData { classes: LiveClass[]; serverTime: string; points: number; attended: number }
export interface AttendanceRow extends ClassAttendance { studentId: string; studentName: string; email: string; eligible: boolean }
export interface AttendancePreview { rows: { studentId: string; studentName: string; email: string; minutes: number; status: AttendanceStatus; points: number }[]; skipped: number; applied: boolean }
