import type { VisitCategory } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { maskDocument } from './crypto';
import { addDays, localDate, zonedToUtc } from './time';

export interface AttendanceRow {
  visitorId: string;
  name: string;
  documentMasked: string;
  department: string;
  daysPresent: number;
  /** Share of the period's working days (Mon–Fri) with a check-in, 0–100. */
  attendancePct: number;
  totalMinutes: number;
  averageMinutesPerDay: number;
  lateArrivals: number;
  missedCheckouts: number;
  firstDay: string;
  lastDay: string;
  insideNow: boolean;
}

export interface AttendanceReport {
  from: string;
  to: string;
  workingDays: number;
  startTime: string;
  rows: AttendanceRow[];
}

/** Monday–Friday dates from `from` to `to` inclusive, not counting days that haven't happened yet. */
export function workingDays(from: string, to: string, today: string): number {
  let count = 0;
  const last = to < today ? to : today;
  for (let d = from; d <= last; d = addDays(d, 1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function localTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
}

/**
 * Attendance per person for a date range: days present, hours on site, late arrivals (checked in
 * after ATTENDANCE_START_TIME) and missed check-outs (visits closed automatically at the end of
 * the day). Hours and the daily average count only visits that were properly checked out.
 */
export async function attendanceReport(from: string, to: string, category: VisitCategory, now = new Date()): Promise<AttendanceReport> {
  const visits = await prisma.visit.findMany({
    where: {
      category,
      checkInAt: { gte: zonedToUtc(from, '00:00', env.TIMEZONE), lt: zonedToUtc(addDays(to, 1), '00:00', env.TIMEZONE) },
    },
    include: { visitor: true },
    orderBy: { checkInAt: 'asc' },
  });

  const byPerson = new Map<string, typeof visits>();
  for (const v of visits) byPerson.set(v.visitorId, [...(byPerson.get(v.visitorId) ?? []), v]);

  const days = workingDays(from, to, localDate(now, env.TIMEZONE));
  const rows: AttendanceRow[] = [...byPerson.values()].map((list) => {
    const first = list[0];
    const last = list[list.length - 1];
    const dates = new Set(list.map((v) => localDate(v.checkInAt!, env.TIMEZONE)));
    const missed = list.filter((v) => v.flagged && v.flagReason?.startsWith('Not checked out'));
    // Hours count only real check-outs: a forgotten one was closed at end of day, which would overstate them.
    const timed = list.filter((v) => v.checkOutAt && v.status === 'CHECKED_OUT' && !missed.includes(v));
    const totalMinutes = timed.reduce((sum, v) => sum + Math.round((v.checkOutAt!.getTime() - v.checkInAt!.getTime()) / 60_000), 0);
    const timedDays = new Set(timed.map((v) => localDate(v.checkInAt!, env.TIMEZONE))).size;
    // Only the first check-in of a day can be late.
    const firstOfDay = new Map<string, Date>();
    for (const v of list) {
      const d = localDate(v.checkInAt!, env.TIMEZONE);
      if (!firstOfDay.has(d)) firstOfDay.set(d, v.checkInAt!);
    }
    const late = [...firstOfDay.values()].filter((at) => localTime(at) > env.ATTENDANCE_START_TIME).length;
    return {
      visitorId: first.visitorId,
      name: last.visitor.fullName,
      documentMasked: maskDocument(last.visitor.documentLast4),
      department: last.department,
      daysPresent: dates.size,
      attendancePct: days ? Math.min(100, Math.round((dates.size / days) * 100)) : 0,
      totalMinutes,
      averageMinutesPerDay: timedDays ? Math.round(totalMinutes / timedDays) : 0,
      lateArrivals: late,
      missedCheckouts: missed.length,
      firstDay: localDate(first.checkInAt!, env.TIMEZONE),
      lastDay: localDate(last.checkInAt!, env.TIMEZONE),
      insideNow: list.some((v) => v.status === 'CHECKED_IN'),
    };
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { from, to, workingDays: days, startTime: env.ATTENDANCE_START_TIME, rows };
}
