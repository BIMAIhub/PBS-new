import { drawPdfBrand } from './pdf-image';
import { installPdfFonts } from './pdf-fonts';
import type { Branding } from './branding-types';
import type { DocumentInfo, DocumentStamp } from './document-types';
import { drawPdfStamp } from './pdf-stamp';

const text = (value: unknown) => String(value ?? '').replace(/₹/g, 'INR ').replace(/[–—]/g, '-');
const currency = (amount: number) => `INR ${(amount / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) => value ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(value)) : 'Not recorded';

// Physical page geometry is independent of the dialog, screen width and zoom.
export async function buildDocumentPdf(document: DocumentInfo, brand: Branding, stamp: DocumentStamp, assets: { logo?: string } = {}) {
  const { jsPDF } = await import('jspdf');
  const idCard = document.kind === 'id';
  const pdf = new jsPDF({ orientation: idCard ? 'landscape' : 'portrait', format: idCard ? 'a5' : 'a4', unit: 'mm', compress: true, putOnlyUsedFonts:true });
  await installPdfFonts(pdf);
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight(), margin = 14, inner = width - margin * 2;
  const title = { receipt: 'Payment receipt', statement: 'Course fee statement', letter: 'Bonafide enrollment certificate', id: 'Student identification' }[document.kind];
  const reference = document.kind === 'receipt' ? document.receipt.number : document.kind === 'statement' || document.kind === 'letter' ? document.enrollment.id : document.account.id;
  let y = 50;
  const bottom = idCard ? height - 43 : height - 62;
  const label = (value: string, x: number, at: number, size = 9, bold = false, color = '#152C42') => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); pdf.setTextColor(color); pdf.text(text(value), x, at); };
  function header() {
    pdf.setFillColor('#F4F7FA'); pdf.rect(0, 0, width, height, 'F');
    pdf.setFillColor(brand.primaryColor); pdf.rect(0, 0, width, 5, 'F');
    drawPdfBrand(pdf,margin,10,25,21,assets.logo);const left=margin+31;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(brand.primaryColor);
    pdf.text(pdf.splitTextToSize(text(brand.academyName), inner-31), left, 17);
    label(brand.supportEmail, left, 29, 8, false, '#53687A');
    pdf.setDrawColor(brand.accentColor); pdf.setLineWidth(.5); pdf.line(margin, 34, width - margin, 34);
    label(title, margin, 44, idCard ? 16 : 19, true, brand.primaryColor); y = 54;
  }
  function ensure(space: number) { if (y + space > bottom) { pdf.addPage(); header(); } }
  function paragraph(value: string, size = 10, color = '#40566A') {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(size);
    const lines: string[] = pdf.splitTextToSize(text(value), inner);
    for (const line of lines) { ensure(5); label(line, margin, y, size, false, color); y += 5; }
    y += 4;
  }
  function fields(entries: [string, string][]) {
    const cell = (inner - 10) / 2;
    const valueSize = idCard ? 8 : 10, leading = idCard ? 3.6 : 4.6;
    for (let index = 0; index < entries.length; index += 2) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(valueSize);
      const pair = entries.slice(index, index + 2).map(([name, value]) => ({ name, lines: pdf.splitTextToSize(text(value), cell) as string[] }));
      const rowHeight = Math.max(...pair.map(p => p.lines.length)) * leading + (idCard ? 9 : 11);
      ensure(rowHeight);
      pair.forEach((entry, i) => { const x = margin + i * (cell + 10); label(entry.name, x, y, idCard ? 7 : 8, false, '#53687A'); entry.lines.forEach((line, n) => label(line, x, y + 6 + n * leading, valueSize, true)); });
      y += rowHeight;
    }
  }
  function summary(values: [string, number][]) {
    ensure(30); const cell = inner / values.length;
    pdf.setFillColor('#EEE3C8'); pdf.setDrawColor(brand.accentColor); pdf.setLineWidth(.2); pdf.roundedRect(margin, y - 2, inner, 25, 2, 2, 'FD');
    values.forEach(([name, amount], i) => { label(name, margin + i * cell + 4, y + 5, 7.4, false, '#53687A'); label(currency(amount), margin + i * cell + 4, y + 15, 11, true, brand.primaryColor); });
    y += 32;
  }
  pdf.setProperties({ title: `${title} - ${reference}`, author: brand.academyName, creator: brand.academyName });
  header();
  if (document.kind === 'receipt') {
    const r = document.receipt;
    paragraph(r.number, 12, brand.primaryColor);
    fields([['Received from', r.studentName], ['Student ID', r.studentId], ['Course', r.courseTitle], ['Issued', date(r.issuedAt)], ['Payment method', r.method], ['Payment reference', r.reference || 'On file']]);
    summary([['Payment received', r.amount], ['Course fee', r.feeTotal ?? r.amount], ['Pending after payment', r.balanceAfter ?? 0]]);
    if (r.paidToDate !== undefined) paragraph(`Verified payments through this receipt: ${currency(r.paidToDate)}.`);
    if (r.dueDate) paragraph(`Payment due date on record: ${date(r.dueDate)}.`);
    paragraph(`${brand.academyName} acknowledges receipt of the payment above. The balance is a snapshot after this payment. A current fee statement includes later payments.`, 9);
  } else if (document.kind === 'statement') {
    const e = document.enrollment;
    fields([['Student', e.studentName], ['Student ID', e.studentId], ['Course', e.courseTitle], ['Email', e.email], ['Enrollment reference', e.id], ['Statement issued', date(new Date().toISOString())]]);
    summary([['Agreed fee', e.total], ['Verified payments', e.paid], ['Outstanding balance', e.total - e.paid]]);
    if (e.requestedPayment > 0) paragraph(`${currency(e.requestedPayment)} is awaiting verification and is not included in verified payments.`, 9);
    if (e.dueDate) paragraph(`Balance due: ${date(e.dueDate)}.`, 9);
    ensure(12); label('Verified payment history', margin, y, 11, true); y += 8;
    const history = document.receipts.filter(r => r.enrollmentId === e.id);
    if (!history.length) paragraph('No verified payments recorded.');
    for (const r of history) {
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8);
      const details: string[] = pdf.splitTextToSize(text(`${date(r.issuedAt)} | ${r.method} | ${r.reference || 'Reference on file'}`), inner - 48);
      ensure(11 + details.length * 3.5); label(r.number, margin, y, 9, true); label(currency(r.amount), width - margin - 43, y, 10, true, brand.primaryColor); y += 4;
      details.forEach(line => { label(line, margin, y, 8, false, '#53687A'); y += 3.5; });
      pdf.setDrawColor('#D7DDE2'); pdf.setLineWidth(.15); pdf.line(margin, y + 2, width - margin, y + 2); y += 7;
    }
  } else if (document.kind === 'letter') {
    const e = document.enrollment, a = document.account;
    paragraph('TO WHOM IT MAY CONCERN', 10, brand.primaryColor);
    paragraph(`This is to certify that ${a.name}, registered with ${brand.academyName}, holds an approved enrollment in ${e.courseTitle}.`, 11);
    fields([['Student ID', a.id], ['Roll number', a.rollNumber], ['Registered email', a.email], ['Enrollment approved', date(e.approvedAt)], ['Enrollment reference', e.id], ['Date issued', date(new Date().toISOString())]]);
    paragraph('The student is registered for the learning and practical work provided through this program. This document confirms enrollment; it does not certify course completion or employment.');
    paragraph(`Issued at the student's request. For verification, contact ${brand.supportEmail} and quote the enrollment reference above.`, 9);
  } else {
    const a = document.account, active = document.enrollments.filter(e => e.status === 'approved');
    fields([['Student', a.name], ['Student ID', a.id], ['Roll number', a.rollNumber], ['Registered', date(a.createdAt)], ['Enrollment', active.length ? `${active.length} approved course(s)` : 'Awaiting enrollment'], ['Institution', brand.shortName]]);
  }
  const pages = pdf.getNumberOfPages();
  for (let index = 1; index <= pages; index++) {
    pdf.setPage(index);
    drawPdfStamp(pdf, stamp, width - margin - (idCard ? 12 : 16), height - (idCard ? 31 : 35), idCard ? 10 : 14);
    pdf.setDrawColor(brand.accentColor); pdf.setLineWidth(.3); pdf.line(margin, height - 17, width - margin, height - 17);
    label(brand.academyName, margin, height - 11, 7, false, '#53687A');
    label(`${index} / ${pages}`, width - margin - 10, height - 11, 7, false, '#53687A');
  }
  return pdf;
}
