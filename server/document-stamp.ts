import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { imageExtension, publicBranding } from './branding.js';
import { badRequest, conflict, field, route } from './http.js';
import { defaultDocumentStamp, type DocumentStamp } from '../src/live/document-types.js';

export async function documentStamp(db: Database): Promise<DocumentStamp> {
  const stored = await setting(db, 'document_stamp');
  return { ...defaultDocumentStamp(await publicBranding(db)), ...(stored ? JSON.parse(stored) : {}) };
}

export function mountDocumentStamp(app: Express, db: WritableDatabase) {
  app.get('/api/document-stamp', route(async (_req, res) => { res.json(await documentStamp(db)); }));
  app.put('/api/admin/document-stamp', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin');
    if (typeof req.body?.enabled !== 'boolean' || !['round', 'square'].includes(req.body?.design)) throw badRequest('Choose valid stamp options.');
    const color = (key: string) => { const v = field(req.body?.[key], 'stamp color', 7); if (!/^#[a-f0-9]{6}$/i.test(v)) throw badRequest('Choose six-digit stamp colors.'); return v; };
    const imageData = field(req.body?.imageData, 'stamp image', 150000, false);
    if (imageData) {
      const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
      if (!match) throw badRequest('Choose a PNG or JPEG stamp image.');
      const bytes = Buffer.from(match[2], 'base64'); if (bytes.length > 100000) throw badRequest('Choose a stamp image below 100 KB.');
      imageExtension(bytes, match[1]);
    }
    const next: DocumentStamp = { enabled: req.body.enabled, design: req.body.design,
      institution: field(req.body?.institution, 'stamp institution', 70), center: field(req.body?.center, 'stamp center', 16),
      caption: field(req.body?.caption, 'stamp caption', 60), location: field(req.body?.location, 'stamp location', 50, false),
      color: color('color'), accent: color('accent'), imageData, revision: makeId() };
    await transaction(db, async tx => {
      const current = await documentStamp(tx);
      if (current.revision !== String(req.body?.revision || '')) throw conflict('The stamp changed. Refresh before saving.');
      await saveSetting(tx, 'document_stamp', JSON.stringify(next));
      await audit(tx, admin.id, 'Institution stamp updated', '', next.enabled ? next.design : 'Disabled');
    });
    res.json(next);
  }));
}
