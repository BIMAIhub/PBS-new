import { useRef, useState, type ReactNode } from 'react';
import { Download, Printer } from 'lucide-react';
import { PortalBrand, PortalDialog } from '../components/student-dashboard/PortalUI';
import type { Account, CourseSummary, Enrollment, Receipt, AssessmentResult } from './types';
import { Button, dateLabel, Empty, FormError, money, Panel } from './ui';
import { messageFrom } from './api';

export type DocumentInfo =
  | { kind: 'receipt'; receipt: Receipt }
  | { kind: 'id'; account: Account; enrollments: Enrollment[] }
  | { kind: 'letter'; account: Account; enrollment: Enrollment };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function DocumentContent({ document }: { document: DocumentInfo }) {
  if (document.kind === 'receipt') {
    const receipt = document.receipt;
    return <>
      <div className="pbs-doc-identity"><div><p>Payment receipt</p><h3>{receipt.number}</h3></div>
        <strong className="pbs-doc-total">{money(receipt.amount)}</strong></div>
      <dl className="pbs-document-fields">
        <Row label="Received from">{receipt.studentName}</Row>
        <Row label="Student ID">{receipt.studentId}</Row>
        <Row label="Course">{receipt.courseTitle}</Row>
        <Row label="Issued">{dateLabel(receipt.issuedAt)}</Row>
        <Row label="Payment method">{receipt.method}</Row>
        <Row label="Payment reference">{receipt.reference || 'On file'}</Row>
      </dl>
      <p className="pbs-doc-note">Pragmatic BIM Solution acknowledges receipt of the payment above.</p>
    </>;
  }
  const { account } = document;
  if (document.kind === 'id') {
    const active = document.enrollments.filter(enrollment => enrollment.status === 'approved');
    const initials = account.name.split(/\s+/).slice(0, 2).map(word => word[0]).join('');
    return <>
      <div className="pbs-id-identity"><span className="pbs-id-initials" aria-hidden="true">{initials}</span><div>
        <p>Student identification</p><h3>{account.name}</h3>
      </div></div>
      <dl className="pbs-document-fields">
        <Row label="Student ID">{account.id}</Row>
        <Row label="Roll number">{account.rollNumber}</Row>
        <Row label="Enrollment">{active.length ? 'Active student' : 'Awaiting enrollment'}</Row>
        <Row label="Registered">{dateLabel(account.createdAt)}</Row>
      </dl>
      {active.length > 0 && <p className="pbs-doc-note">{active.map(enrollment => enrollment.courseTitle).join(' · ')}</p>}
    </>;
  }
  if (document.kind === 'letter') {
    const enrollment = document.enrollment;
    return <>
      <p className="pbs-doc-kicker">Enrollment confirmation</p>
      <h3>Bonafide enrollment letter</h3>
      <p className="pbs-doc-body">Pragmatic BIM Solution confirms that <strong>{account.name}</strong> is enrolled in <strong>{enrollment.courseTitle}</strong>.</p>
      <dl className="pbs-document-fields">
        <Row label="Student ID">{account.id}</Row>
        <Row label="Roll number">{account.rollNumber}</Row>
        <Row label="Enrollment approved">{dateLabel(enrollment.approvedAt)}</Row>
        <Row label="Enrollment reference">{enrollment.id}</Row>
      </dl>
      <p className="pbs-doc-note">Issued at the student's request for enrollment verification.</p>
    </>;
  }
  return null;
}

const titles = { receipt: 'Payment receipt', id: 'Student ID', letter: 'Bonafide letter', certificate: 'Course certificate' };

export function DocumentDialog({ document, onClose }: { document: DocumentInfo; onClose: () => void }) {
  const paper = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    if (!paper.current) return;
    setBusy(true);
    setError('');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      await window.document.fonts.ready;
      const canvas = await html2canvas(paper.current, { scale: 2, backgroundColor: '#ffffff', logging: false });
      const landscape = document.kind === 'id';
      const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: landscape ? 'a5' : 'a4', compress: true });
      const availableWidth = pdf.internal.pageSize.getWidth() - 24;
      const availableHeight = pdf.internal.pageSize.getHeight() - 24;
      const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      const width = canvas.width * scale;
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (pdf.internal.pageSize.getWidth() - width) / 2, 12, width, canvas.height * scale);
      const reference = document.kind === 'receipt' ? document.receipt.number : document.account.id;
      pdf.save(`PBS-${document.kind}-${reference}.pdf`);
    } catch (problem) {
      setError(messageFrom(problem));
    } finally {
      setBusy(false);
    }
  }
  return <PortalDialog title={titles[document.kind]} className="pbs-dialog-wide pbs-document-dialog" onClose={onClose}>
    <div className="pbs-document-stage">
      <article className={`pbs-print-document pbs-document-${document.kind}`} ref={paper}>
        <PortalBrand subtitle="Learning records" />
        <DocumentContent document={document} />
        <footer className="pbs-doc-footer"><span>Pragmatic BIM Solution</span><span>info@pragmaticbim.com</span></footer>
      </article>
    </div>
    <FormError error={error} />
    <footer className="pbs-dialog-actions">
      <Button quiet onClick={() => window.print()}><Printer size={18} /> Print</Button>
      <Button disabled={busy} onClick={() => void download()}><Download size={18} /> {busy ? 'Preparing…' : 'Download PDF'}</Button>
    </footer>
  </PortalDialog>;
}

export function ReceiptList({ receipts, onOpen }: { receipts: Receipt[]; onOpen: (receipt: Receipt) => void }) {
  return <Panel title="Payment receipts">
    {!receipts.length && <Empty title="No receipts yet">Receipts appear when PBS records verified payments.</Empty>}
    {receipts.map(receipt => <article className="pbs-record-row" key={receipt.id}>
      <div><h3>{receipt.number}</h3><p>{receipt.courseTitle}</p><p className="pbs-muted">{receipt.studentName} · {dateLabel(receipt.issuedAt)}</p></div>
      <div className="pbs-actions"><strong>{money(receipt.amount)}</strong><Button quiet onClick={() => onOpen(receipt)}>View receipt</Button></div>
    </article>)}
  </Panel>;
}
