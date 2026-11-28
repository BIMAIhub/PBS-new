import {useRef,useState} from 'react';
import {Copy,Download,Upload} from 'lucide-react';
import {PortalDialog} from '../components/student-dashboard/PortalUI';
import {messageFrom,send} from './api';
import {Button,Field,FormError,Status} from './ui';
import type {PastContactImport,PastContactPreview} from './education-types';
import {accessDetailsCsv} from './past-student-csv';

export function PastStudentCsvImport({onClose,onSaved}:{onClose:()=>void;onSaved:()=>Promise<unknown>}) {
  const [csv,setCsv]=useState(''),[filename,setFilename]=useState(''),[preview,setPreview]=useState<PastContactPreview>(),[result,setResult]=useState<PastContactImport>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState('');
  const request=useRef({key:crypto.randomUUID(),passwords:{} as Record<string,string>});
  function download() {
    if(!result)return;
    const access=result.rows.flatMap(row=>row.access?[row.access]:[]),blob=new Blob([accessDetailsCsv(access)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='PBS-past-student-login-details.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <PortalDialog title={result?'Past-student accounts ready':'Import past-student contacts'} onClose={()=>{if(!busy)onClose();}} className="pbs-dialog-wide">
    <div className="pbs-live-form"><FormError error={error}/>{!result?<>
      <p className="pbs-muted">Create student logins from a CSV with Name, Email ID and Mobile Number columns. Training dates, enrollments, fees and certificates are left for you to add later. Existing accounts keep their passwords and profile.</p>
      <Field label="Student contact CSV"><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event=>{
        const file=event.target.files?.[0];event.target.value='';if(!file)return;setError('');setPreview(undefined);setCsv('');setFilename(file.name);request.current={key:crypto.randomUUID(),passwords:{}};
        if(file.size>200_000){setError('Choose a CSV below 200 KB.');return;}
        try{setCsv(await file.text());}catch{setError('The CSV could not be read. Save it as UTF-8 CSV and try again.');}
      }}/></Field>
      <Button quiet disabled={!csv||busy} onClick={async()=>{setBusy(true);setError('');try{
        const next=await send<PastContactPreview>('/admin/past-students/contacts/preview',{csv,source:filename});setPreview(next);
        for(const row of next.rows)if(!request.current.passwords[row.email]){const bytes=crypto.getRandomValues(new Uint8Array(18));request.current.passwords[row.email]='PBS-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
      }catch(e){setError(messageFrom(e));}finally{setBusy(false);}}}><Upload size={17}/>{busy?'Checking…':'Review CSV'}</Button>
      {preview&&<><div className="pbs-education-stats"><div><strong>{preview.total}</strong><span>Contacts</span></div><div><strong>{preview.created}</strong><span>New logins</span></div><div><strong>{preview.existing}</strong><span>Existing accounts</span></div><div><strong>{preview.blocked}</strong><span>Needs review</span></div></div>
        <div className="pbs-table-scroll"><table className="pbs-contact-table"><thead><tr><th>Student</th><th>Email / mobile</th><th>Import result</th></tr></thead><tbody>{preview.rows.map(row=><tr key={row.email}><td>{row.name}</td><td>{row.email}<br/>{row.phone}</td><td><Status value={row.status}/><p className="pbs-muted pbs-small">{row.reason}</p></td></tr>)}</tbody></table></div>
        <p className="pbs-muted pbs-small">Up to 25 contacts per file. New temporary passwords must be changed at first sign-in. This action sends no email and issues no certificates.</p>
        <Button disabled={busy||preview.blocked>0} onClick={async()=>{setBusy(true);setError('');try{
          const imported=await send<PastContactImport>('/admin/past-students/contacts/import',{csv,source:filename,requestKey:request.current.key,passwords:request.current.passwords,confirmed:true});setResult(imported);await onSaved();
        }catch(e){setError(messageFrom(e));}finally{setBusy(false);}}}>{busy?'Creating secure student logins…':`Import ${preview.total} contacts`}</Button>
      </>}
    </>:<>
      <h3>{result.total} contacts added · {result.created} new logins</h3><p className="pbs-muted">No emails were sent. Add verified course and certificate details later. Existing students keep their current passwords.</p>
      <p className="pbs-muted pbs-small">Download the private login list before closing this window. Temporary passwords are kept only in this import window, and students replace them at first sign-in.</p>
      <Button onClick={download}><Download size={17}/>Download login details CSV</Button>
      {result.rows.map(row=><article className="pbs-record-row" key={row.studentId}><div><h3>{row.name}</h3><p className="pbs-muted">{row.email}</p><small>{row.note}</small></div>{row.access&&<Button quiet onClick={async()=>{try{await navigator.clipboard.writeText(row.access!.body);setCopied(row.studentId);}catch{setError('Download the private login list to copy the message.');}}}><Copy size={16}/>{copied===row.studentId?'Copied':'Copy login message'}</Button>}</article>)}
    </>}</div>
  </PortalDialog>;
}
