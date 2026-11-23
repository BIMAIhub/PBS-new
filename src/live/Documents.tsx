import { useState, type ReactNode } from 'react';
import { BadgeCheck, Download, Printer } from 'lucide-react';
import { PortalBrand, PortalDialog } from '../components/student-dashboard/PortalUI';
import type { Account, CourseSummary, Enrollment, Receipt, AssessmentResult } from './types';
import { Button, dateLabel, Empty, FormError, money, Panel } from './ui';
import { messageFrom } from './api';
import { useBranding } from './Branding';

import type { DocumentInfo, DocumentStamp } from './document-types';
import { buildDocumentPdf } from './document-pdf';
import { brandLogoData } from './Branding';
import { api } from './api';
import { DocumentSeal } from './InstitutionStamp';
export type { DocumentInfo } from './document-types';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children}</dd></div>;
}

function DocumentContent({ document }: { document: DocumentInfo }) {
  const { brand } = useBranding();
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
      {receipt.feeTotal !== undefined && <><div className="pbs-doc-fee-summary"><div><span>Agreed course fee</span><strong>{money(receipt.feeTotal)}</strong></div><div><span>Paid through this receipt</span><strong>{money(receipt.paidToDate || 0)}</strong></div><div><span>Balance after this payment</span><strong>{money(receipt.balanceAfter || 0)}</strong></div></div>{receipt.dueDate && <p className="pbs-doc-note">Payment due date on record: {dateLabel(receipt.dueDate)}</p>}<p className="pbs-doc-note">The balance shown is a snapshot after this payment. Download a current fee statement for later payments.</p></>}
      <p className="pbs-doc-note">{brand.academyName} acknowledges receipt of the payment above.</p>
      <div className="pbs-doc-endorsement"><BadgeCheck size={25} /><span>Payment recorded<strong>Issued from the PBS payment ledger</strong></span></div>
    </>;
  }
  if (document.kind === 'statement') {
    const enrollment = document.enrollment;
    const history = document.receipts.filter(item => item.enrollmentId === enrollment.id);
    return <><p className="pbs-doc-kicker">Student financial record</p><h3>Course fee statement</h3><p className="pbs-doc-body">{enrollment.studentName} · {enrollment.courseTitle}</p><dl className="pbs-document-fields"><Row label="Student ID">{enrollment.studentId}</Row><Row label="Email">{enrollment.email}</Row><Row label="Enrollment reference">{enrollment.id}</Row><Row label="Statement date">{dateLabel(new Date().toISOString())}</Row></dl><div className="pbs-doc-fee-summary"><div><span>Agreed fee</span><strong>{money(enrollment.total)}</strong></div><div><span>Verified payments</span><strong>{money(enrollment.paid)}</strong></div><div><span>Pending balance</span><strong>{money(enrollment.total - enrollment.paid)}</strong></div></div>{enrollment.dueDate && <p className="pbs-doc-note">Balance due: {dateLabel(enrollment.dueDate)}</p>}{enrollment.requestedPayment > 0 && <p className="pbs-doc-note">{money(enrollment.requestedPayment)} is awaiting verification and is not included in paid totals.</p>}<h4 className="pbs-doc-subtitle">Verified payment history</h4>{history.length ? <div className="pbs-doc-payments">{history.map(item => <div key={item.id}><span>{item.number}<small>{dateLabel(item.issuedAt)} · {item.method}</small></span><strong>{money(item.amount)}</strong></div>)}</div> : <p className="pbs-doc-note">No verified payments recorded.</p>}<p className="pbs-doc-note">This statement summarizes the current enrollment ledger and is separate from individual payment receipts.</p></>;
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
      <p className="pbs-doc-kicker">Academic records · {enrollment.approvedAt.slice(0, 4) || new Date().getFullYear()}</p>
      <h3>Bonafide enrollment certificate</h3>
      <p className="pbs-doc-salutation">To whom it may concern</p>
      <p className="pbs-doc-body">This is to certify that <strong>{account.name}</strong>, registered with {brand.academyName}, holds an approved enrollment in <strong>{enrollment.courseTitle}</strong>.</p>
      <dl className="pbs-document-fields">
        <Row label="Student ID">{account.id}</Row>
        <Row label="Roll number">{account.rollNumber}</Row>
        <Row label="Enrollment approved">{dateLabel(enrollment.approvedAt)}</Row>
        <Row label="Enrollment reference">{enrollment.id}</Row>
        <Row label="Registered email">{account.email}</Row>
        <Row label="Date issued">{dateLabel(new Date().toISOString())}</Row>
      </dl>
      <p className="pbs-doc-body">The student is registered for the learning and practical work provided through this program. This document confirms enrollment and does not certify course completion or employment.</p>
      <div className="pbs-doc-endorsement"><BadgeCheck size={29} /><span>Enrollment confirmed<strong>{brand.academyName} · Academic office</strong></span></div>
      <p className="pbs-doc-note">Issued at the student's request. For verification, contact {brand.supportEmail} and quote the enrollment reference above.</p>
    </>;
  }
  return null;
}

const titles = { receipt: 'Payment receipt', statement: 'Course fee statement', id: 'Student ID', letter: 'Bonafide letter', certificate: 'Course certificate' };

export function DocumentDialog({ document, onClose }: { document: DocumentInfo; onClose: () => void }) {
  const { brand } = useBranding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download(print = false) {
    const target = print ? window.open('', '_blank') : null;
    if (target) target.opener = null;
    setBusy(true); setError('');
    try {
      const stamp = await api<DocumentStamp>('/document-stamp');
      let logo: string | undefined;
      try { logo = await brandLogoData(brand); } catch { /* The institution name remains visible. */ }
      const pdf = await buildDocumentPdf(document, brand, stamp, { logo });
      const reference = document.kind === 'receipt' ? document.receipt.number : document.kind === 'statement' ? document.enrollment.id : document.account.id;
      if (print && target) {
        pdf.autoPrint(); const url = URL.createObjectURL(pdf.output('blob')); target.location.replace(url);
        window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      } else pdf.save(`PBS-${document.kind}-${reference}.pdf`);
    } catch (problem) { target?.close(); setError(messageFrom(problem)); }
    finally { setBusy(false); }
  }
  return <PortalDialog title={titles[document.kind]} className="pbs-dialog-wide pbs-document-dialog" onClose={onClose}>
    <div className="pbs-document-stage">
      <article className={`pbs-print-document pbs-document-${document.kind}`}>
        <PortalBrand subtitle="Learning records" />
        <DocumentContent document={document} />
        <DocumentSeal /><footer className="pbs-doc-footer"><span>{brand.academyName}</span><span>{brand.supportEmail}</span></footer>
      </article>
    </div>
    <FormError error={error} />
    <footer className="pbs-dialog-actions">
      <Button quiet disabled={busy} onClick={() => void download(true)}><Printer size={18} /> Print</Button>
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
