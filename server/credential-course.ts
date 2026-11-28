import type {Database} from './database.js';
import type {PublicCredentialCourse} from '../src/live/academy-types.js';

// Credential visitors see only information already available in the public course catalogue.
export async function publicCredentialCourse(db:Database,id:string):Promise<PublicCredentialCourse|undefined> {
  const course=await db.prepare('SELECT id,title,description,category,instructor,schedule FROM courses WHERE id=? AND published=1').get(id);
  if(!course)return;
  const page=await db.prepare('SELECT level,duration,audience,outcomes,requirements FROM course_pages WHERE course_id=?').get(id);
  const list=(value:unknown)=>{try{const parsed=JSON.parse(String(value||'[]'));return Array.isArray(parsed)?parsed.filter((item:unknown):item is string=>typeof item==='string').slice(0,20):[];}catch{return [];}};
  const modules=await db.prepare('SELECT title FROM modules WHERE course_id=? ORDER BY position').all(id);
  return {id:String(course.id),title:String(course.title),description:String(course.description),category:String(course.category),instructor:String(course.instructor),schedule:String(course.schedule),level:String(page?.level||''),duration:String(page?.duration||''),audience:String(page?.audience||''),outcomes:list(page?.outcomes),requirements:list(page?.requirements),modules:modules.map(m=>String(m.title))};
}
