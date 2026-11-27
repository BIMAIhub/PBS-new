export interface ReferralProgram {
  enabled: boolean; autoCredit: boolean; bankPayoutsEnabled: boolean; rewardAmount: number; waitDays: number; minimumFee: number;
  requireReferrerPaid: boolean; requireStudentPaid: boolean; friendDiscountPercent: number; revision: string;
}
export interface ReferralProgress {
  id: string; name: string; courseTitle: string; status: 'pending' | 'holding' | 'eligible' | 'credited' | 'void';
  amount: number; approved: boolean; referrerPaid: boolean; studentPaid: boolean; qualifiedAt: string;
  eligibleAt: string; creditedAt: string; createdAt: string; reason: string;
  waitDays: number; requireReferrerPaid: boolean; requireStudentPaid: boolean;
}
export interface WalletEntry { id: string; amount: number; kind: string; note: string; createdAt: string }
export interface ReferralDashboard {
  program: ReferralProgram; code: string; referrals: ReferralProgress[]; balance: number; earned: number;
  total: number; credited: number; waiting: number; entries: WalletEntry[];
}
export type MailTemplateId = 'app_guide' | 'app_launch' | 'announcement' | 'welcome' | 'login' | 'portal_guide' | 'payment_reminder' | 'certificate' | 'referral_credit' | 'payout_paid' | 'offer' | 'update' | 'custom';
export interface MailTemplate { id: MailTemplateId; label: string; subject: string; body: string; marketing: boolean }
export interface MailAutomation { enabled: boolean; senderId: string; welcome: boolean; certificate: boolean; referral_credit: boolean; payout_paid:boolean }
export interface MailCampaign { id: string; title: string; status: string; subject: string; body: string; message: string; templateId: MailTemplateId; total: number; accepted: number; failed: number; pending: number; skipped: number; uncertain: number; createdAt: string; revision: string }
export interface MailDelivery { id: string; email: string; name: string; status: string; error: string; createdAt: string; sentAt: string; subject: string }
