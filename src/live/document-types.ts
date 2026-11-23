import type { Account, Enrollment, Receipt } from './types';

export type DocumentInfo =
  | { kind: 'receipt'; receipt: Receipt }
  | { kind: 'statement'; enrollment: Enrollment; receipts: Receipt[] }
  | { kind: 'id'; account: Account; enrollments: Enrollment[] }
  | { kind: 'letter'; account: Account; enrollment: Enrollment };

export interface DocumentStamp {
  enabled: boolean; design: 'round' | 'square'; institution: string; center: string;
  caption: string; location: string; color: string; accent: string; imageData: string; revision: string;
}

export const defaultDocumentStamp = (brand: { academyName: string; shortName: string; primaryColor: string; accentColor: string }): DocumentStamp => ({
  enabled: true, design: 'round', institution: brand.academyName, center: brand.shortName,
  caption: 'AUTHORIZED RECORD', location: '', color: brand.primaryColor, accent: brand.accentColor, imageData: '', revision: '',
});
