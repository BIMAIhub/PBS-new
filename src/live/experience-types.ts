export interface Promotion {
  id: string; title: string; description: string; kind: 'public' | 'coupon' | 'referral'; code: string;
  percent: number; courseId: string; ownerId: string; assignedEmail: string; active: boolean;
  startsAt: string; endsAt: string; maxUses: number; uses: number;
}
export interface PriceQuote { listPrice: number; discount: number; total: number; promotionId: string; promotionTitle: string; code: string; percent: number }
export interface CoursePage { level: string; duration: string; audience: string; outcomes: string[]; requirements: string[] }
export interface CourseOutline { id: string; title: string; description: string; category: string; instructor: string; schedule: string; fee: number; page: CoursePage;
  paused?: boolean; pauseReason?: string; approvedEnrollments?: number; community?: import('./admissions-types').LearnerCommunity; feedback?: import('./admissions-types').PublicFeedback[];
  modules: { id: string; title: string; summary: string; objectives: string[]; lessons: { title: string; duration: string }[] }[]; price: PriceQuote }
export interface StudentProfile { name: string; phone: string; headline: string; location: string; about: string; skills: string[]; cvName: string; cvSize: number; showCv: boolean }
export interface PortfolioProject { title: string; summary: string; url: string; tools: string }
export interface PortfolioEntry { title: string; organization: string; period: string; description: string }
export interface PortfolioSections { layout: 'studio' | 'resume' | 'gallery'; accentColor: string; projects: PortfolioProject[]; experience: PortfolioEntry[]; education: PortfolioEntry[] }
export interface PortalNotification { id: string; title: string; body: string; kind: string; page: string; createdAt: string; readAt: string; shownAt: string }
export interface LearningTask { id: string; courseId: string; moduleId: string; title: string; brief: string; deliverables: string[]; published: boolean; courseTitle: string;
  submission?: { id: string; url: string; note: string; feedback: string; submittedAt: string; reviewedAt: string } }
export interface CurriculumDraft { description: string; outcomes: string[]; requirements: string[]; modules: { title: string; summary: string; objectives: string[]; assignment: { title: string; brief: string; deliverables: string[] } }[]; capstone: { title: string; brief: string; deliverables: string[] } }
