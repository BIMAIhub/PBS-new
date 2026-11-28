import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VideoUploadQueue, type VideoUploadInput, type UploadHooks } from '../src/live/upload-queue.js';
import { browserUploadRequest, safeUploadText, uploadDriveChunks, UploadFailure, type UploadRequest } from '../src/live/upload-transport.js';
import { createVideoUploadWorker } from '../src/live/video-upload-worker.js';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const input = (index=0):VideoUploadInput => ({ file:new File([new Uint8Array(32)],`lesson-${index}.mp4`,{type:'video/mp4',lastModified:index}),source:'onedrive',courseId:'course',courseTitle:'BIM course',moduleId:'module',moduleTitle:'Module 1',title:`Lesson ${index}`,duration:'',description:'' });
const part=327680;
const signal=()=>new AbortController().signal;

test('five videos queue independently with only two transfers active and complete without a modal callback',async()=>{
  let active=0,max=0,completed=0;const releases=new Map<string,()=>void>();
  const queue=new VideoUploadQueue(async(i,h)=>{active++;max=Math.max(max,active);h.phase('uploading','Uploading');await new Promise<void>(resolve=>releases.set(h.id,resolve));h.progress(i.file.size);h.phase('verifying','Verifying');active--;return{id:i.title};},()=>{completed++;});
  const ids=queue.enqueue(Array.from({length:5},(_,i)=>input(i)));
  assert.equal(queue.snapshot().filter(j=>j.phase==='uploading').length,2);assert.equal(queue.snapshot().filter(j=>j.phase==='queued').length,3);
  for(const id of ids){releases.get(id)!();await tick();}
  assert.equal(max,2);assert.equal(completed,5);assert.ok(queue.snapshot().every(j=>j.phase==='complete'&&j.percent===100));queue.dispose();
});
test('cancelling a transfer releases a slot, verification cannot be cancelled, and failed jobs can retry',async()=>{
  let retryCount=0;const hooks=new Map<string,UploadHooks>(),finish=new Map<string,()=>void>();
  const queue=new VideoUploadQueue(async(i,h)=>{hooks.set(h.id,h);h.phase('uploading','Uploading');if(i.title==='Lesson 2'&&retryCount++===0)throw new UploadFailure('NETWORK_OR_CORS','Connection interrupted.');await new Promise<void>((resolve,reject)=>{finish.set(h.id,resolve);h.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});return{id:i.title};});
  const ids=queue.enqueue([input(0),input(1),input(2)]);queue.cancel(ids[0]);await tick();assert.equal(queue.snapshot()[0].phase,'cancelled');assert.equal(queue.snapshot()[2].phase,'failed');
  queue.retry(ids[2]);await tick();assert.equal(queue.snapshot()[2].phase,'uploading');hooks.get(ids[1])!.phase('verifying','Verifying');queue.cancel(ids[1]);assert.equal(hooks.get(ids[1])!.signal.aborted,false);
  finish.get(ids[1])!();finish.get(ids[2])!();await tick();assert.equal(queue.snapshot().filter(j=>j.phase==='complete').length,2);queue.clearFinished();assert.equal(queue.snapshot().length,0);queue.dispose();
});
test('duplicate queue selection and unsupported videos fail before starting any transfer',()=>{
  let started=0;const queue=new VideoUploadQueue(async()=>{started++;return{id:'x'};});
  assert.throws(()=>queue.enqueue([input(0),input(0)]),/already queued/);assert.equal(started,0);
  assert.throws(()=>queue.enqueue(Array.from({length:6},(_,i)=>input(i))),/five/);
  assert.throws(()=>queue.enqueue([{...input(),file:new File(['test'],'document.pdf')}]),/MP4/);queue.dispose();
});
test('logs preserve stage and HTTP diagnostics while removing signed URLs and tokens',async()=>{
  const secret='eyJhbGciOiJFZERTQSJ9.eyJ0ZXN0IjoiZmFrZSJ9.aXNvbGF0ZWQtc2lnbmF0dXJl';
  const queue=new VideoUploadQueue(async(_i,h)=>{h.log(`Failed https://test.up.1drv.com/upload?token=private-signed-token ${secret}`,{requestId:secret});throw new UploadFailure('HTTP_403',`Access failed at https://test.invalid/?secret=private-signed-token Bearer ${secret}`,403,'safe-request-id');});
  queue.enqueue([input()]);await tick();const log=JSON.stringify(queue.snapshot());assert.ok(!log.includes('private-signed-token'));assert.ok(!log.includes(secret));assert.match(log,/safe-request-id/);assert.match(log,/403/);assert.match(log,/failed/);queue.dispose();
});
test('OneDrive fragments are sequential, carry byte ranges, report progress, and never add bearer headers',async()=>{
  const starts:number[]=[],progress:number[]=[];const file=new Blob([new Uint8Array(part*2+12)]);
  const id=await uploadDriveChunks({url:'https://test.up.1drv.com/upload',file,chunkSize:part,signal:signal(),progress:n=>progress.push(n),request:async r=>{
    assert.equal(r.method,'PUT');assert.equal(r.headers?.Authorization,undefined);const start=Number(r.headers!['Content-Range'].split(' ')[1].split('-')[0]);starts.push(start);r.progress?.(r.body!.size/2);
    return start+part>=file.size?{status:201,data:{id:'provider-file'}}:{status:202,data:{nextExpectedRanges:[`${start+part}-`]}};
  }});assert.equal(id,'provider-file');assert.deepEqual(starts,[0,part,part*2]);assert.equal(progress.at(-1),file.size);assert.ok(progress.some(n=>n>0&&n<part));
});
test('a lost fragment response recovers from the server position instead of uploading acknowledged bytes again',async()=>{
  let puts=0,gets=0;const file=new Blob([new Uint8Array(part+12)]),events:string[]=[];
  const id=await uploadDriveChunks({url:'https://test.up.1drv.com/upload',file,chunkSize:part,signal:signal(),progress:()=>{},delay:async()=>{},event:m=>events.push(m),request:async r=>{
    if(r.method==='GET'){gets++;return{status:200,data:{nextExpectedRanges:[`${part}-`]}};}
    if(puts++===0)throw new UploadFailure('NETWORK_OR_CORS','Lost response');assert.match(r.headers!['Content-Range'],new RegExp(`bytes ${part}-`));return{status:201,data:{id:'resumed-file'}};
  }});assert.equal(id,'resumed-file');assert.equal(puts,2);assert.equal(gets,1);assert.ok(events.some(e=>e.includes('Retry')));
});
test('rate limits retry, permission failures stop, and expired committed sessions defer to server verification',async()=>{
  const file=new Blob([new Uint8Array(32)]);let puts=0,delayed=0;
  assert.equal(await uploadDriveChunks({url:'https://test.up.1drv.com/upload',file,chunkSize:part,signal:signal(),progress:()=>{},delay:async ms=>{delayed=ms;},request:async r=>r.method==='GET'?{status:200,data:{nextExpectedRanges:['0-']}}:puts++===0?{status:429,data:{},retryAfter:2}:{status:201,data:{id:'limited-file'}}}),'limited-file');assert.equal(delayed,2000);
  let denied=0;await assert.rejects(uploadDriveChunks({url:'https://test.up.1drv.com/upload',file,chunkSize:part,signal:signal(),progress:()=>{},request:async()=>{denied++;return{status:403,data:{error:{code:'accessDenied'}},requestId:'provider-request'};}}),(e:UploadFailure)=>e.status===403&&e.requestId==='provider-request');assert.equal(denied,1);
  assert.equal(await uploadDriveChunks({url:'https://test.up.1drv.com/upload',file,chunkSize:part,signal:signal(),resume:true,progress:()=>{},request:async()=>({status:404,data:{}})}),undefined);
});
test('XHR transfer reports bytes without cookies and can abort immediately',async()=>{
  const headers:Record<string,string>={},progress:number[]=[];
  const fake:any={upload:{},status:201,responseText:'{"id":"xhr-file"}',open:()=>{},setRequestHeader:(k:string,v:string)=>headers[k]=v,getAllResponseHeaders:()=>'',send(){this.upload.onprogress({loaded:16});this.onload();},abort(){this.onabort?.();}};
  const result=await browserUploadRequest({url:'https://test.up.1drv.com/upload',method:'PUT',body:new Blob(['video']),headers:{'Content-Range':'bytes 0-3/4'},signal:signal(),progress:n=>progress.push(n)},()=>fake);assert.equal(result.data.id,'xhr-file');assert.equal(fake.withCredentials,false);assert.equal(headers.Authorization,undefined);assert.deepEqual(progress,[16]);
  const controller=new AbortController(),pending:any={...fake,upload:{},send(){}};const request=browserUploadRequest({url:'https://test.up.1drv.com/upload',method:'PUT',signal:controller.signal},()=>pending);controller.abort();await assert.rejects(request,(e:any)=>e.name==='AbortError');
});
test('retrying lesson verification reuses the uploaded video rather than transferring it again',async()=>{
  let init=0,put=0,complete=0;const worker=createVideoUploadWorker(async(path,body)=>{
    if(path.endsWith('/drive-upload')){init++;return{uploadId:'upload-id',url:'https://test.up.1drv.com/upload?secret=private',chunkSize:part} as any;}
    assert.equal((body as any).itemId,'stored-file');if(complete++===0)throw new UploadFailure('PBS_REQUEST_TIMEOUT','Saving response lost');return{id:'lesson-id'} as any;
  },async()=>{put++;return{status:201,data:{id:'stored-file'}};});
  const h:UploadHooks={id:'retry-job',signal:signal(),phase:()=>{},progress:()=>{},log:()=>{}};await assert.rejects(worker(input(),h),/Saving response lost/);assert.deepEqual(await worker(input(),h),{id:'lesson-id'});assert.equal(init,1);assert.equal(put,1);assert.equal(complete,2);
});
test('lost final OneDrive responses use the authorized server recovery path without inventing an item ID',async()=>{
  let initialized=0;const worker=createVideoUploadWorker(async(path,body)=>{
    if(path.endsWith('/drive-upload')){initialized++;return{uploadId:'lost-final',url:'https://test.up.1drv.com/upload',chunkSize:part} as any;}
    assert.equal((body as any).itemId,undefined);assert.equal((body as any).title,'Lesson 0');return{id:'verified-by-name'} as any;
  },async()=>({status:404,data:{}}));
  assert.deepEqual(await worker(input(),{id:'lost-job',signal:signal(),phase:()=>{},progress:()=>{},log:()=>{}}),{id:'verified-by-name'});assert.equal(initialized,1);
});
test('OneDrive checks its live session position when the original expiry timestamp has elapsed',async()=>{
  let init=0,puts=0,checks=0;const worker=createVideoUploadWorker(async(path)=>path.endsWith('/drive-upload')?(init++,{uploadId:'extended',url:'https://test.up.1drv.com/upload',chunkSize:part,expiresAt:Date.now()-1} as any):({id:'extended-lesson'} as any),async request=>{
    if(request.method==='GET'){checks++;return{status:200,data:{nextExpectedRanges:['0-']}};}
    if(puts++===0)throw new UploadFailure('UPLOAD_REQUEST_FAILED','Browser interrupted');return{status:201,data:{id:'extended-file'}};
  });
  const h:UploadHooks={id:'extended-job',signal:signal(),phase:()=>{},progress:()=>{},log:()=>{}};
  await assert.rejects(worker(input(),h),/Browser interrupted/);assert.deepEqual(await worker(input(),h),{id:'extended-lesson'});assert.equal(init,1);assert.equal(checks,1);
});
