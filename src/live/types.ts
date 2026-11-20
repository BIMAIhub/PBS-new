export type Role = 'admin' | 'student';
export type EnrollmentStatus = 'pending' | 'approved' | 'rejected';

export interface Account {
  id: string;
  role: Role;
  name: string;
  email: string;
  phone: string;
  rollNumber: string;
  createdAt: string;
  mustChangePassword: boolean;
}

export interface CourseSummary {
  id: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  schedule: string;
  fee: number;
  published: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  duration: string;
  description: string;
  playback: { kind: 'video' | 'embed' | 'link'; url: string; source?: string };
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
}

export interface CourseResource {
  id: string;
  title: string;
  url: string;
}

export interface LiveSession {
  id: string;
  title: string;
  startsAt: string;
  url: string;
}

export interface Course extends CourseSummary {
  modules: Module[];
  resources: CourseResource[];
  sessions: LiveSession[];
  assessmentAvailable: boolean;
}

export interface Enrollment {
  id: string;
  studentId: string;
  studentName: string;
  email: string;
  courseId: string;
  courseTitle: string;
  status: EnrollmentStatus;
  total: number;
  paid: number;
  requestedPayment: number;
  reference: string;
  submittedAt: string;
  approvedAt: string;
  notes: string;
}

export interface Receipt {
  id: string;
  number: string;
  studentId: string;
  studentName: string;
  courseTitle: string;
  enrollmentId: string;
  amount: number;
  method: string;
  reference: string;
  issuedAt: string;
}

export interface StudentRecord extends Account {
  enrollments: Enrollment[];
  receipts: Receipt[];
  completedLessons: number;
  placement?: { status: string; targetRole: string; notes: string };
}

export interface Completion {
  courseId: string;
  lessonId: string;
}

export interface Assignment {
  id: string;
  studentId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  url: string;
  note: string;
  feedback: string;
  submittedAt: string;
  reviewedAt: string;
}

export interface Message {
  id: string;
  studentId: string;
  studentName: string;
  sender: Role;
  subject: string;
  body: string;
  sentAt: string;
}

export interface AssessmentQuestion {
  prompt: string;
  options: string[];
  answer: number;
}

export interface AssessmentResult {
  courseId: string;
  score: number;
  passed: boolean;
  submittedAt: string;
}

export interface Portfolio {
  headline: string;
  bio: string;
  projectUrl: string;
  published: boolean;
  linkedin?: string;
  github?: string;
  website?: string;
}

export interface StudentWorkspaceData {
  enrollments: Enrollment[];
  receipts: Receipt[];
  courses: Course[];
  completions: Completion[];
  assignments: Assignment[];
  messages: Message[];
  assessmentResults: AssessmentResult[];
  portfolio: Portfolio;
}

export interface AdminWorkspaceData {
  students: StudentRecord[];
  courses: Course[];
  enrollments: Enrollment[];
  receipts: Receipt[];
  assignments: Assignment[];
  messages: Message[];
}

export interface Catalog {
  courses: CourseSummary[];
  paymentUpiId: string;
  paymentName: string;
}
