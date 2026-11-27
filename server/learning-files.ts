import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { graph, graphContentLocation, seal } from './microsoft.js';
import { driveFolderName, folder, uploadLocation } from './drive-uploads.js';
import { badRequest, conflict, field, integer, notFound, route } from './http.js';

const part = encodeURIComponent;
export const driveItemPath = (drive: string, item: string) => `/drives/${part(drive)}/items/${part(item)}`;
export const learningFileExtensions = ['pdf','zip','rvt','rfa','dwg','dxf','ifc','nwd','nwc','png','jpg','jpeg','docx','xlsx','pptx','txt','csv'];
export async function fileDownloadLocation(db: Database, fileId: string, locate = graphContentLocation) {
  const file = await db.prepare("SELECT * FROM academy_files WHERE id=? AND completed_at<>''").get(fileId);
  if (!file) throw notFound('This practice file is unavailable. Ask PBS to upload it again.');
  return { file, url: await locate(db, String(file.admin_id), `${driveItemPath(String(file.drive_id), String(file.item_id))}/content`) };
}
export function mountLearningFiles(app: Express, db: WritableDatabase, request: typeof graph = graph) {
  app.post('/api/admin/learning-files/upload', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), kind = field(req.body?.kind, 'file purpose', 30);
    if (!['resource','certificate'].includes(kind)) throw badRequest('Choose a practice file or an original certificate PDF.');
    const original = field(req.body?.filename, 'file name', 180), extension = original.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    if (!extension || !learningFileExtensions.includes(extension) || kind === 'certificate' && extension !== 'pdf') throw badRequest('Choose a PDF, practice model, ZIP, image or supported document. Videos are managed in the lesson player.');
    const size = integer(req.body?.size, 'file size', 1, kind === 'certificate' ? 50 * 1024 ** 2 : 512 * 1024 ** 2);
    const courseId = field(req.body?.courseId, 'course', 80, false), course = courseId ? await db.prepare('SELECT id,title FROM courses WHERE id=?').get(courseId) : undefined;
    if (courseId && !course) throw notFound('This course is unavailable.');
    const storage = courseId ? await db.prepare('SELECT * FROM course_storage WHERE course_id=?').get(courseId) : undefined;
    let owner = admin.id, drive = '', parent = '';
    if (storage) { owner = String(storage.admin_id); drive = String(storage.drive_id); parent = String(storage.item_id); }
    else {
      const root = await request(db, admin.id, '/me/drive/root?$select=id,parentReference');
      drive = String(root.parentReference?.driveId || ''); parent = String(root.id || '');
      if (!drive || !parent) throw conflict('Connect your OneDrive storage account before uploading practice files.');
      parent = String((await folder(db, owner, drive, parent, 'PBS portal files', request)).id);
      if (course) parent = String((await folder(db, owner, drive, parent, `${course.title}-${String(course.id).slice(-6)}`, request)).id);
    }
    parent = String((await folder(db, owner, drive, parent, kind === 'certificate' ? 'Past student certificates' : 'Practice resources', request)).id);
    const id = makeId(), filename = `${id.slice(0,8)}-${driveFolderName(original.replace(/\.[^.]+$/, '')).slice(0,100)}.${extension}`;
    const session = await request(db, owner, `${driveItemPath(drive, parent)}:/${part(filename)}:/createUploadSession`, { method:'POST', body:JSON.stringify({ item:{ name:filename, '@microsoft.graph.conflictBehavior':'fail' } }) });
    const url = uploadLocation(session.uploadUrl), suppliedExpiry = Date.parse(String(session.expirationDateTime || ''));
    const expires = Number.isFinite(suppliedExpiry) ? Math.min(suppliedExpiry, Date.now() + 86400_000) : Date.now() + 3600_000;
    const mime = extension === 'pdf' ? 'application/pdf' : field(req.body?.contentType || 'application/octet-stream', 'file type', 100);
    await db.prepare(`INSERT INTO academy_files(id,admin_id,kind,course_id,drive_id,parent_id,filename,original_name,size,content_type,upload_url,expires_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner, kind, courseId || null, drive, parent, filename, original, size, mime, seal(url), expires, now());
    res.status(201).json({ uploadId:id, url, chunkSize:10 * 1024 ** 2, expiresAt:expires });
  }));
  app.post('/api/admin/learning-files/:id/complete', route(async (req, res) => {
    const admin = await requireAccount(db, req, 'admin'), file = await db.prepare('SELECT * FROM academy_files WHERE id=?').get(req.params.id);
    if (!file) throw notFound('This upload is unavailable.');
    if (file.completed_at) { res.json({ id:file.id, filename:file.original_name, size:Number(file.size) }); return; }
    const itemId = field(req.body?.itemId, 'uploaded file', 250, false);
    const path = itemId ? driveItemPath(String(file.drive_id), itemId) : `${driveItemPath(String(file.drive_id), String(file.parent_id))}:/${part(String(file.filename))}`;
    const item = await request(db, String(file.admin_id), `${path}?$select=id,name,size,file,parentReference`);
    if (!item.id || item.name !== file.filename || Number(item.size) !== Number(file.size) || item.parentReference?.driveId !== file.drive_id || item.parentReference?.id !== file.parent_id || !item.file || String(item.file.mimeType || '').startsWith('video/')) throw badRequest('The uploaded file does not match its authorized name, size and destination.');
    await transaction(db, async tx => {
      await tx.prepare("UPDATE academy_files SET item_id=?,completed_at=?,upload_url='' WHERE id=? AND completed_at=''").run(String(item.id), now(), file.id);
      await audit(tx, admin.id, 'Learning file stored in OneDrive', String(file.id), String(file.original_name));
    });
    res.json({ id:file.id, filename:file.original_name, size:Number(file.size) });
  }));
}
