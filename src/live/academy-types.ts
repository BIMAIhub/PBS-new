export interface CertificateTemplate {
  courseId: string; title: string; issuer: string; signer: string; signerRole: string;
  design: 'architectural' | 'classic' | 'minimal'; primaryColor: string; accentColor: string;
}
export interface CertificateRecord {
  id: string; studentId: string; courseId: string; studentName: string; courseTitle: string;
  score: number; issuedAt: string; publicToken: string; published: boolean; revokedAt: string;
  historical?: { completedAt:string; mode:string; originalNumber:string; qualification:string; scoreRecorded:boolean; hasOriginal:boolean };
  template: CertificateTemplate;
}
export interface Reminder {
  id: string; enrollmentId: string; channel: string; status: string; body: string; sentAt: string; error: string;
}
export interface EnrollmentDetail { enrollmentId: string; dueDate: string; source: string; internalNote?: string }
export interface AccessGrant { enrollmentId: string; email: string; status: string; error: string; updatedAt: string; webUrl: string }
export interface AcademyData {
  certificates: CertificateRecord[]; reminders: Reminder[]; details: EnrollmentDetail[]; grants: AccessGrant[];
}
export interface AdminAcademyData extends AcademyData {
  payment: { paymentUpiId: string; paymentName: string }; events: AcademyEvent[];
}
export interface AcademyEvent { id: string; actor: string; action: string; targetId: string; detail: string; createdAt: string }
export interface CourseStorage { courseId: string; driveId: string; itemId: string; itemName: string; webUrl: string; automatic: boolean; connected: boolean }
export interface IntegrationStatus {
  encryptionReady: boolean; configured: boolean; clientId: string; tenant: string; secretSaved: boolean;
  redirectUri: string; connected?: { email: string; name: string; connectedAt: string };
  mail: {clientId:string;tenant:string;secretSaved:boolean;configured:boolean;connected?:{email:string;name:string;connectedAt:string}};
  storage: CourseStorage[];
}
