import PDFDocument from 'pdfkit';
import type { Response } from 'express';

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  width?: number; // PDF column width in points
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formula injection (=, +, -, @ at the start of a cell).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function sendCsv<T>(res: Response, filename: string, columns: Column<T>[], rows: T[]): void {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM so Excel opens UTF-8 names correctly.
  res.send('﻿' + lines.join('\r\n'));
}

export function sendPdf<T>(
  res: Response,
  filename: string,
  title: string,
  subtitle: string,
  columns: Column<T>[],
  rows: T[],
): void {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const fixed = columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const flexCount = columns.filter((c) => !c.width).length;
  const widths = columns.map((c) => c.width ?? (usable - fixed) / Math.max(flexCount, 1));

  doc.fontSize(14).font('Helvetica-Bold').text(title);
  doc.fontSize(9).font('Helvetica').fillColor('#555').text(subtitle).fillColor('black');
  doc.moveDown(0.8);

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const heights = cells.map((t, i) => doc.heightOfString(t, { width: widths[i] - 4 }));
    const h = Math.max(...heights) + 6;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (!bold) drawRow(columns.map((c) => c.header), true);
    }
    const y = doc.y;
    if (bold) doc.rect(left, y, usable, h).fill('#e5efe8').fillColor('black');
    let x = left;
    cells.forEach((t, i) => {
      doc.text(t, x + 2, y + 3, { width: widths[i] - 4 });
      x += widths[i];
    });
    doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.3).strokeColor('#ccc').stroke();
    doc.x = left;
    doc.y = y + h;
  };

  drawRow(columns.map((c) => c.header), true);
  for (const row of rows) drawRow(columns.map((c) => c.value(row)), false);
  if (rows.length === 0) doc.font('Helvetica').fontSize(9).text('No records match these filters.', left, doc.y + 6);

  doc.end();
}
