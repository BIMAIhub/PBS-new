import type { Express } from 'express';
import { hasCourseAccess } from './records.js';
import { requireAccount } from './auth.js';
import { type Database, type WritableDatabase, makeId, now, transaction } from './database.js';
import { audit } from './academy-data.js';
import { badRequest, conflict, field, integer, notFound, route } from './http.js';
import { educationAccess, educationScope, learningResources, validateResourceIds } from './learning-resources.js';
import type { Account } from '../src/live/types.js';
import type { QuizQuestion, LearningQuiz, QuizAttempt } from '../src/live/education-types.js';

type Snapshot={title:string;mode:'practice'|'assignment';questions:QuizQuestion[];passingScore:number};
const questionView=(questions:QuizQuestion[],review=false)=>questions.map(({answer,explanation,...q})=>review?{...q,answer,explanation}:q);
function questions(input:unknown):QuizQuestion[] {
  if(!Array.isArray(input)||input.length<1||input.length>30)throw badRequest('Add between 1 and 30 MCQ questions.');
  return input.map((q,index)=>{
    if(!q||!Array.isArray(q.options)||q.options.length<2||q.options.length>6)throw badRequest(`Question ${index+1} needs 2 to 6 options.`);
    const options=q.options.map((v:unknown)=>field(v,'answer option',400));
    if(new Set(options.map((o:string)=>o.toLowerCase())).size!==options.length)throw badRequest('Answer options must be different.');
    return {id:`q${index+1}`,text:field(q.text,'question text',2000),options,answer:integer(q.answer,'correct answer',0,options.length-1),explanation:field(q.explanation,'answer explanation',2500,false)};
  });
}
async function quizRow(db:Database,id:string) {
  const raw=await db.prepare(`SELECT q.*,c.title AS course_title FROM learning_quizzes q JOIN courses c ON c.id=q.course_id WHERE q.id=?`).get(id);
  if(!raw)throw notFound('This test is unavailable.');return raw;
}
function scopeOf(row:Record<string,unknown>) {return {courseId:String(row.course_id),scope:String(row.scope),moduleId:row.module_id?String(row.module_id):null,lessonId:row.lesson_id?String(row.lesson_id):null};}
async function requireQuizAccess(db:Database,account:Pick<Account,'id'|'role'>,id:string) {
  const row=await quizRow(db,id),access=await educationAccess(db,account,scopeOf(row));
  if(account.role!=='admin'&&(!row.published||!access.available))throw notFound(access.reason||'This test is not published.');return row;
}
function answersFor(input:unknown,snapshot:Snapshot) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length>30)throw badRequest('Choose valid test answers.');
  const answers:Record<string,number>={};
  for(const [id,value] of Object.entries(input)) {
    const q=snapshot.questions.find(q=>q.id===id);if(!q)throw badRequest('This answer is not part of the current attempt.');
    answers[id]=integer(value,'answer selection',0,q.options.length-1);
  }return answers;
}
async function attemptView(db:Database,row:Record<string,unknown>,admin=false):Promise<QuizAttempt> {
  const snapshot=JSON.parse(String(row.snapshot)) as Snapshot;
  const quiz=await quizRow(db,String(row.quiz_id));
  const review=row.status==='submitted'&&(admin||snapshot.mode==='practice'||Boolean(quiz.review_released));
  return {id:String(row.id),quizId:String(row.quiz_id),title:snapshot.title,mode:snapshot.mode,questions:questionView(snapshot.questions,review),answers:JSON.parse(String(row.answers)),
    status:row.status as QuizAttempt['status'],score:row.score===null?null:Number(row.score),passed:row.passed===null?null:Boolean(row.passed),passingScore:snapshot.passingScore,expiresAt:Number(row.expires_at),submittedAt:String(row.submitted_at),feedback:String(row.feedback),reviewAvailable:review};
}
export function mountLearningQuizzes(app:Express,db:WritableDatabase) {
  for(const admin of [true,false]) app.get(`/api/${admin?'admin':'student'}/learning-quizzes`,route(async(req,res)=>{
    const account=await requireAccount(db,req,admin?'admin':'student'),resourceList=await learningResources(db,account),rows=await db.prepare(`SELECT q.*,c.title AS course_title FROM learning_quizzes q JOIN courses c ON c.id=q.course_id ${admin?'':'WHERE q.published=1'} ORDER BY q.created_at DESC`).all();
    const result:LearningQuiz[]=[];
    for(const row of rows){
      const scope=scopeOf(row),access=await educationAccess(db,account,scope);
      if(!admin&&!await hasCourseAccess(db,account,scope.courseId))continue;
      const parsed=JSON.parse(String(row.questions)) as QuizQuestion[],resourceIds=JSON.parse(String(row.resource_ids)) as string[];
      const stats=await db.prepare('SELECT COUNT(*) AS attempts,MAX(score) AS bestScore FROM quiz_attempts WHERE quiz_id=? AND account_id=?').get(row.id,account.id);
      result.push({id:String(row.id),...scope,courseTitle:String(row.course_title),scope:scope.scope as LearningQuiz['scope'],title:String(row.title),instructions:String(row.instructions),mode:row.mode as LearningQuiz['mode'],
        questions:admin?parsed:undefined,questionCount:parsed.length,resources:resourceList.filter(r=>resourceIds.includes(r.id)),resourceIds:admin?resourceIds:[],passingScore:Number(row.passing_score),maxAttempts:Number(row.max_attempts),timeLimit:Number(row.time_limit),reviewReleased:Boolean(row.review_released),published:Boolean(row.published),revision:String(row.revision),attempts:Number(stats?.attempts||0),bestScore:stats?.bestScore==null?null:Number(stats.bestScore),locked:!access.available,lockReason:access.reason});
    }res.json({quizzes:result});
  }));
  app.post('/api/admin/learning-quizzes',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),scope=await educationScope(db,req.body||{}),id=field(req.body?.id,'test reference',80,false)||makeId(),items=questions(req.body?.questions);
    const mode=field(req.body?.mode,'test type',20);if(!['practice','assignment'].includes(mode))throw badRequest('Choose practice test or graded assignment.');
    const title=field(req.body?.title,'test title',180),instructions=field(req.body?.instructions,'instructions',4000,false),resourceIds=await validateResourceIds(db,req.body?.resourceIds||[],scope.courseId);
    const passingScore=integer(req.body?.passingScore,'passing percentage',1,100),maxAttempts=integer(req.body?.maxAttempts,'maximum attempts',0,100),timeLimit=integer(req.body?.timeLimit,'time limit in minutes',0,180);
    await transaction(db,async tx=>{
      const existing=await tx.prepare('SELECT revision,course_id FROM learning_quizzes WHERE id=?').get(id);
      if(existing&&existing.revision!==req.body?.revision)throw conflict('This test changed. Refresh before saving.');
      if(existing&&existing.course_id!==scope.courseId)throw badRequest('Keep a test in its original course so existing results remain valid.');
      await tx.prepare(`INSERT INTO learning_quizzes(id,course_id,module_id,lesson_id,scope,title,instructions,mode,questions,resource_ids,passing_score,max_attempts,time_limit,review_released,published,revision,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET module_id=excluded.module_id,lesson_id=excluded.lesson_id,scope=excluded.scope,title=excluded.title,instructions=excluded.instructions,mode=excluded.mode,questions=excluded.questions,resource_ids=excluded.resource_ids,passing_score=excluded.passing_score,max_attempts=excluded.max_attempts,time_limit=excluded.time_limit,review_released=excluded.review_released,published=excluded.published,revision=excluded.revision,updated_at=excluded.updated_at`)
        .run(id,scope.courseId,scope.moduleId,scope.lessonId,scope.scope,title,instructions,mode,JSON.stringify(items),JSON.stringify(resourceIds),passingScore,maxAttempts,timeLimit,Number(req.body?.reviewReleased===true),Number(req.body?.published===true),makeId(),now(),now());
      await audit(tx,admin.id,'MCQ test saved',id,`${title} · ${mode} · ${items.length} questions`);
    });res.status(201).json({id});
  }));
  app.post('/api/student/learning-quizzes/:id/start',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student'),key=field(req.body?.requestKey,'attempt reference',80);
    if(!/^[\w-]{16,80}$/.test(key))throw badRequest('Open this test again.');
    const attempt=await transaction(db,async tx=>{
      const quiz=await requireQuizAccess(tx,account,req.params.id),prior=await tx.prepare('SELECT * FROM quiz_attempts WHERE account_id=? AND request_key=?').get(account.id,key);
      if(prior){if(prior.quiz_id!==quiz.id)throw conflict('This attempt belongs to another test.');return prior;}
      const draft=await tx.prepare("SELECT * FROM quiz_attempts WHERE quiz_id=? AND account_id=? AND status='draft' ORDER BY started_at DESC LIMIT 1").get(quiz.id,account.id);if(draft)return draft;
      const count=Number((await tx.prepare('SELECT COUNT(*) AS n FROM quiz_attempts WHERE quiz_id=? AND account_id=?').get(quiz.id,account.id))?.n||0);
      if(Number(quiz.max_attempts)>0&&count>=Number(quiz.max_attempts))throw conflict('You have used all permitted attempts. Ask your instructor for help.');
      const id=makeId(),snapshot:Snapshot={title:String(quiz.title),mode:quiz.mode as Snapshot['mode'],questions:JSON.parse(String(quiz.questions)),passingScore:Number(quiz.passing_score)};
      await tx.prepare('INSERT INTO quiz_attempts(id,quiz_id,account_id,request_key,snapshot,started_at,expires_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,quiz.id,account.id,key,JSON.stringify(snapshot),now(),Number(quiz.time_limit)?Date.now()+Number(quiz.time_limit)*60000:0,now());
      return (await tx.prepare('SELECT * FROM quiz_attempts WHERE id=?').get(id))!;
    });res.status(201).json(await attemptView(db,attempt));
  }));
  app.get('/api/student/learning-quizzes/:id/attempts',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student');await requireQuizAccess(db,account,req.params.id);
    const rows=await db.prepare('SELECT * FROM quiz_attempts WHERE quiz_id=? AND account_id=? ORDER BY started_at DESC').all(req.params.id,account.id);res.json({attempts:await Promise.all(rows.map(row=>attemptView(db,row)))});
  }));
  app.post('/api/student/quiz-attempts/:id',route(async(req,res)=>{
    const account=await requireAccount(db,req,'student');
    const row=await transaction(db,async tx=>{
      const attempt=await tx.prepare('SELECT * FROM quiz_attempts WHERE id=? AND account_id=?').get(req.params.id,account.id);if(!attempt)throw notFound('This attempt is unavailable.');
      await requireQuizAccess(tx,account,String(attempt.quiz_id));if(attempt.status==='submitted')return attempt;
      const snapshot=JSON.parse(String(attempt.snapshot)) as Snapshot, expired=Number(attempt.expires_at)>0&&Number(attempt.expires_at)<=Date.now();
      const answers=expired?JSON.parse(String(attempt.answers)) as Record<string,number>:answersFor(req.body?.answers,snapshot);
      if(req.body?.submit===true||expired){
        const correct=snapshot.questions.filter(q=>answers[q.id]===q.answer).length,score=Math.round(correct/snapshot.questions.length*100);
        await tx.prepare("UPDATE quiz_attempts SET answers=?,status='submitted',score=?,passed=?,submitted_at=?,updated_at=? WHERE id=? AND status='draft'").run(JSON.stringify(answers),score,Number(score>=snapshot.passingScore),now(),now(),attempt.id);
      }else await tx.prepare("UPDATE quiz_attempts SET answers=?,updated_at=? WHERE id=? AND status='draft'").run(JSON.stringify(answers),now(),attempt.id);
      return (await tx.prepare('SELECT * FROM quiz_attempts WHERE id=?').get(attempt.id))!;
    });res.json(await attemptView(db,row));
  }));
  app.get('/api/admin/learning-quizzes/:id/results',route(async(req,res)=>{
    await requireAccount(db,req,'admin');await quizRow(db,req.params.id);
    const rows=await db.prepare('SELECT q.*,a.name,a.email FROM quiz_attempts q JOIN accounts a ON a.id=q.account_id WHERE q.quiz_id=? ORDER BY q.started_at DESC').all(req.params.id);
    res.json({attempts:await Promise.all(rows.map(async row=>({...await attemptView(db,row,true),name:row.name,email:row.email,startedAt:row.started_at})))});
  }));
  app.patch('/api/admin/quiz-attempts/:id/feedback',route(async(req,res)=>{
    const admin=await requireAccount(db,req,'admin'),feedback=field(req.body?.feedback,'test feedback',4000,false);
    const result=await db.prepare("UPDATE quiz_attempts SET feedback=?,updated_at=? WHERE id=? AND status='submitted'").run(feedback,now(),req.params.id);
    if(!result.changes)throw notFound('Submit this test before adding feedback.');await audit(db,admin.id,'Test feedback updated',req.params.id,'');res.status(204).end();
  }));
}
