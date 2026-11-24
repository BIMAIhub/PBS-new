import type { Database } from '../server/database.js';
import { videoSourceKey } from '../server/video.js';
// Test setup for suites focused on certificates/feedback rather than the player.
export async function previouslyWatched(db:Database,studentId:string,lessonId:string){
  const lesson=await db.prepare('SELECT source_url,file_name FROM lessons WHERE id=?').get(lessonId);
  if(!lesson)throw new Error('Missing isolated lesson fixture.');
  await db.prepare('INSERT OR REPLACE INTO lesson_watch_totals VALUES (?,?,?,?,?,?,?)').run(studentId,lessonId,videoSourceKey(String(lesson.source_url),String(lesson.file_name)),100,'[[0,80]]',80,new Date().toISOString());
}
