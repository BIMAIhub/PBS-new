import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Printer, Share2 } from 'lucide-react';
import type { jsPDF } from 'jspdf';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { messageFrom } from './api';
import { Button, FormError } from './ui';

export function PdfDocument({load,filename,label='Document'}:{load:()=>Promise<jsPDF>;filename:string;label?:string}) {
  const [file,setFile]=useState<{blob:Blob;url:string}>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{
    let active=true,url='';setFile(undefined);setError('');
    void load().then(pdf=>{if(!active)return;const blob=pdf.output('blob');url=URL.createObjectURL(blob);setFile({blob,url});}).catch(e=>{if(active)setError(messageFrom(e));});
    return()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[load,revision]);
  const shareFile=file?new File([file.blob],filename,{type:'application/pdf'}):undefined;
  const canShare=Boolean(shareFile&&typeof navigator!=='undefined'&&navigator.canShare?.({files:[shareFile]}));
  return <div className="pbs-pdf-document"><FormError error={error}/>{!file&&!error&&<p role="status" className="pbs-muted">Preparing your PDF…</p>}{error&&<Button quiet onClick={()=>setRevision(v=>v+1)}>Try again</Button>}
    {file&&<><PdfPages blob={file.blob} label={label}/><p className="pbs-muted pbs-small">This preview and download use the same fixed-size PDF pages on every device.</p><div className="pbs-dialog-actions pbs-pdf-actions">
      <a className="pbs-button pbs-button-outline" href={file.url} target="_blank" rel="noopener noreferrer"><Printer size={17}/>Open / print PDF</a>
      {canShare&&<Button quiet onClick={()=>{void navigator.share({files:[shareFile!],title:label}).catch(e=>{if(e?.name!=='AbortError')setError(messageFrom(e));});}}><Share2 size={17}/>Save / share file</Button>}
      <a className="pbs-button pbs-button-primary" href={file.url} download={filename}><Download size={17}/>Download PDF</a>
    </div></>}
  </div>;
}

function PdfPages({blob,label}:{blob:Blob;label:string}) {
  const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null),[pdf,setPdf]=useState<PDFDocumentProxy>(),[page,setPage]=useState(1),[width,setWidth]=useState(0),[error,setError]=useState(''),[rendering,setRendering]=useState(false);
  useEffect(()=>{const element=host.current;if(!element)return;const measure=()=>setWidth(Math.max(1,element.clientWidth));measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let stopped=false,document:PDFDocumentProxy|undefined,task:{destroy:()=>Promise<void>}|undefined;setPdf(undefined);setPage(1);setError('');
    void (async()=>{
      const [engine,worker]=await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'),import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')]);
      if(stopped)return;engine.GlobalWorkerOptions.workerSrc=worker.default;
      const pending=engine.getDocument({data:new Uint8Array(await blob.arrayBuffer()),enableXfa:false});task=pending;
      document=await pending.promise;if(!stopped)setPdf(document);else await pending.destroy();
    })().catch(e=>{if(!stopped)setError(messageFrom(e));});
    return()=>{stopped=true;void task?.destroy();};
  },[blob]);
  useEffect(()=>{
    if(!pdf||!canvas.current||!width)return;let stopped=false,render:{cancel:()=>void;promise:Promise<unknown>}|undefined;const target=canvas.current;
    setRendering(true);
    void pdf.getPage(page).then(async sheet=>{
      if(stopped)return;const base=sheet.getViewport({scale:1}),scale=width/base.width,dpr=Math.min(window.devicePixelRatio||1,2),viewport=sheet.getViewport({scale:scale*dpr});
      // Each effect owns its canvas; cancelling prevents simultaneous renders on resize.
      target.width=Math.floor(viewport.width);target.height=Math.floor(viewport.height);target.style.width='100%';target.style.height='auto';
      render=sheet.render({canvas:target,viewport});await render.promise;if(!stopped)setRendering(false);
    }).catch(e=>{if(!stopped){setError(messageFrom(e));setRendering(false);}});
    return()=>{stopped=true;render?.cancel();};
  },[pdf,page,width]);
  return <><div ref={host} className="pbs-pdf-stage" aria-busy={rendering}><canvas ref={canvas} role="img" aria-label={`${label}, page ${page}${pdf?` of ${pdf.numPages}`:''}`}/>{error&&<p className="pbs-muted">The preview is unavailable on this browser. Use Download PDF or Open / print PDF to view the document.</p>}</div>{pdf&&<div className="pbs-pdf-pagination"><Button quiet disabled={page===1||rendering} onClick={()=>setPage(p=>p-1)}><ChevronLeft size={17}/>Previous</Button><span aria-live="polite">Page {page} of {pdf.numPages}</span><Button quiet disabled={page===pdf.numPages||rendering} onClick={()=>setPage(p=>p+1)}>Next<ChevronRight size={17}/></Button></div>}</>;
}
