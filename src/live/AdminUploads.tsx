import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, CloudUpload, Download, FileText, RotateCcw, X } from 'lucide-react';
import { activeUpload, VideoUploadQueue, type VideoUploadInput, type VideoUploadJob } from './upload-queue';
import { createVideoUploadWorker } from './video-upload-worker';
import { safeUploadText } from './upload-transport';
import { Button } from './ui';

const UploadContext = createContext<{enqueue:(inputs:VideoUploadInput[])=>void} | null>(null);
export function useAdminUploads() {
  const context = useContext(UploadContext); if (!context) throw new Error('Open video uploads from the administrator workspace.'); return context;
}
const labels = { queued:'Queued', preparing:'Preparing storage', uploading:'Uploading', verifying:'Verifying & saving', complete:'Saved', failed:'Needs attention', cancelled:'Cancelled' };
const bytes = (n:number) => n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
const eta = (job:VideoUploadJob) => { const seconds = Math.max(0, Math.ceil((job.size - job.uploaded) / job.speed)); return seconds > 60 ? `about ${Math.ceil(seconds / 60)} min left` : `about ${seconds}s left`; };

export function uploadLogDownload(jobs:VideoUploadJob[]) {
  const safe = jobs.map(({id,filename,title,courseTitle,moduleTitle,source,size,uploaded,phase,createdAt,updatedAt,error,lessonId,logs}) => ({
    id, filename:safeUploadText(filename), title:safeUploadText(title), course:safeUploadText(courseTitle), module:safeUploadText(moduleTitle), source, size, uploaded, phase, createdAt, updatedAt,
    error, lessonId, logs,
  }));
  const blob = new Blob([JSON.stringify({ application:'PBS video uploads', exportedAt:new Date().toISOString(), uploads:safe }, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `PBS-upload-logs-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function AdminUploadProvider({children,onCompleted}:{children:ReactNode;onCompleted:()=>Promise<unknown>}) {
  const completed = useRef(onCompleted); completed.current = onCompleted;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [expanded,setExpanded] = useState(true), [refreshError,setRefreshError] = useState('');
  const [queue] = useState(()=>new VideoUploadQueue(createVideoUploadWorker(),()=>{
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(()=>{ void completed.current().then(()=>setRefreshError('')).catch(()=>setRefreshError('The videos are saved. Refresh the course list to see the latest lessons.')); },400);
  }));
  const jobs = useSyncExternalStore(queue.subscribe,queue.snapshot,queue.snapshot), active=jobs.filter(activeUpload), failed=jobs.filter(j=>j.phase==='failed');
  useEffect(()=>{
    queue.activate();
    const leave=(event:BeforeUnloadEvent)=>{if(queue.snapshot().some(activeUpload)){event.preventDefault();event.returnValue='';}};
    window.addEventListener('beforeunload',leave);
    return()=>{window.removeEventListener('beforeunload',leave);clearTimeout(refreshTimer.current);queue.dispose();};
  },[queue]);
  const total=jobs.reduce((n,j)=>n+j.size,0), percent=total?Math.round(jobs.reduce((n,j)=>n+j.size*j.percent,0)/total):0;
  return <UploadContext.Provider value={{enqueue:inputs=>{queue.enqueue(inputs);setExpanded(true);}}}>{children}{jobs.length>0&&<aside className={`pbs-upload-manager ${expanded?'is-expanded':'is-minimized'}`} aria-label="Background video uploads">
    <header><button type="button" className="pbs-upload-manager-toggle" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded} aria-label={expanded?'Minimize upload panel':'Expand upload panel'}><CloudUpload size={20}/><span><strong>Video uploads</strong><small>{active.length?`${active.length} in progress · ${percent}% overall`:failed.length?`${failed.length} need attention`:`${jobs.filter(j=>j.phase==='complete').length} videos saved`}</small></span>{expanded?<ChevronDown size={18}/>:<ChevronUp size={18}/>}</button></header>
    {!expanded&&<progress max={100} value={percent} aria-label="Overall video upload progress"/>}
    {expanded&&<><p className="pbs-upload-manager-note">You can browse PBS while two videos upload at a time. Keep this tab open.</p><div className="pbs-upload-manager-list">{jobs.map(job=><UploadCard key={job.id} job={job} retry={()=>queue.retry(job.id)} cancel={()=>queue.cancel(job.id)} dismiss={()=>queue.remove(job.id)}/>)}</div>{refreshError&&<p className="pbs-upload-manager-note" role="status">{refreshError}</p>}<footer><button type="button" onClick={()=>uploadLogDownload(jobs)}><Download size={15}/>Download logs</button><button type="button" onClick={()=>queue.clearFinished()}>Clear finished</button></footer></>}
  </aside>}</UploadContext.Provider>;
}
function UploadCard({job,retry,cancel,dismiss}:{job:VideoUploadJob;retry:()=>void;cancel:()=>void;dismiss:()=>void}) {
  return <article className={`pbs-upload-card is-${job.phase}`}><div className="pbs-upload-card-heading"><div><strong>{job.title}</strong><small>{job.filename}</small></div><span>{job.phase==='complete'&&<Check size={14}/>} {labels[job.phase]}</span></div><p>{job.courseTitle} / {job.moduleTitle}</p><progress max={100} value={job.percent} aria-label={`${job.title} upload progress`}/><div className="pbs-upload-transfer"><span>{bytes(job.uploaded)} / {bytes(job.size)}</span><strong>{Math.floor(job.percent)}%</strong></div>{job.phase==='uploading'&&job.speed>0&&<small>{bytes(job.speed)}/s · {eta(job)}</small>}{job.phase==='preparing'&&<small>Checking the destination and creating an upload session…</small>}{job.phase==='verifying'&&<small>Transfer finished. Checking the stored file before publishing the lesson…</small>}{job.error&&<p className="pbs-upload-error" role="alert">{job.error}</p>}<div className="pbs-upload-card-actions">{['failed','cancelled'].includes(job.phase)&&<Button quiet onClick={retry}><RotateCcw size={14}/>Retry</Button>}{['queued','preparing','uploading'].includes(job.phase)&&<button type="button" onClick={cancel}><X size={14}/>Cancel</button>}<button type="button" onClick={()=>uploadLogDownload([job])}><Download size={14}/>Log</button>{['failed','cancelled'].includes(job.phase)&&<button type="button" onClick={dismiss}>Dismiss</button>}</div><details><summary><FileText size={13}/>Activity & errors</summary><ol>{job.logs.map((log,i)=><li key={i}><time>{new Date(log.at).toLocaleTimeString()}</time><span>{log.message}{log.code&&<small>{log.code}{log.status?` · HTTP ${log.status}`:''}{log.requestId?` · Request ${log.requestId}`:''}</small>}</span></li>)}</ol></details></article>;
}
