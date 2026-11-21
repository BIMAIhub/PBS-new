import type { CertificateRecord } from './academy-types';
import type { Branding } from './branding-types';

export async function buildCertificatePdf(record: CertificateRecord, brand: Branding, assets: { logo?: string; qr?: string; verificationUrl?: string } = {}) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm', compress: true });
  const t = record.template;
  const fit = (text: string, width: number, size: number, minimum: number, maxLines = 2) => {
    pdf.setFontSize(size); let lines: string[] = pdf.splitTextToSize(text, width);
    while (lines.length > maxLines && size > minimum) { pdf.setFontSize(--size); lines = pdf.splitTextToSize(text, width); }
    return lines;
  };
  pdf.setProperties({ title: `${t.title} — ${record.studentName}`, subject: record.courseTitle, author: t.issuer, creator: brand.academyName });
  pdf.setFillColor('#F4F7FA'); pdf.rect(0, 0, 297, 210, 'F');
  pdf.setFillColor(t.primaryColor); pdf.rect(8, 8, 281, 194, 'F');
  pdf.setFillColor('#F6F3E9'); pdf.rect(12, 12, 273, 186, 'F');
  pdf.setDrawColor(t.accentColor); pdf.setLineWidth(.35); pdf.rect(15, 15, 267, 180);
  if (t.design === 'architectural') {
    pdf.setFillColor(t.accentColor); pdf.rect(8, 8, 3, 194, 'F'); pdf.triangle(269, 8, 289, 8, 289, 28, 'F');
    pdf.setDrawColor('#E7E1D1'); pdf.setLineWidth(.15);
    for (let n = 0; n < 5; n++) { pdf.line(248 + n * 6, 132, 248 + n * 6, 153); pdf.line(248, 132 + n * 5, 275, 132 + n * 5); }
  }
  if (t.design === 'classic') { pdf.setDrawColor(t.accentColor); pdf.setLineWidth(.7); pdf.rect(17, 17, 263, 176); }
  if (t.design === 'minimal') { pdf.setFillColor(t.accentColor); pdf.rect(12, 44, 273, 1, 'F'); }
  pdf.setFillColor(t.primaryColor); pdf.rect(12, 12, 273, 32, 'F');
  let hasLogo = false;
  if (assets.logo) { try { pdf.addImage(assets.logo, 'PNG', 22, 19, 18, 18); hasLogo = true; } catch { /* Fall back to the academy initials. */ } }
  if (!hasLogo) { pdf.setDrawColor(t.accentColor); pdf.setLineWidth(.5); pdf.roundedRect(22, 19, 18, 18, 3, 3); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor('#F4F7FA'); pdf.text(brand.shortName.slice(0, 8), 31, 30, { align: 'center' }); }
  pdf.setTextColor('#F4F7FA'); pdf.setFont('helvetica', 'bold'); pdf.text(fit(t.issuer, 180, 14, 10), 48, 25);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.text('PROFESSIONAL BIM EDUCATION', 48, 36);
  pdf.setDrawColor(t.accentColor); pdf.setLineWidth(.6); pdf.circle(266, 28, 10);
  pdf.setTextColor(t.accentColor); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.text(brand.shortName.slice(0, 8), 266, 29, { align: 'center' });
  pdf.setTextColor(t.primaryColor); pdf.setFont('times', 'normal'); pdf.text(fit(t.title, 245, 30, 19), 148.5, 65, { align: 'center' });
  pdf.setTextColor('#5B6E80'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.text('This is to certify that', 148.5, 83, { align: 'center' });
  pdf.setTextColor('#152C42'); pdf.setFont('times', 'italic'); pdf.text(fit(record.studentName, 235, 29, 17), 148.5, 99, { align: 'center' });
  pdf.setDrawColor(t.accentColor); pdf.setLineWidth(.4); pdf.line(85, 117, 212, 117);
  pdf.setTextColor('#5B6E80'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text('has successfully completed the learning requirements and assessment for', 148.5, 126, { align: 'center' });
  pdf.setTextColor(t.primaryColor); pdf.setFont('helvetica', 'bold'); pdf.text(fit(record.courseTitle, 230, 17, 11), 148.5, 139, { align: 'center' });
  pdf.setDrawColor('#D9CEB3'); pdf.setLineWidth(.25); pdf.line(24, 158, 273, 158);
  pdf.setTextColor('#152C42'); pdf.text(fit(t.signer, 82, 11, 8), 25, 168);
  pdf.setDrawColor(t.accentColor); pdf.line(25, 176, 96, 176);
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor('#5B6E80'); pdf.text(fit(t.signerRole, 82, 8, 7), 25, 182);
  const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }).format(new Date(record.issuedAt));
  pdf.setFontSize(9); pdf.setTextColor('#152C42'); pdf.text(`Issued ${date}`, 210, 169);
  pdf.setTextColor('#5B6E80'); pdf.text(fit(record.id, 63, 7, 6), 210, 179);
  if (assets.qr && assets.verificationUrl && record.published && !record.revokedAt) {
    pdf.addImage(assets.qr, 'PNG', 137, 163, 23, 23); pdf.link(137, 163, 23, 23, { url: assets.verificationUrl });
    pdf.setFontSize(6.5); pdf.text('SCAN TO VERIFY CREDENTIAL', 148.5, 191, { align: 'center' });
  } else { pdf.setFontSize(6.5); pdf.text('Private credential · Public verification can be enabled in the student workspace.', 148.5, 191, { align: 'center' }); }
  if (record.revokedAt) { pdf.setTextColor('#B83B34'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(46); pdf.text('REVOKED', 148.5, 111, { align: 'center' }); }
  return pdf;
}
