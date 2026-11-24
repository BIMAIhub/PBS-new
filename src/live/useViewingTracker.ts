import { useEffect,useRef,useState,type RefObject } from 'react';
import { send,messageFrom } from './api';
import type { Lesson } from './types';
import type { WatchStatus } from './learning-types';

export function useViewingTracker(lesson:Lesson,video:RefObject<HTMLVideoElement|null>,enabled:boolean,onComplete?:()=>void){
  const [progress,setProgress]=useState<WatchStatus>({watched:0,duration:0,percent:0,completed:false}),[status,setStatus]=useState('');
  const session=useRef(''),cursor=useRef(0),lastKnown=useRef(0),sequence=useRef(0),lastSent=useRef(0),starting=useRef(false),sending=useRef(false),alive=useRef(true),completed=useRef(false);
  const pending=useRef<{to:number;seek:boolean;rate:number}[]>([]),callback=useRef(onComplete);callback.current=onComplete;
  async function start(){
    const v=video.current;if(!enabled||!v||!Number.isFinite(v.duration)||v.duration<=0||session.current||starting.current)return;
    const position=v.currentTime;
    starting.current=true;try{const result=await send<WatchStatus&{id:string}>(`/student/lessons/${lesson.id}/watch`,{duration:v.duration,position,mediaKey:lesson.mediaKey});session.current=result.id;cursor.current=position;lastKnown.current=position;sequence.current=0;lastSent.current=Date.now();if(alive.current){setProgress(result);setStatus('');}}catch(e){if(alive.current)setStatus(messageFrom(e));}finally{starting.current=false;}
  }
  async function drain(){
    if(sending.current||!session.current)return;sending.current=true;
    try{while(pending.current.length){const next=pending.current.shift()!,from=cursor.current;const result=await send<WatchStatus>(`/student/watch/${session.current}`,{from,to:next.to,seek:next.seek,rate:next.rate,sequence:++sequence.current},'PUT');cursor.current=next.to;if(alive.current){setProgress(result);setStatus(result.completed?'Lesson automatically completed':'Watched sections saved');}if(result.completed&&!completed.current){completed.current=true;callback.current?.();}}}
    catch(e){pending.current=[];session.current='';if(alive.current)setStatus(messageFrom(e));}finally{sending.current=false;}
  }
  function enqueue(to:number,seek=false){const v=video.current;if(!enabled||!session.current||!v||!Number.isFinite(to))return;pending.current.push({to,seek,rate:v.playbackRate});void drain();}
  function tick(force=false){const v=video.current;if(!v||v.seeking)return;if(!session.current){if(!v.paused)void start();return;}lastKnown.current=v.currentTime;if(force||Date.now()-lastSent.current>=10000){lastSent.current=Date.now();enqueue(v.currentTime);}}
  function seek(){const v=video.current;if(!v)return;enqueue(lastKnown.current);enqueue(v.currentTime,true);lastKnown.current=v.currentTime;lastSent.current=Date.now();}
  useEffect(()=>{alive.current=true;return()=>{tick(true);alive.current=false;};},[]);
  return{progress,status,start,tick,seek};
}
