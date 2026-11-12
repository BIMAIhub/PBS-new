import { useState, type FormEvent } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { pbsAdminStore } from '../../utils/pbsAdminStore';
import { PortalDialog } from './PortalUI';

interface CheckEnrollmentModalProps {
  onClose: () => void;
  onUseIdentifier: (identifier: string) => void;
  onOpenEnrollment: () => void;
}

type EnrollmentStatus = 'confirmed' | 'pending' | 'rejected' | 'not-found' | 'unavailable';

export function CheckEnrollmentModal({ onClose, onUseIdentifier, onOpenEnrollment }: CheckEnrollmentModalProps) {
  const [identifier, setIdentifier] = useState('');
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = identifier.trim();
    if (!query) return;

    const normalized = query.toLowerCase();
    const matches = (value?: string) => value?.trim().toLowerCase() === normalized;
    const student = pbsAdminStore.getStudents().find(student =>
      [student.email, student.personalEmail, student.googleEmailId, student.rollNumber, student.studentId].some(matches)
    );
    if (student) {
      setStatus('confirmed');
      return;
    }

    const request = pbsAdminStore.getEnrollmentRequests().find(request =>
      [request.studentEmail, request.studentId].some(matches)
    );
    if (request) {
      setStatus(request.status === 'Approved & Assigned' ? 'confirmed' : request.status === 'Rejected' ? 'rejected' : 'pending');
      return;
    }

    setStatus(null);
    setChecking(true);
    try {
      const response = await fetch('/api/db/verify-student', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrRoll: query }),
      });
      if (!response.ok) throw new Error('Enrollment lookup unavailable');
      const result = await response.json();
      setStatus(result.status === 'pending' || result.status === 'rejected'
        ? result.status
        : result.found ? 'confirmed' : 'not-found');
    } catch {
      setStatus('unavailable');
    } finally {
      setChecking(false);
    }
  }

  const statusMessage: Record<EnrollmentStatus, string> = {
    confirmed: 'Enrollment confirmed. Continue to sign in.',
    pending: 'Your enrollment request is awaiting review.',
    rejected: 'Your enrollment request was declined. Contact PBS support for details.',
    'not-found': 'No enrollment was found. Check your details or explore the available courses.',
    unavailable: 'Enrollment lookup is temporarily unavailable. Try again in a moment.',
  };

  return (
    <PortalDialog title="Check enrollment" onClose={onClose}>
      <form className="pbs-enrollment-form" onSubmit={checkEnrollment}>
        <div className="pbs-field">
          <label htmlFor="pbs-enrollment-identifier">Email, roll number or student ID</label>
          <div className="pbs-field-input">
            <Search aria-hidden="true" />
            <input
              id="pbs-enrollment-identifier"
              type="text"
              autoCapitalize="none"
              data-dialog-focus
              required
              readOnly={checking}
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                setStatus(null);
              }}
            />
          </div>
        </div>
        <button type="submit" className="pbs-button pbs-button-primary" disabled={checking}>
          {checking ? 'Checking…' : 'Check status'}
        </button>
      </form>
      {status && <p className="pbs-enrollment-status" role="status">{statusMessage[status]}</p>}
      {status === 'confirmed' ? (
        <button type="button" className="pbs-text-button" onClick={() => onUseIdentifier(identifier.trim())}>
          Continue to sign-in <ArrowRight />
        </button>
      ) : (
        <button type="button" className="pbs-text-button" onClick={onOpenEnrollment}>
          Explore courses <ArrowRight />
        </button>
      )}
    </PortalDialog>
  );
}
