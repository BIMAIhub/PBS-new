import type { Account, Enrollment, Receipt } from './types';

export interface AccessPackage {
  studentId: string; name: string; email: string; phone: string; whatsappNumber: string;
  signInUrl: string; password?: string; subject: string; body: string;
}
export interface AccessDelivery { id?: string; status: 'accepted' | 'failed' | 'unknown' | 'pending' | 'unconfigured'; error?: string }
export interface AdmissionResult { enrollment: Enrollment; account: Account; application: { code: string; email: string; status: string } }
export interface EnrollmentDecision { enrollment: Enrollment; receipt?: Receipt; access?: AccessPackage; delivery?: AccessDelivery }
export interface LearnerCommunity {
  historicalLearners: number; approvedLearners: number; approvedEnrollments: number;
  placementAssistance: boolean; placementNote: string;
}
export interface CourseFeedback {
  id: string; courseId: string; courseTitle: string; studentName: string; qualification: string; photoDataUrl: string;
  completedAt: string; placed: boolean; company: string; courseRating: number; websiteRating: number;
  body: string; websiteFeedback: string; consent: boolean; status: 'pending' | 'private' | 'published';
  reply: string; submittedAt: string; reviewedAt: string; revision: string;
}
export type PublicFeedback = Pick<CourseFeedback, 'id' | 'courseId' | 'courseTitle' | 'studentName' | 'qualification' | 'photoDataUrl' | 'completedAt' | 'placed' | 'company' | 'courseRating' | 'body' | 'reply'>;
export interface StudentFeedbackData { feedback: CourseFeedback[]; eligible: { courseId: string; courseTitle: string; completedAt: string }[] }
