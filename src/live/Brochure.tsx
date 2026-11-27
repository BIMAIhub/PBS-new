import { useCallback, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { api,messageFrom,send } from './api';
import { brandLogoData } from './Branding';
import type { CourseBrochure } from './education-types';
import type { DocumentStamp } from './document-types';
import { buildBrochurePdf } from './brochure-pdf';
import { PdfDocument } from './PdfDocument';
import { Button,DialogForm,FormError,Input,value } from './ui';

export function BrochureButton({courseId,title}:{courseId:string;title?:string}) {
  const [open,setOpen]=useState(false),[brochure,setBrochure]=useState<CourseBrochure>();
  return <><Button quiet onClick={()=>{setBrochure(undefined);setOpen(true);}}><Download size={17}/>Download brochure</Button>{open&&(brochure?<BrochurePreview brochure={brochure} onClose={()=>setOpen(false)}/>:<BrochureRequest courseId={courseId} title={title} onReady={setBrochure} onClose={()=>setOpen(false)}/>)}</>;
}
function BrochureRequest({courseId,title,onReady,onClose}:{courseId:string;title?:string;onReady:(b:CourseBrochure)=>void;onClose:()=>void}) {
  const key=useRef(crypto.randomUUID());
  return <DialogForm title="Get the course brochure" detail={title||'The curriculum, fees and available batches in one PDF.'} submit="Prepare my brochure" onClose={onClose} onSubmit={async form=>{
    const result=await send<{brochure:CourseBrochure}>(`/courses/${encodeURIComponent(courseId)}/brochure-request`,{requestKey:key.current,name:value(form,'name'),email:value(form,'email'),phone:value(form,'phone'),qualification:value(form,'qualification'),consent:form.has('consent')});onReady(result.brochure);
  }}><Input label="Full name" name="name" autoComplete="name" maxLength={120} required/><Input label="Email" name="email" type="email" autoComplete="email" maxLength={254} required/><Input label="WhatsApp number" name="phone" type="tel" autoComplete="tel" maxLength={25} required note="Include your country code, for example +91."/><Input label="Qualification / professional background (optional)" name="qualification" maxLength={160}/><p className="pbs-muted pbs-small">PBS saves these details with your course interest so the admissions team can follow up about this request.</p><label className="pbs-check"><input name="consent" type="checkbox"/>I would also like course offers and academy news by email. I can unsubscribe at any time.</label></DialogForm>;
}
export function BrochurePreview({brochure,onClose}:{brochure:CourseBrochure;onClose:()=>void}) {
  const load=useCallback(async()=>buildBrochurePdf(brochure,location.origin,await api<DocumentStamp>('/document-stamp'),await brandLogoData(brochure.brand).catch(()=>undefined)),[brochure]);
  return <PortalDialog title="Your course brochure" className="pbs-dialog-wide" onClose={onClose}><p>{brochure.title}</p><PdfDocument load={load} filename={`PBS-${brochure.id}-brochure.pdf`} label={`${brochure.title} brochure`}/></PortalDialog>;
}

export function AdminBrochureButton({courseId}:{courseId:string}) {
  const [brochure,setBrochure]=useState<CourseBrochure>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <><Button quiet disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setBrochure(await api<CourseBrochure>(`/admin/courses/${courseId}/brochure`));}catch(e){setError(messageFrom(e));}finally{setBusy(false);}}}>{busy?'Preparing…':'Preview course brochure'}</Button><FormError error={error}/>{brochure&&<BrochurePreview brochure={brochure} onClose={()=>setBrochure(undefined)}/>}</>;
}
