import { dateLabel,ExternalLink,FormError,useApiResource } from './ui';
export function AssignmentReviewFiles({taskId}:{taskId:string}){
  const {data,error}=useApiResource<{files:{id:string;filename:string;size:number;webUrl:string;createdAt:string;studentName:string;batchName:string}[]}>(`/admin/tasks/${taskId}/files`);
  return <div className="pbs-assignment-files"><FormError error={error}/>{data?.files.map(f=><article className="pbs-record-row" key={f.id}><div><strong>{f.filename}</strong><p className="pbs-muted pbs-small">{f.studentName} · {f.batchName||'Individual enrollment'} · {dateLabel(f.createdAt)} · {(f.size/1024**2).toFixed(1)} MB</p></div><ExternalLink href={f.webUrl}>Review in OneDrive</ExternalLink></article>)}</div>;
}
