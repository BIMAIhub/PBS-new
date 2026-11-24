import { useRef,useState } from 'react';
import { CloudUpload,Folder,Upload } from 'lucide-react';
import { messageFrom,send } from './api';
import { Button,Field,FormError,Input,Panel,useApiResource } from './ui';

export async function uploadDriveFile(url:string,file:File,chunkSize:number,onProgress:(percent:number)=>void,signal?:AbortSignal){
  let offset=0,last:{id?:string;nextExpectedRanges?:string[]}={};
  while(offset<file.size){
    const end=Math.min(file.size,offset+chunkSize);let response:Response|undefined;
    for(let attempt=0;attempt<3;attempt++){
      try{response=await fetch(url,{method:'PUT',credentials:'omit',redirect:'error',headers:{'Content-Range':`bytes ${offset}-${end-1}/${file.size}`,'Content-Type':'application/octet-stream'},body:file.slice(offset,end),signal});}
      catch(e){if(signal?.aborted||attempt===2)throw e;}
      if(response?.ok)break;
      if(response&&![429,500,502,503,504].includes(response.status))throw new Error('OneDrive rejected this file fragment. Check your storage account and retry.');
      await new Promise<void>((resolve,reject)=>{if(signal?.aborted){reject(new Error('Upload cancelled.'));return;}const abort=()=>{clearTimeout(timer);reject(new Error('Upload cancelled.'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},1000*(attempt+1));signal?.addEventListener('abort',abort,{once:true});});
    }
    if(!response?.ok)throw new Error('The upload did not finish. Please retry.');
    last=await response.json();offset=end;onProgress(Math.round(offset/file.size*100));
    if(response.status===202&&last.nextExpectedRanges?.[0]){const expected=Number(last.nextExpectedRanges[0].split('-')[0]);if(Number.isSafeInteger(expected)&&expected>=0&&expected<=file.size)offset=expected;}
  }
  if(!last.id)throw new Error('OneDrive did not confirm the completed file.');return last.id;
}
export function AssignmentStorageSettings({connected}:{connected:boolean}){
  const resource=useApiResource<{configured:boolean;name?:string;webUrl?:string}>('/admin/assignment-storage'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  return <Panel title="Assignment destination"><FormError error={error||resource.error}/><p className="pbs-muted">Choose your OneDrive Assignments folder. PBS organizes uploads as Course → Batch → Student → Assignment.</p>{resource.data?.configured&&<p className="pbs-form-status"><Folder size={16}/>{resource.data.name} is configured</p>}<form className="pbs-live-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');const form=new FormData(e.currentTarget);try{await send('/admin/assignment-storage',{url:String(form.get('url'))},'PUT');await resource.refresh();setNotice('Assignment destination saved.');}catch(p){setError(messageFrom(p));}finally{setBusy(false);}}}><Input label="OneDrive assignment folder link" name="url" type="url" defaultValue={resource.data?.webUrl} required autoComplete="off" note="Paste the folder’s sharing link. Connect the storage account that owns it."/><button className="pbs-button pbs-button-primary" disabled={busy||!connected}><Folder size={16}/>{busy?'Saving…':'Save assignment folder'}</button>{notice&&<p className="pbs-form-status" role="status">{notice}</p>}</form></Panel>;
}
export function AssignmentFileUpload({taskId,onSaved}:{taskId:string;onSaved:()=>Promise<void>}){
  const [files,setFiles]=useState<File[]>([]),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[current,setCurrent]=useState('');const controller=useRef<AbortController|undefined>(undefined);
  return <form className="pbs-live-form" onSubmit={async e=>{e.preventDefault();if(!files.length)return;setBusy(true);setError('');controller.current=new AbortController();try{for(const file of files){setCurrent(file.name);setProgress(0);const session=await send<{url:string;uploadId:string;chunkSize:number}>(`/student/tasks/${taskId}/drive-upload`,{filename:file.name,size:file.size,contentType:file.type||'application/octet-stream'});const id=await uploadDriveFile(session.url,file,session.chunkSize,setProgress,controller.current.signal);await send(`/drive-uploads/${session.uploadId}/complete`,{itemId:id,note});}await onSaved();}catch(p){setError(messageFrom(p));}finally{setBusy(false);}}}><FormError error={error}/><div className="pbs-upload-drop"><CloudUpload size={32}/><Input label="Assignment files" type="file" multiple required disabled={busy} accept=".pdf,.zip,.rvt,.rfa,.dwg,.ifc,.nwd,.nwc,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.txt,.csv,.mp4,.webm" onChange={e=>setFiles(Array.from(e.target.files||[]).slice(0,5))} note="Up to 5 files, 512 MB each. Model files, documents and ZIP archives are supported."/></div><Field label="Submission note"><textarea rows={3} value={note} maxLength={2000} onChange={e=>setNote(e.target.value)} disabled={busy}/></Field>{busy&&<div role="status"><p>{current} · {progress}%</p><progress max={100} value={progress} aria-label="Assignment upload progress"/></div>}<div className="pbs-actions"><button className="pbs-button pbs-button-primary" disabled={busy||!files.length}><Upload size={16}/>{busy?'Uploading to PBS OneDrive…':'Upload & submit for review'}</button>{busy&&<Button quiet onClick={()=>controller.current?.abort()}>Cancel upload</Button>}</div><p className="pbs-muted pbs-small">PBS adds your submission to the review queue after OneDrive confirms the full upload.</p></form>;
}
