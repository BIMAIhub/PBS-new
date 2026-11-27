import { useCallback,useEffect,useRef,useState } from 'react';
import { Award,Download,Gift,Mail,Share2 } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import type { CertificateRecord,CertificateTemplate } from './academy-types';
import type { ReferralDashboard } from './engagement-types';
import { messageFrom,send } from './api';
import { Button,dateTimeLabel,Field,FormError,money,useApiResource } from './ui';
import { useBranding,brandLogoData } from './Branding';
import { buildCertificatePdf } from './certificate-pdf';
import { PdfDocument } from './PdfDocument';
import type { DocumentStamp } from './document-types';
import { api } from './api';
import { preparePngAsset,type PreparedPng } from './png-assets';

export const certificatePdfUrl=(record:CertificateRecord,publicFile=false)=>publicFile?`${location.origin}/api/certificates/verify/${encodeURIComponent(record.publicToken)}/pdf`:`/api/certificates/${encodeURIComponent(record.id)}/pdf`;
export async function fetchCertificatePdf(url:string){const response=await fetch(url,{headers:{'X-PBS-Request':'1'}});if(!response.ok){const result=await response.json().catch(()=>null);throw new Error(result?.error||'The certificate PDF could not be loaded.');}if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('The server returned an unexpected certificate format. Refresh and try again.');return response.blob();}
export function ShareCertificatePdf({record}:{record:CertificateRecord}) {
  const [open,setOpen]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState('');
  const caption=`I completed ${record.courseTitle} with ${record.template.issuer}. Thank you for the learning and practical guidance.${record.published?`\n\nVerify my credential: ${location.origin}/verify/certificate/${encodeURIComponent(record.publicToken)}`:''}\n\n#BIM #RevitMEP #ProfessionalLearning`;
  return <><Button quiet onClick={()=>setOpen(true)}><Share2 size={16}/>Post PDF to LinkedIn</Button>{open&&<PortalDialog title="Share your certificate PDF" onClose={()=>setOpen(false)}><p>Share the actual A4 certificate as a LinkedIn document. Its logo, stamp, signature and details match your PBS download.</p><ol className="pbs-share-steps"><li><strong>Save the certificate PDF</strong><p>Download the file below, or use Share PDF file in the certificate viewer on a supported phone.</p><a className="pbs-button pbs-button-primary" href={`${certificatePdfUrl(record)}?download=1`} target="_blank" rel="noopener noreferrer"><Download size={16}/>Download certificate PDF</a></li><li><strong>Open LinkedIn and start a post</strong><p>Choose More → Document and select the downloaded PDF. Add a title and review your post before publishing.</p><a className="pbs-button pbs-button-outline" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener noreferrer">Open LinkedIn</a></li></ol><Field label="Suggested post text"><textarea value={caption} readOnly rows={6}/></Field><FormError error={error}/><Button quiet onClick={async()=>{try{await navigator.clipboard.writeText(caption);setCopied(true);}catch{setError('Select and copy the suggested post text.');}}}>{copied?'Post text copied':'Copy post text'}</Button><p className="pbs-muted pbs-small">Adding a license or certification to your LinkedIn profile is separate from uploading a PDF post.</p></PortalDialog>}</>;
}
export function CertificateEmail({record}:{record:CertificateRecord}) {
  const key=useRef(crypto.randomUUID()),[delivery,setDelivery]=useState<{status:string;error:string}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const history=useApiResource<{deliveries:{id:string;status:string;error:string;createdAt:string}[]}>(`/certificates/${record.id}/mail`),uncertain=['accepted','pending','unknown'].includes(delivery?.status||'');
  return <div className="pbs-certificate-email"><Button quiet disabled={busy||uncertain||Boolean(record.revokedAt)} onClick={async()=>{setBusy(true);setError('');if(delivery?.status==='failed')key.current=crypto.randomUUID();try{const result=await send<{status:string;error:string}>(`/certificates/${record.id}/mail`,{requestKey:key.current});setDelivery(result);await history.refresh();}catch(e){setError(messageFrom(e));}finally{setBusy(false);}}}><Mail size={17}/>{busy?'Sending PDF…':delivery?.status==='accepted'?'PDF accepted by Microsoft':delivery?.status==='failed'?'Retry certificate email':'Email certificate PDF'}</Button><p className="pbs-muted pbs-small">Sends the PDF to the student’s registered email. Use Share PDF file to send it through another app.</p><FormError error={error}/>{delivery&&<p className="pbs-muted" role="status">{delivery.status==='accepted'?'Microsoft accepted the email with the certificate PDF attached. The destination is the student’s registered email.':delivery.error||'Check delivery status before resending.'}</p>}{history.data?.deliveries.length? <details><summary>Certificate email history</summary>{history.data.deliveries.map(d=><p className="pbs-muted pbs-small" key={d.id}>{dateTimeLabel(d.createdAt)} · {d.status}{d.error?` · ${d.error}`:''}</p>)}</details>:null}</div>;
}
export function CertificatePngField({label,data,onChange,onBusy}:{label:string;data:string;onChange:(s:string)=>void;onBusy?:(busy:boolean)=>void}) {
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState<PreparedPng>();
  return <div className="pbs-inset"><Field label={label}><input type="file" accept="image/png,.png" disabled={busy} onChange={async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    setBusy(true);onBusy?.(true);setError('');setPrepared(undefined);
    try{const result=await preparePngAsset(file);onChange(result.data);setPrepared(result);}
    catch(e){setError(messageFrom(e));}finally{setBusy(false);onBusy?.(false);}
  }}/></Field><small>PNG files up to 10 MB are resized automatically. Transparent padding is trimmed; transparency and proportions are preserved.</small>
    {busy&&<p className="pbs-muted pbs-small" role="status">Preparing PNG for upload…</p>}
    {prepared&&data===prepared.data&&<p className="pbs-form-status" role="status">PNG ready: {prepared.width} × {prepared.height} pixels · {Math.ceil(prepared.byteLength/1024)} KB. Save your changes to apply it.</p>}
    <FormError error={error}/>{data&&<div className="pbs-png-preview"><img src={data} alt={label+' preview'}/><Button quiet disabled={busy} onClick={()=>{onChange('');setPrepared(undefined);}}>Remove PNG</Button></div>}
  </div>;
}
export function CertificateDesignPreview({template,courseTitle}:{template:CertificateTemplate;courseTitle:string}) {
  const {brand}=useBranding(),[draft,setDraft]=useState(template);
  useEffect(()=>{const timer=setTimeout(()=>setDraft(template),350);return()=>clearTimeout(timer);},[template]);
  const load=useCallback(async()=>buildCertificatePdf({id:'DESIGN-PREVIEW',studentId:'',courseId:draft.courseId,studentName:'Recipient name',courseTitle,score:0,issuedAt:'2026-01-01T12:00:00Z',publicToken:'',published:false,revokedAt:'',template:draft,historical:{completedAt:'2026-01-01',mode:'online',originalNumber:'',qualification:'',scoreRecorded:false,hasOriginal:false}},brand,{logo:brand.logoUploaded?await brandLogoData(brand):undefined},await api<DocumentStamp>('/document-stamp')),[draft,courseTitle,brand]);
  return <PdfDocument load={load} filename="PBS-certificate-design-preview.pdf" label="Certificate design preview"/>;
}
export function AlumniWelcome({accountId,onCertificate,onReferrals}:{accountId:string;onCertificate:(record:CertificateRecord)=>void;onReferrals:()=>void}) {
  const resource=useApiResource<{certificate:CertificateRecord|null}>('/student/alumni-welcome'),referral=useApiResource<ReferralDashboard>('/student/referral-dashboard'),[closed,setClosed]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setClosed(false);},[accountId]);const record=resource.data?.certificate;
  async function dismiss(){if(record)try{await send(`/student/alumni-welcome/${record.id}/seen`,{});setClosed(true);}catch(e){setError(messageFrom(e));}}
  if(!record||closed)return null;
  return <PortalDialog title="Your PBS certificate is ready" onClose={()=>void dismiss()}><div className="pbs-alumni-welcome"><Award size={40}/><h3>Thank you for learning with PBS, {record.studentName}.</h3><p>Your verified past training in {record.courseTitle} is now part of your PBS student profile. View your certificate, download the PDF and share your achievement.</p><Button onClick={async()=>{await dismiss();onCertificate(record);}}>View my certificate</Button>{referral.data?.program.enabled&&referral.data.codeEnabled!==false&&<section className="pbs-inset"><Gift size={25}/><h3>Refer a learner and earn {money(referral.data.program.rewardAmount)}</h3><p>Use your personal code <strong>{referral.data.code}</strong>. Rewards are subject to admin settings, verified fee payments and the waiting period.</p><Button quiet onClick={async()=>{await dismiss();onReferrals();}}>My referral dashboard</Button></section>}<FormError error={error}/><Button quiet onClick={()=>void dismiss()}>Continue to my workspace</Button></div></PortalDialog>;
}
