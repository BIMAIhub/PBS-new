import { useEffect, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { PortalDialog } from '../components/student-dashboard/PortalUI';
import { Button, Field } from './ui';

export function StudyTimer({ onClose }: { onClose: () => void }) {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(minutes * 60);
  const [deadline, setDeadline] = useState<number>();
  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (!left) setDeadline(undefined);
    };
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const display = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  return <PortalDialog title="Study timer" onClose={onClose}>
    <div className="pbs-live-form">
      <Field label="Session length"><select value={minutes} onChange={event => {
        const value = Number(event.target.value);
        setDeadline(undefined); setMinutes(value); setRemaining(value * 60);
      }}><option value={25}>25 minutes</option><option value={50}>50 minutes</option><option value={5}>5 minutes</option></select></Field>
      <div className="pbs-timer" role="timer">{display}</div>
      {remaining === 0 && <p className="pbs-form-status" role="status">Study session complete.</p>}
      <div className="pbs-actions">
        <Button disabled={!remaining} onClick={() => setDeadline(deadline ? undefined : Date.now() + remaining * 1000)}>
          {deadline ? <><Pause size={18} /> Pause</> : <><Play size={18} /> Start</>}
        </Button>
        <Button quiet onClick={() => { setDeadline(undefined); setRemaining(minutes * 60); }}><RotateCcw size={18} /> Reset</Button>
      </div>
    </div>
  </PortalDialog>;
}
