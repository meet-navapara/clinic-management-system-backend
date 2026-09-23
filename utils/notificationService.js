import Clinic from '../models/Clinic.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import User from '../models/User.js';
import NotificationLog from '../models/NotificationLog.js';
import { buildWhatsAppUrl } from './whatsapp.js';
import { normalizeStatus } from './appointmentTransitions.js';
import { notifyDoctor } from './doctorNotify.js';
import { recordPatientEvent } from './patientTimeline.js';
import { getCommsConfigStatus, sendViaChannel } from './comms/providers.js';

const isConfirmationType = (kind) => kind === 'appointment_confirmation';

function inboxWhatsAppCopy({ kind, ok, patientName, dateLabel, timeSlot, reason = '' }) {
  const confirm = isConfirmationType(kind);
  const label = confirm ? 'Confirmation' : 'Reminder';
  const visit = [dateLabel, timeSlot].filter(Boolean).join(' · ');
  const who = patientName || 'Patient';
  const parts = [who, visit].filter(Boolean);
  if (!ok && reason) parts.push(reason);
  return {
    title: ok ? `WhatsApp ${label.toLowerCase()} sent` : `WhatsApp ${label.toLowerCase()} failed`,
    body: parts.join(' · '),
  };
}

const combineDateAndSlot = (appointmentDate, timeSlot) => {
  const date = new Date(appointmentDate);
  const [hours, minutes] = String(timeSlot || '09:00').split(':').map(Number);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
};

const formatReminderMessage = ({
  patientName,
  doctorName,
  clinicName,
  dateLabel,
  timeSlot,
  kind,
}) => {
  if (kind === 'appointment_confirmation') {
    return `Hello ${patientName}, your appointment with Dr. ${doctorName} at ${clinicName} is confirmed for ${dateLabel} at ${timeSlot}.`;
  }
  return `Hello ${patientName}, this is a reminder that you have an appointment with Dr. ${doctorName} at ${clinicName} on ${dateLabel} at ${timeSlot}.`;
};

async function resolveParties(appointment) {
  let clinic = null;
  if (appointment.clinicId) {
    clinic = await Clinic.findById(appointment.clinicId);
  }

  let patientName = 'Patient';
  let recipientPhone = '';
  let patientId = appointment.patientId || null;

  if (appointment.patientId) {
    const patient =
      typeof appointment.patientId === 'object' && appointment.patientId?.name
        ? appointment.patientId
        : await Patient.findById(appointment.patientId);
    if (patient) {
      patientName = patient.name;
      recipientPhone = patient.phone || '';
      patientId = patient._id;
    }
  } else if (appointment.patient) {
    const legacy =
      typeof appointment.patient === 'object' && appointment.patient?.name
        ? appointment.patient
        : await User.findById(appointment.patient).select('name phone');
    if (legacy) {
      patientName = legacy.name;
      recipientPhone = legacy.phone || '';
    }
  }

  const doctor =
    typeof appointment.doctor === 'object' && appointment.doctor?.name
      ? appointment.doctor
      : await User.findById(appointment.doctor).select('name practiceSettings');

  return { clinic, patientName, recipientPhone, patientId, doctor };
}

async function createReminderIfMissing({
  appointment,
  notificationType,
  scheduledAt,
  hoursBefore = null,
  parties,
}) {
  const existingQuery = {
    appointmentId: appointment._id,
    notificationType,
    status: { $in: ['scheduled', 'sent', 'pending'] },
  };
  // Allow multiple appointment_reminder rows (24h + 2h) keyed by hoursBefore
  if (notificationType === 'appointment_reminder' && hoursBefore != null) {
    existingQuery['metadata.hoursBefore'] = Number(hoursBefore);
  }
  const existing = await NotificationLog.findOne(existingQuery);
  if (existing) return existing;

  const appointmentAt = combineDateAndSlot(appointment.appointmentDate, appointment.timeSlot);
  const dateLabel = appointmentAt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const message = formatReminderMessage({
    patientName: parties.patientName,
    doctorName: parties.doctor?.name || 'Doctor',
    clinicName: parties.clinic?.name || 'the clinic',
    dateLabel,
    timeSlot: appointment.timeSlot,
    kind: notificationType,
  });

  const whatsappReady = getCommsConfigStatus().whatsapp.configured;

  return NotificationLog.create({
    clinicId: appointment.clinicId || null,
    appointmentId: appointment._id,
    patientId: parties.patientId || null,
    recipientPhone: parties.recipientPhone,
    recipientName: parties.patientName,
    notificationType,
    channel: whatsappReady ? 'whatsapp' : 'log',
    message,
    scheduledAt,
    status: 'scheduled',
    provider: whatsappReady ? 'msg91' : 'none',
    metadata: {
      hoursBefore,
      appointmentAt,
    },
  });
}

/**
 * Schedule confirmation + pre-appointment reminders (idempotent).
 * Confirmation always schedules before any reminder for the same visit.
 */
export const scheduleAppointmentReminder = async (appointment) => {
  if (!appointment?._id) return null;
  const status = normalizeStatus(appointment.status);
  if (status === 'cancelled' || status === 'no_show' || status === 'completed') {
    return null;
  }

  const parties = await resolveParties(appointment);
  const doctorSettings = parties.doctor?.practiceSettings || {};
  const hoursList =
    (Array.isArray(doctorSettings.reminderHoursBefore) && doctorSettings.reminderHoursBefore.length
      ? doctorSettings.reminderHoursBefore
      : null) ||
    (parties.clinic?.reminderSettings?.appointmentHoursBefore
      ? [parties.clinic.reminderSettings.appointmentHoursBefore]
      : [24, 2]);

  const sendConfirmation = doctorSettings.sendConfirmationReminder !== false;
  const appointmentAt = combineDateAndSlot(appointment.appointmentDate, appointment.timeSlot);
  const now = new Date();
  const created = [];

  // Confirmation goes out first (about 20s after booking).
  let confirmAt = null;
  if (sendConfirmation && appointmentAt > now) {
    confirmAt = new Date(Math.min(now.getTime() + 20 * 1000, appointmentAt.getTime() - 1000));
    created.push(
      await createReminderIfMissing({
        appointment,
        notificationType: 'appointment_confirmation',
        scheduledAt: confirmAt,
        parties,
      })
    );
  }

  // Catch-up reminders (when "24h before" is already past) must wait until
  // after confirmation so WhatsApp never shows reminder before confirmed.
  const catchUpFloor = new Date(
    Math.max(now.getTime() + 2 * 60 * 1000, (confirmAt?.getTime() || now.getTime()) + 90 * 1000)
  );

  for (const hoursBefore of hoursList) {
    let scheduledAt = new Date(appointmentAt.getTime() - Number(hoursBefore) * 60 * 60 * 1000);
    if (scheduledAt < now && appointmentAt > now) {
      scheduledAt = catchUpFloor;
    }
    // Never schedule a reminder before confirmation for the same visit.
    if (confirmAt && scheduledAt <= confirmAt) {
      scheduledAt = new Date(confirmAt.getTime() + 90 * 1000);
    }
    if (appointmentAt <= now) continue;

    created.push(
      await createReminderIfMissing({
        appointment,
        notificationType: 'appointment_reminder',
        scheduledAt,
        hoursBefore: Number(hoursBefore),
        parties,
      })
    );
  }

  await Appointment.findByIdAndUpdate(appointment._id, { reminderScheduled: true });
  return created.filter(Boolean);
};

/**
 * Cancel scheduled reminders and optionally reschedule for a new time.
 */
export const cancelAppointmentReminders = async (appointmentId) => {
  await NotificationLog.updateMany(
    {
      appointmentId,
      status: { $in: ['scheduled', 'pending'] },
    },
    { $set: { status: 'cancelled' } }
  );
};

export const rescheduleAppointmentReminders = async (appointment) => {
  await cancelAppointmentReminders(appointment._id);
  await Appointment.findByIdAndUpdate(appointment._id, { reminderScheduled: false });
  return scheduleAppointmentReminder(appointment);
};

/**
 * Process due reminders.
 * When MSG91 WhatsApp is configured → real template send.
 * Otherwise → fail clearly (no fake "sent" / mock deep-link).
 */
export const processDueReminders = async ({ clinicId = null } = {}) => {
  const now = new Date();
  const dueFilter = {
    status: { $in: ['scheduled', 'pending'] },
    scheduledAt: { $lte: now },
  };
  if (clinicId) dueFilter.clinicId = clinicId;

  const due = await NotificationLog.find(dueFilter)
    .sort({ scheduledAt: 1, createdAt: 1 })
    .limit(50);

  // Confirmations before reminders when both are due in the same tick.
  due.sort((a, b) => {
    const rank = (type) => (type === 'appointment_confirmation' ? 0 : type === 'appointment_reminder' ? 1 : 2);
    const byType = rank(a.notificationType) - rank(b.notificationType);
    if (byType !== 0) return byType;
    return new Date(a.scheduledAt) - new Date(b.scheduledAt);
  });

  let processed = 0;
  const whatsappReady = getCommsConfigStatus().whatsapp.configured;

  for (const log of due) {
    try {
      // Hold reminder until confirmation for this appointment is sent (or none exists).
      if (log.notificationType === 'appointment_reminder' && log.appointmentId) {
        const pendingConfirm = await NotificationLog.findOne({
          appointmentId: log.appointmentId,
          notificationType: 'appointment_confirmation',
          status: { $in: ['scheduled', 'pending'] },
        }).select('_id');
        if (pendingConfirm) {
          continue;
        }
      }

      const appointment = await Appointment.findById(log.appointmentId)
        .populate('doctor', 'name phone')
        .populate('patientId', 'name phone')
        .populate('patient', 'name phone')
        .populate('clinicId', 'name');

      const status = appointment ? normalizeStatus(appointment.status) : null;
      if (!appointment || status === 'cancelled' || status === 'no_show' || status === 'completed') {
        log.status = 'cancelled';
        log.error =
          status === 'completed'
            ? 'Appointment already completed'
            : 'Appointment cancelled, missing, or no-show';
        await log.save();
        continue;
      }

      const patientLike = appointment.patientId || appointment.patient;
      const phone = log.recipientPhone || patientLike?.phone || '';
      const appointmentAt = combineDateAndSlot(appointment.appointmentDate, appointment.timeSlot);
      const dateLabel = appointmentAt.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
      const doctorName = appointment.doctor?.name || 'Doctor';
      const clinicName = appointment.clinicId?.name || 'the clinic';
      const patientName = log.recipientName || patientLike?.name || 'Patient';

      if (!whatsappReady) {
        log.status = 'failed';
        log.error =
          'WhatsApp provider not configured. Set MSG91_AUTH_KEY, MSG91_WHATSAPP_NUMBER, MSG91_WHATSAPP_TEMPLATE_NAME.';
        log.channel = 'whatsapp';
        log.provider = 'none';
        await log.save();
        await notifyDoctor({
          doctorId: appointment.doctor?._id || appointment.doctor,
          clinicId: appointment.clinicId?._id || appointment.clinicId,
          type: 'reminder_failed',
          ...inboxWhatsAppCopy({
            kind: log.notificationType,
            ok: false,
            patientName,
            dateLabel,
            timeSlot: appointment.timeSlot || '',
            reason: 'WhatsApp is not configured.',
          }),
          link: `/doctor/appointments/${appointment._id}`,
          metadata: {
            notificationLogId: log._id,
            appointmentId: appointment._id,
            patientName,
            dateLabel,
            timeSlot: appointment.timeSlot || '',
            kind: log.notificationType,
          },
        });
        continue;
      }

      if (!phone) {
        log.status = 'failed';
        log.error = 'Patient phone number missing.';
        log.channel = 'whatsapp';
        await log.save();
        await notifyDoctor({
          doctorId: appointment.doctor?._id || appointment.doctor,
          clinicId: appointment.clinicId?._id || appointment.clinicId,
          type: 'reminder_failed',
          ...inboxWhatsAppCopy({
            kind: log.notificationType,
            ok: false,
            patientName,
            dateLabel,
            timeSlot: appointment.timeSlot || '',
            reason: 'No phone number on file.',
          }),
          link: `/doctor/appointments/${appointment._id}`,
          metadata: {
            notificationLogId: log._id,
            appointmentId: appointment._id,
            patientName,
            dateLabel,
            timeSlot: appointment.timeSlot || '',
            kind: log.notificationType,
          },
        });
        continue;
      }

      const result = await sendViaChannel('whatsapp', {
        toPhone: phone,
        bodyText: log.message,
        templateKind:
          log.notificationType === 'appointment_reminder' ? 'reminder' : 'confirmation',
        context: {
          patientName,
          clinicName,
          doctorName,
          dateLabel,
          timeSlot: appointment.timeSlot || '',
          _message: log.message,
        },
      });

      log.status = 'sent';
      log.sentAt = new Date();
      log.channel = 'whatsapp';
      log.provider = result.provider || 'msg91';
      log.metadata = {
        ...(log.metadata || {}),
        processedAt: new Date(),
        providerMessageId: result.providerMessageId || null,
        providerRaw: result.raw || null,
      };
      // Optional staff deep-link fallback (not used as the send path)
      try {
        if (patientLike && appointment.doctor) {
          log.metadata.whatsappUrl =
            buildWhatsAppUrl(appointment, patientLike, appointment.doctor, 'doctor') || '';
        }
      } catch {
        /* ignore */
      }
      await log.save();

      if (appointment.patientId) {
        await recordPatientEvent({
          clinicId: appointment.clinicId?._id || appointment.clinicId,
          doctorId: appointment.doctor?._id || appointment.doctor,
          patientId: appointment.patientId._id || appointment.patientId,
          type: 'reminder_sent',
          title: 'WhatsApp reminder sent',
          detail: log.notificationType,
          appointmentId: appointment._id,
        });
      }

      await notifyDoctor({
        doctorId: appointment.doctor?._id || appointment.doctor,
        clinicId: appointment.clinicId?._id || appointment.clinicId,
        type: 'reminder_sent',
        ...inboxWhatsAppCopy({
          kind: log.notificationType,
          ok: true,
          patientName,
          dateLabel,
          timeSlot: appointment.timeSlot || '',
        }),
        link: `/doctor/appointments/${appointment._id}`,
        metadata: {
          notificationLogId: log._id,
          appointmentId: appointment._id,
          patientName,
          dateLabel,
          timeSlot: appointment.timeSlot || '',
          kind: log.notificationType,
        },
      });

      processed += 1;
    } catch (error) {
      log.status = 'failed';
      log.error = error.message;
      log.channel = 'whatsapp';
      await log.save();

      try {
        const appointment = await Appointment.findById(log.appointmentId).select('doctor clinicId');
        if (appointment) {
          await notifyDoctor({
            doctorId: appointment.doctor,
            clinicId: appointment.clinicId,
            type: 'reminder_failed',
            ...inboxWhatsAppCopy({
              kind: log.notificationType,
              ok: false,
              patientName: log.recipientName || 'Patient',
              dateLabel: '',
              timeSlot: '',
              reason: error.message,
            }),
            link: `/doctor/appointments/${appointment._id}`,
            metadata: {
              appointmentId: appointment._id,
              kind: log.notificationType,
              patientName: log.recipientName || 'Patient',
            },
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  return processed;
};
