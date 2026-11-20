import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { get, put, del } from '@vercel/blob';
import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, dataDirectory, makeId, transaction } from './database.js';
import { audit, saveSetting, setting } from './academy-data.js';
import { badRequest, emailAddress, field, notFound, RequestError, route } from './http.js';
import { defaultBrandSettings, type Branding, type BrandSettings } from '../src/live/branding-types.js';

type Asset = { id: string; location: string; type: string; size: number };
const localFile = (file: string) => path.join(dataDirectory, 'branding', file);
const assetKey = (kind: string) => `branding_asset_${kind}`;
async function asset(db: Database, kind: string): Promise<Asset | null> {
  const stored = await setting(db, assetKey(kind)); return stored ? JSON.parse(stored) : null;
}
export async function publicBranding(db: Database): Promise<Branding> {
  const [saved, logo, hero, revision] = await Promise.all([setting(db, 'branding'), asset(db, 'logo'), asset(db, 'hero'), setting(db, 'branding_revision')]);
  return { ...defaultBrandSettings, ...(saved ? JSON.parse(saved) : {}),
    logoUrl: logo ? `/api/branding/assets/logo/${logo.id}` : '/pbs-logo.svg',
    heroUrl: hero ? `/api/branding/assets/hero/${hero.id}` : '/bim-studio-hero.webp',
    logoUploaded: Boolean(logo), heroUploaded: Boolean(hero), revision };
}
function lightness(hex: string) {
  const channels = [1, 3, 5].map(index => { const v = parseInt(hex.slice(index, index + 2), 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
function settings(input: any): BrandSettings {
  const color = (key: string) => { const v = field(input?.[key], 'theme color', 7); if (!/^#[a-f0-9]{6}$/i.test(v)) throw badRequest('Choose a six-digit hex color.'); return v; };
  const primaryColor = color('primaryColor'), accentColor = color('accentColor'), backgroundColor = color('backgroundColor');
  if (1.05 / (lightness(primaryColor) + .05) < 4.5) throw badRequest('Choose a darker primary blue so white button labels remain readable.');
  if (lightness(backgroundColor) < .65) throw badRequest('Choose a light reading-surface color. The surrounding theme stays dark blue.');
  if (typeof input?.glassEnabled !== 'boolean' || typeof input?.motionEnabled !== 'boolean') throw badRequest('Choose valid appearance options.');
  return {
    academyName: field(input?.academyName, 'academy name', 100), shortName: field(input?.shortName, 'short name', 12),
    tagline: field(input?.tagline, 'tagline', 100), supportEmail: emailAddress(input?.supportEmail),
    heroEyebrow: field(input?.heroEyebrow, 'hero label', 80), heroTitle: field(input?.heroTitle, 'hero title', 100),
    heroDescription: field(input?.heroDescription, 'hero description', 500), primaryColor, accentColor, backgroundColor,
    glassEnabled: input.glassEnabled, motionEnabled: input.motionEnabled,
  };
}
export function imageExtension(bytes: Buffer, type: string) {
  if (type === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.subarray(12, 16).toString() === 'IHDR') {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 6000 || height > 6000) throw badRequest('Use an image up to 6000 pixels on each side.');
    let complete = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset), chunk = bytes.subarray(offset + 4, offset + 8).toString();
      if (offset + length + 12 > bytes.length || chunk === 'acTL') throw badRequest('Choose a complete, non-animated PNG image.');
      offset += length + 12;
      if (chunk === 'IEND') { complete = length === 0 && offset === bytes.length; break; }
    }
    if (!complete) throw badRequest('The PNG file is incomplete.');
    return 'png';
  }
  if (type === 'image/jpeg' && bytes.length >= 16 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9') {
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
        if (!width || !height || width > 6000 || height > 6000) throw badRequest('Use an image up to 6000 pixels on each side.');
        return 'jpg';
      }
      offset += length;
    }
  }
  if (type === 'image/webp' && bytes.length >= 20 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.subarray(12, 16).toString())) {
    if (bytes.subarray(12, 16).toString() === 'VP8X') {
      if (bytes.length < 30 || (bytes[20] & 2)) throw badRequest('Choose a non-animated WebP image.');
      if (bytes.readUIntLE(24, 3) + 1 > 6000 || bytes.readUIntLE(27, 3) + 1 > 6000) throw badRequest('Use an image up to 6000 pixels on each side.');
    }
    return 'webp';
  }
  throw badRequest('Upload a PNG, JPEG or WebP image. SVG and animated files are not accepted.');
}
async function removeAsset(file: Asset) {
  if (/^pbs\/branding\/[a-f\d-]+\.(png|jpg|webp)$/.test(file.location)) await del(file.location);
  else if (/^[a-f\d-]+\.(png|jpg|webp)$/.test(file.location)) await rm(localFile(file.location), { force: true });
}
export function mountBranding(app: Express, db: WritableDatabase, hosted: boolean) {
  app.get('/api/branding', route(async (_req, res) => { res.json(await publicBranding(db)); }));
  app.put('/api/admin/branding', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), validated = settings(req.body);
    await transaction(db, async tx => { await saveSetting(tx, 'branding', JSON.stringify(validated)); await saveSetting(tx, 'branding_revision', makeId()); await audit(tx, admin.id, 'Website branding updated', 'branding', validated.academyName); });
    res.json(await publicBranding(db));
  }));
  app.post('/api/admin/branding/assets/:kind', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), kind = req.params.kind;
    if (!['logo', 'hero'].includes(kind)) throw notFound('This branding image is unavailable.');
    const limit = (kind === 'logo' ? 512 : 2048) * 1024, size = Number(req.get('content-length')), type = req.get('content-type')?.split(';')[0] || '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) throw badRequest('Choose a PNG, JPEG or WebP image.');
    if (!Number.isSafeInteger(size) || size < 16 || size > limit) throw new RequestError(413, `Upload ${kind === 'logo' ? 'a logo up to 512 KB' : 'a background up to 2 MB'}.`);
    const parts: Buffer[] = []; let received = 0;
    for await (const chunk of req) { received += chunk.length; if (received > limit) throw new RequestError(413, 'The image exceeds its upload limit.'); parts.push(Buffer.from(chunk)); }
    if (received !== size) throw badRequest('The image upload was incomplete.');
    const bytes = Buffer.concat(parts), extension = imageExtension(bytes, type), id = makeId(), file = `${id}.${extension}`;
    const cloud = hosted || Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
    const next: Asset = { id, location: cloud ? `pbs/branding/${file}` : file, type, size };
    if (cloud) await put(next.location, bytes, { access: 'private', contentType: type, addRandomSuffix: false });
    else { await mkdir(path.join(dataDirectory, 'branding'), { recursive: true, mode: 0o700 }); await writeFile(localFile(file), bytes, { mode: 0o600, flag: 'wx' }); }
    let previous: Asset | null = null;
    try { await transaction(db, async tx => { previous = await asset(tx, kind); await saveSetting(tx, assetKey(kind), JSON.stringify(next)); await saveSetting(tx, 'branding_revision', makeId()); await audit(tx, admin.id, 'Brand image uploaded', kind, `${type} · ${size} bytes`); }); }
    catch (error) { await removeAsset(next).catch(() => {}); throw error; }
    if (previous) await removeAsset(previous).catch(() => {});
    res.status(201).json(await publicBranding(db));
  }));
  app.delete('/api/admin/branding/assets/:kind', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), kind = req.params.kind;
    if (!['logo', 'hero'].includes(kind)) throw notFound('This branding image is unavailable.');
    const previous = await transaction(db, async tx => { const prior = await asset(tx, kind); await saveSetting(tx, assetKey(kind), ''); await saveSetting(tx, 'branding_revision', makeId()); await audit(tx, admin.id, 'Default brand image restored', kind, ''); return prior; });
    if (previous) await removeAsset(previous).catch(() => {});
    res.json(await publicBranding(db));
  }));
  app.get('/api/branding/assets/:kind/:id', route(async (req, res) => {
    const kind = req.params.kind;
    if (!['logo', 'hero'].includes(kind)) throw notFound('This branding image is unavailable.');
    const current = await asset(db, kind);
    if (!current || current.id !== req.params.id) throw notFound('This branding image is unavailable.');
    res.set('ETag', `"${current.id}"`).set('Cache-Control', 'public, max-age=86400, immutable').type(current.type);
    if (req.get('if-none-match') === `"${current.id}"`) { res.status(304).end(); return; }
    if (/^pbs\/branding\/[a-f\d-]+\.(png|jpg|webp)$/.test(current.location)) {
      const result = await get(current.location, { access: 'private', useCache: true });
      if (!result || result.statusCode !== 200) throw notFound('This branding image is unavailable.');
      await pipeline(Readable.fromWeb(result.stream as import('node:stream/web').ReadableStream), res);
    } else if (/^[a-f\d-]+\.(png|jpg|webp)$/.test(current.location)) {
      res.send(await readFile(localFile(current.location)).catch(() => { throw notFound('This branding image is unavailable.'); }));
    } else throw notFound('This branding image is unavailable.');
  }));
}
