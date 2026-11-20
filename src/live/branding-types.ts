export interface BrandSettings {
  academyName: string;
  shortName: string;
  tagline: string;
  supportEmail: string;
  heroEyebrow: string;
  heroTitle: string;
  heroDescription: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  glassEnabled: boolean;
  motionEnabled: boolean;
}

export interface Branding extends BrandSettings {
  logoUrl: string;
  heroUrl: string;
  logoUploaded: boolean;
  heroUploaded: boolean;
  revision: string;
}

export const defaultBrandSettings: BrandSettings = {
  academyName: 'Pragmatic BIM Solution', shortName: 'PBS',
  tagline: 'BIM learning & professional practice', supportEmail: 'info@pragmaticbim.com',
  heroEyebrow: 'From learning to building', heroTitle: 'Build your future\nin BIM',
  heroDescription: 'Learn the workflows behind coordinated buildings. Develop your Revit and MEP practice, showcase your projects, and earn your course credentials.',
  primaryColor: '#176BB7', accentColor: '#D4A94D', backgroundColor: '#F4F7FA',
  glassEnabled: true, motionEnabled: true,
};

export const defaultBranding: Branding = {
  ...defaultBrandSettings, logoUrl: '/pbs-logo.svg', heroUrl: '/bim-studio-hero.webp',
  logoUploaded: false, heroUploaded: false, revision: '',
};
