import type { jsPDF } from 'jspdf';
import type { DocumentStamp } from './document-types';
import { fitPdfImage } from './pdf-image';

export function drawPdfStamp(pdf: jsPDF, stamp: DocumentStamp, x: number, y: number, radius = 14) {
  if (!stamp.enabled) return;
  if (stamp.imageData) {
    try { fitPdfImage(pdf,stamp.imageData,x-radius,y-radius,radius*2,radius*2); return; }
    catch { /* Keep a legible institutional seal if an older image is invalid. */ }
  }
  pdf.setDrawColor(stamp.color); pdf.setLineWidth(.5);
  if (stamp.design === 'round') pdf.circle(x, y, radius); else pdf.roundedRect(x - radius, y - radius, radius * 2, radius * 2, 1, 1);
  pdf.setDrawColor(stamp.accent); pdf.setLineWidth(.3);
  if (stamp.design === 'round') pdf.circle(x, y, radius - 1.4); else pdf.roundedRect(x - radius + 1.4, y - radius + 1.4, (radius - 1.4) * 2, (radius - 1.4) * 2, 1, 1);
  const text = (value: string, at: number, size: number, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size * radius / 14); pdf.setTextColor(stamp.color);
    const lines: string[] = pdf.splitTextToSize(value, radius * 1.58); pdf.text(lines.slice(0, 2), x, at, { align: 'center', lineHeightFactor: 1.1 });
  };
  text(stamp.institution, y - radius * .55, 5.5, true);
  text(stamp.center, y + radius * .08, 10, true);
  text(stamp.caption, y + radius * .43, 5.2);
  if (stamp.location) text(stamp.location, y + radius * .72, 4.5);
  pdf.setFillColor(stamp.accent); pdf.circle(x - radius * .76, y, .55); pdf.circle(x + radius * .76, y, .55);
}
