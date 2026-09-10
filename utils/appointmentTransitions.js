import { APPOINTMENT_STATUSES } from '../models/Appointment.js';

/**
 * Valid appointment status transitions.
 */
const ALLOWED = {
  scheduled: ['confirmed', 'completed', 'cancelled', 'no_show'],
  confirmed: ['completed', 'cancelled', 'no_show'],
  pending: ['confirmed', 'completed', 'cancelled', 'no_show', 'scheduled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function normalizeStatus(status) {
  if (status === 'pending') return 'scheduled';
  return status;
}

export function canTransition(from, to) {
  const current = normalizeStatus(from);
  const target = normalizeStatus(to);
  if (!APPOINTMENT_STATUSES.includes(to) && !APPOINTMENT_STATUSES.includes(target)) return false;
  if (current === target) return true;
  return (ALLOWED[normalizeStatus(from)] || ALLOWED[from] || []).includes(target);
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    const err = new Error(`Cannot change appointment from ${from} to ${to}.`);
    err.status = 400;
    throw err;
  }
}
