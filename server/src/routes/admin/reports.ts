import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../env';
import { type AttendanceRow, attendanceReport } from '../../lib/attendance';
import { audit } from '../../lib/audit';
import { type Column, sendCsv, sendPdf } from '../../lib/export';
import { HttpError } from '../../lib/http';
import { formatDateTime } from '../../lib/time';
import { isoDate } from '../../schemas';

export const reportsRouter = Router();

const query = z.object({
  from: isoDate,
  to: isoDate,
  category: z.enum(['attachee', 'visitor']).default('attachee'),
});

function parse(q: unknown) {
  const input = query.parse(q);
  if (input.from > input.to) throw new HttpError(400, 'The start date must be before the end date.');
  return input;
}

function hours(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const columns: Column<AttendanceRow>[] = [
  { header: 'Name', value: (r) => r.name, width: 130 },
  { header: 'ID', value: (r) => r.documentMasked, width: 60 },
  { header: 'Department', value: (r) => r.department, width: 85 },
  { header: 'Days present', value: (r) => String(r.daysPresent), width: 50 },
  { header: 'Attendance %', value: (r) => `${r.attendancePct}%`, width: 55 },
  { header: 'Total hours', value: (r) => hours(r.totalMinutes), width: 55 },
  { header: 'Average per day', value: (r) => hours(r.averageMinutesPerDay), width: 60 },
  { header: 'Late arrivals', value: (r) => String(r.lateArrivals), width: 50 },
  { header: 'Missed check-outs', value: (r) => String(r.missedCheckouts), width: 55 },
  { header: 'First day', value: (r) => r.firstDay, width: 60 },
  { header: 'Last day', value: (r) => r.lastDay, width: 60 },
];

/** Attendance per person (attachees by default) for a date range. */
reportsRouter.get('/attendance', async (req, res) => {
  const { from, to, category } = parse(req.query);
  res.json(await attendanceReport(from, to, category));
});

reportsRouter.get('/attendance/export/:format', async (req, res) => {
  const format = z.enum(['csv', 'pdf']).parse(req.params.format);
  const { from, to, category } = parse(req.query);
  const report = await attendanceReport(from, to, category);
  await audit(req, 'EXPORT_ATTENDANCE', { format, from, to, category, rows: report.rows.length });

  const who = category === 'attachee' ? 'Attachee' : 'Visitor';
  const name = `${who.toLowerCase()}-attendance-${from}-to-${to}`;
  if (format === 'csv') {
    sendCsv(res, `${name}.csv`, columns, report.rows);
  } else {
    const subtitle = `${from} to ${to} · ${report.workingDays} working day(s) · late after ${report.startTime} · generated ${formatDateTime(new Date(), env.TIMEZONE)} by ${req.staff!.name}`;
    const title = `${env.ORG_NAME ? `${env.ORG_NAME} - ` : ''}${who} attendance`;
    sendPdf(res, `${name}.pdf`, title, subtitle, columns, report.rows);
  }
});
