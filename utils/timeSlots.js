/** Generate HH:mm slots between start and end using a duration step. */

export function timeToMinutes(hhmm) {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToTime(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Build slots from window + duration.
 * Example: 09:00–18:00 step 30 → 09:00, 09:30, … 17:30
 */
export function generateTimeSlots({
  dayStart = '09:00',
  dayEnd = '18:00',
  durationMinutes = 30,
  breakStart = '13:00',
  breakEnd = '14:00',
} = {}) {
  const step = Math.max(5, Math.min(240, Number(durationMinutes) || 30));
  const start = timeToMinutes(dayStart);
  const end = timeToMinutes(dayEnd);
  if (start == null || end == null || end <= start) return [];

  const brS = timeToMinutes(breakStart);
  const brE = timeToMinutes(breakEnd);
  const hasBreak = brS != null && brE != null && brE > brS;

  const slots = [];
  for (let t = start; t + step <= end; t += step) {
    const slotEnd = t + step;
    if (hasBreak && t < brE && slotEnd > brS) continue; // overlaps lunch
    slots.push(minutesToTime(t));
  }
  return slots;
}

/** Infer clinic day window from a doctor's saved slot list (legacy), else defaults. */
export function windowFromLegacySlots(slots = []) {
  const mins = (slots || []).map(timeToMinutes).filter((n) => n != null).sort((a, b) => a - b);
  if (!mins.length) return { dayStart: '09:00', dayEnd: '18:00' };
  return {
    dayStart: minutesToTime(mins[0]),
    // End = last slot + typical 60m so last hour remains bookable with shorter durations
    dayEnd: minutesToTime(Math.min(23 * 60, mins[mins.length - 1] + 60)),
  };
}

export function isValidHhMm(value) {
  return timeToMinutes(value) != null;
}
