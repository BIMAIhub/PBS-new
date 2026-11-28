import {createHash} from 'node:crypto';
import {graph,unseal} from './microsoft.js';
import {uploadLocation} from './drive-uploads.js';
import {type Database,now} from './database.js';
import {cleanupPrivateFiles} from './private-files.js';

type StorageJob={adminId:string;operation:'item'|'permission'|'upload';driveId?:string;itemId?:string;permissionId?:string;uploadUrl?:string};
export async function queueStudentStorageCleanup(db:Database,job:StorageJob){
  const id=createHash('sha256').update(JSON.stringify(job)).digest('hex');
  await db.prepare('INSERT OR IGNORE INTO student_storage_cleanup(id,admin_id,operation,drive_id,item_id,permission_id,upload_url,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,job.adminId,job.operation,job.driveId||'',job.itemId||'',job.permissionId||'',job.uploadUrl||'',now());
}
export async function cleanupStudentStorage(db:Database,request:typeof graph=graph,limit=10){
  const rows=await db.prepare("SELECT * FROM student_storage_cleanup ORDER BY CASE operation WHEN 'upload' THEN 0 WHEN 'permission' THEN 1 ELSE 2 END,attempts,created_at LIMIT ?").all(limit),deadline=Date.now()+15000;let removed=0;
  for(const row of rows){if(Date.now()>deadline)break;
    try{
      if(row.operation==='upload'){
        const url=uploadLocation(unseal(String(row.upload_url))),response=await fetch(url,{method:'DELETE',signal:AbortSignal.timeout(10000)});
        if(!response.ok&&![404,410].includes(response.status))throw new Error('Upload cancellation pending');
      }else{
        const path=`/drives/${encodeURIComponent(String(row.drive_id))}/items/${encodeURIComponent(String(row.item_id))}${row.operation==='permission'?'/permissions/'+encodeURIComponent(String(row.permission_id)):''}`;
        await request(db,String(row.admin_id),path,{method:'DELETE'});
      }
      await db.prepare('DELETE FROM student_storage_cleanup WHERE id=?').run(row.id);removed++;
    }catch(error){
      if(error instanceof Error&&/itemNotFound|resourceNotFound|\(404\)/i.test(error.message)){await db.prepare('DELETE FROM student_storage_cleanup WHERE id=?').run(row.id);removed++;}
      else await db.prepare("UPDATE student_storage_cleanup SET attempts=attempts+1,error='Storage cleanup pending. Check the storage account connection and retry.' WHERE id=?").run(row.id);
    }
  }
  return {removed,pending:Number((await db.prepare('SELECT COUNT(*) AS n FROM student_storage_cleanup').get())?.n||0)};
}
export async function cleanupAllPrivateFiles(db:Database,request:typeof graph=graph){
  const local=await cleanupPrivateFiles(db),cloud=await cleanupStudentStorage(db,request);
  return {removed:local.removed+cloud.removed,pending:local.pending+cloud.pending,local,cloud};
}
