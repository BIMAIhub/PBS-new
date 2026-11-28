export interface CourseBatch { id:string;courseId:string;name:string;description:string;startsAt:string;endsAt:string;deadline:string;capacity:number;status:'draft'|'open'|'closed';revision:string;reserved:number;enrolled:number;remaining:number;accepting:boolean }
export interface ModuleRelease {moduleId:string;batchId:string;mode:'open'|'at'|'session'|'session_end'|'manual';releaseAt:string;classId:string;released:boolean;revision:string}
export interface AcademyNotice {id:string;title:string;body:string;kind:'notice'|'news';courseId:string;batchId:string;published:boolean;startsAt:string;expiresAt:string;revision:string;createdAt:string}
export interface WatchStatus {id?:string;watched:number;duration:number;percent:number;completed:boolean}
export interface BankDetails {holder:string;bank:string;account:string;ifsc:string;upi:string;revision:string}
export interface PayoutRecord {id:string;amount:number;status:'requested'|'processing'|'paid'|'rejected';reference:string;note:string;createdAt:string;paidAt:string;studentId?:string;studentName?:string;email?:string}
