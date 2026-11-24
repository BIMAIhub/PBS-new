import type { Express } from 'express';
import { requireAccount } from './auth.js';
import { type Database,type WritableDatabase, makeId,now,transaction } from './database.js';
import { badRequest,conflict,field,integer,limitAttempts,notFound,route } from './http.js';
import { activeCourseAccess } from './access-controls.js';
import { requireLessonRelease } from './learning-access.js';
import { videoSourceKey } from './video.js';

export function mergeWatchRanges(input: number[][], duration: number): number[][] {
  const sorted=input.filter(r=>r.length===2&&r.every(Number.isFinite)&&r[1]>r[0]).map(([a,b])=>[Math.max(0,a),Math.min(duration,b)]).sort((a,b)=>a[0]-b[0]);
  const result:number[][]=[];for(const range of sorted){if(range[1]<=range[0])continue;const last=result.at(-1);if(last&&range[0]<=last[1]+.15)last[1]=Math.max(last[1],range[1]);else result.push([...range]);}return result;
}
async function watchLesson(db:Database,account:{id:string;role:string},lessonId:string){
  const lesson=await db.prepare('SELECT l.source_url,l.file_name,m.course_id FROM lessons l JOIN modules m ON m.id=l.module_id WHERE l.id=?').get(lessonId);
  if(!lesson||!await activeCourseAccess(db,account.id,String(lesson.course_id)))throw notFound('This lesson is unavailable.');
  await requireLessonRelease(db,account,lessonId);return {...lesson,key:videoSourceKey(String(lesson.source_url),String(lesson.file_name))};
}
export async function watchedProgress(db:Database,accountId:string,lessonId:string){
  const row=await db.prepare('SELECT w.*,l.source_url,l.file_name FROM lesson_watch_totals w JOIN lessons l ON l.id=w.lesson_id WHERE w.account_id=? AND w.lesson_id=?').get(accountId,lessonId);
  if(!row||row.media_key!==videoSourceKey(String(row.source_url),String(row.file_name)))return{watched:0,duration:0,percent:0,completed:false};
  return{watched:Number(row.watched),duration:Number(row.duration),percent:Math.min(100,Math.round(Number(row.watched)/Number(row.duration)*100)),completed:Number(row.watched)>=Number(row.duration)*.8};
}
export async function requireWatchCompletion(db:Database,accountId:string,lessonId:string){
  const progress=await watchedProgress(db,accountId,lessonId);if(!progress.completed)throw conflict('Watch at least 80% of the video. Skipped sections do not count toward completion.');
}
export async function recordWatchHeartbeat(db:Database,accountId:string,id:string,input:any,clock=Date.now()){
  const row=await db.prepare('SELECT * FROM lesson_watch_sessions WHERE id=? AND account_id=?').get(id,accountId);if(!row)throw notFound('This viewing session is unavailable.');
  const lesson=await watchLesson(db,{id:accountId,role:'student'},String(row.lesson_id));if(row.media_key!==lesson.key)throw conflict('This recording changed. Reopen the lesson.');
  const sequence=integer(input?.sequence,'watch sequence',1,Number.MAX_SAFE_INTEGER),from=input?.from,to=input?.to,rate=input?.rate;
  if(![from,to,rate].every(v=>typeof v==='number'&&Number.isFinite(v))||from<0||to<0||to>Number(row.duration)+.5||rate<.5||rate>2)throw badRequest('The viewing update is invalid.');
  if(sequence<=Number(row.sequence))return watchedProgress(db,accountId,String(row.lesson_id));
  const prior=await db.prepare('SELECT * FROM lesson_watch_totals WHERE account_id=? AND lesson_id=?').get(accountId,row.lesson_id);
  let ranges:number[][]=prior?.media_key===row.media_key?JSON.parse(String(prior.ranges)):[];
  const elapsed=Math.min(20,Math.max(0,(clock-Number(row.seen_at))/1000));
  const delta=to-from,continuous=Math.abs(from-Number(row.position))<=.75&&delta>=0&&delta<=elapsed*rate+.35;
  if(input?.seek!==true&&continuous&&delta>0)ranges=mergeWatchRanges([...ranges,[from,to]],Number(row.duration));
  const watched=ranges.reduce((n,[a,b])=>n+b-a,0),at=new Date(clock).toISOString();
  await db.prepare('INSERT INTO lesson_watch_totals VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id,lesson_id) DO UPDATE SET media_key=excluded.media_key,duration=excluded.duration,ranges=excluded.ranges,watched=excluded.watched,updated_at=excluded.updated_at').run(accountId,row.lesson_id,row.media_key,row.duration,JSON.stringify(ranges),watched,at);
  await db.prepare('UPDATE lesson_watch_sessions SET position=?,seen_at=?,sequence=? WHERE id=?').run(Math.min(to,Number(row.duration)),clock,sequence,id);
  if(watched>=Number(row.duration)*.8)await db.prepare('INSERT OR IGNORE INTO completions VALUES (?,?,?)').run(accountId,row.lesson_id,at);
  return watchedProgress(db,accountId,String(row.lesson_id));
}
export function mountLearningProgress(app:Express,db:WritableDatabase,hosted:boolean){
  app.post('/api/student/lessons/:id/watch',limitAttempts(240,hosted?db:undefined),route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'),duration=req.body?.duration,position=req.body?.position;
    if(typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>604800||typeof position!=='number'||!Number.isFinite(position)||position<0||position>duration)throw badRequest('The video duration or position is invalid.');
    const result=await transaction(db,async tx=>{const lesson=await watchLesson(tx,account,req.params.id);if(field(req.body?.mediaKey,'recording version',64)!==lesson.key)throw conflict('This recording changed. Reopen the classroom.');
      const canonical=await tx.prepare('SELECT duration FROM lesson_media_durations WHERE lesson_id=? AND media_key=?').get(req.params.id,lesson.key);if(canonical&&Math.abs(Number(canonical.duration)-duration)>2)throw conflict('The reported duration does not match this recording. Reload the player.');
      const prior=await tx.prepare('SELECT media_key,duration FROM lesson_watch_totals WHERE account_id=? AND lesson_id=?').get(account.id,req.params.id);
      if(prior?.media_key===lesson.key&&Math.abs(Number(prior.duration)-duration)>2)throw conflict('The recording duration changed. Ask PBS to check this video.');
      await tx.prepare('DELETE FROM lesson_watch_sessions WHERE account_id=? AND (lesson_id=? OR seen_at<?)').run(account.id,req.params.id,Date.now()-86400000);
      const id=makeId();await tx.prepare('INSERT INTO lesson_watch_sessions VALUES (?,?,?,?,?,?,?,0)').run(id,account.id,req.params.id,lesson.key,duration,position,Date.now());return{id,...await watchedProgress(tx,account.id,req.params.id)};});res.json(result);
  }));
  app.put('/api/student/watch/:id',limitAttempts(720,hosted?db:undefined),route(async(req,res)=>{const a=await requireAccount(db,req,'student');res.json(await transaction(db,tx=>recordWatchHeartbeat(tx,a.id,req.params.id,req.body)));}));
}
