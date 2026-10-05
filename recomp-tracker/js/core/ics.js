// Calendar reminders as an .ics file. A web app on iPhone can't schedule
// notifications on its own, but the Calendar app can: open the file, tap "Add
// All", and iOS will alert you at the right times. Times are "floating" so they
// follow your phone's time zone.

import { fromISO, toISO, addDays } from './dates.js';

const CRLF = '\r\n';

export function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545: lines longer than 75 octets are folded with CRLF + space.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = ' ';
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join(CRLF);
}

const stamp = (d) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T` +
  `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}Z`;

const local = (iso, hhmm) => `${iso.replaceAll('-', '')}T${hhmm.replace(':', '')}00`;

// First date on or after `iso` that falls on weekday `dow` (0 = Sunday).
export function nextWeekday(iso, dow) {
  let d = iso;
  while (fromISO(d).getDay() !== dow) d = addDays(d, 1);
  return d;
}

/**
 * @param startDate  ISO date to start from (usually today)
 * @param times      { weigh, log, measure, review } as 'HH:MM'
 */
export function buildReminders({ startDate, times = {}, now = new Date() }) {
  const t = { weigh: '07:00', log: '21:00', measure: '08:00', review: '09:00', ...times };
  const sunday = nextWeekday(startDate, 0);
  const events = [
    { id: 'weigh', title: 'Weigh in', note: 'Same conditions every day: after the toilet, before food or water, same scale. Log it in Recomp Tracker.', date: startDate, time: t.weigh, rrule: 'FREQ=DAILY' },
    { id: 'log', title: 'Log today in Recomp Tracker', note: 'Meals, water, supplements, sleep. Unlogged days count as missed in the review.', date: startDate, time: t.log, rrule: 'FREQ=DAILY' },
    { id: 'measure', title: 'Weekly measurements', note: 'Chest, waist, hips, thigh, arm in the same spots. Take progress photos in the same light and pose.', date: sunday, time: t.measure, rrule: 'FREQ=WEEKLY;BYDAY=SU' },
    { id: 'review', title: 'Bi-weekly review: Hold or Next?', note: 'Open Progress > Weekly review and read the result before changing anything.', date: sunday, time: t.review, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU' },
  ];
  return buildICS(events, now);
}

export function buildICS(events, now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Recomp Tracker//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@recomp-tracker`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${local(e.date, e.time)}`,
      `DURATION:PT15M`,
      `RRULE:${e.rrule}`,
      `SUMMARY:${escapeText(e.title)}`,
      `DESCRIPTION:${escapeText(e.note)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(e.title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}

export { toISO };
