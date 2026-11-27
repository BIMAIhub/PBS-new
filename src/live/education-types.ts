export interface CourseLead {
  id: string; courseId: string; courseTitle: string; name: string; email: string; phone: string; qualification: string;
  consent: boolean; optedOut: boolean; status: 'new' | 'contacted' | 'interested' | 'lost'; note: string;
  requests: number; enrolled: boolean; accountId: string; revision: string; createdAt: string; updatedAt: string;
}
export interface CourseBrochure {
  id:string; title:string; description:string; category:string; instructor:string; schedule:string; fee:number;
  brand:import('./branding-types').Branding; price:import('./experience-types').PriceQuote;
  page:{level:string;duration:string;audience:string;outcomes:string[];requirements:string[]};
  modules:{id:string;title:string;summary:string;objectives:string[];lessons:{title:string;duration:string}[]}[];
  batches:{name:string;startsAt:string;deadline:string;seatsLeft:number}[];
}
export interface LearningResource {
  id: string; courseId: string; courseTitle: string; scope: 'course' | 'module' | 'lesson'; moduleId: string | null;
  lessonId: string | null; moduleTitle?: string; lessonTitle?: string; title: string; description: string;
  kind: 'model' | 'document' | 'reference'; fileId: string | null; filename: string; size: number;
  url?: string; published: boolean; revision: string; available?: boolean; downloadUrl: string;
}
export interface HistoricalTraining {
  id: string; accountId: string; name: string; email: string; phone: string; courseId: string; courseTitle: string;
  certificateId: string; qualification: string; completedAt: string; mode: 'offline' | 'online' | 'hybrid';
  originalNumber: string; fileId: string | null; note?: string; createdAt: string;
}
export interface QuizQuestion { id: string; text: string; options: string[]; answer?: number; explanation?: string }
export interface LearningQuiz {
  id: string; courseId: string; courseTitle: string; moduleId: string | null; lessonId: string | null;
  scope: 'course' | 'module' | 'lesson'; title: string; instructions: string; mode: 'practice' | 'assignment';
  questions?: QuizQuestion[]; questionCount: number; resources: LearningResource[]; resourceIds: string[];
  passingScore: number; maxAttempts: number; timeLimit: number; reviewReleased: boolean; published: boolean;
  revision: string; attempts: number; bestScore: number | null; locked?: boolean; lockReason?: string;
}
export interface QuizAttempt {
  id: string; quizId: string; title: string; mode: 'practice' | 'assignment'; questions: QuizQuestion[];
  answers: Record<string, number>; status: 'draft' | 'submitted'; score: number | null; passed: boolean | null;
  passingScore: number; expiresAt: number; submittedAt: string; feedback: string; reviewAvailable: boolean;
}
