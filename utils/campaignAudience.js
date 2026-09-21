import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import { canAccessBranch, primaryBranchId } from './branchScope.js';
import { isStaffAccount } from './permissions.js';
import { indianMobileDigits, normalizeEmail } from './normalizeContact.js';

/**
 * Resolve campaign audience within a single clinic. Never crosses clinics.
 * When user is staff, force audience to their primary branch.
 */
export async function resolveCampaignAudience(clinicId, campaign, user = null) {
  const filter = { clinicId, isActive: true };
  const af = campaign.audienceFilter || {};

  let branchScope = campaign.branchId || null;
  if (user && isStaffAccount(user)) {
    branchScope = primaryBranchId(user) || campaign.branchId;
  } else if (campaign.audienceType === 'branch' && (af.branchId || campaign.branchId)) {
    const requested = af.branchId || campaign.branchId;
    if (user && !canAccessBranch(user, requested)) {
      const err = new Error('You do not have access to this branch.');
      err.status = 403;
      throw err;
    }
    branchScope = requested;
  }

  if (branchScope) {
    filter.branchId = branchScope;
  }

  if (campaign.audienceType === 'selected' && af.patientIds?.length) {
    filter._id = { $in: af.patientIds };
  }
  if (campaign.audienceType === 'doctor' && af.doctorId) {
    filter.doctorId = af.doctorId;
  }
  if (campaign.audienceType === 'tags' && af.tags?.length) {
    filter.tags = { $in: af.tags };
  }
  if (campaign.audienceType === 'new') {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    filter.createdAt = { $gte: since };
  }
  if (campaign.audienceType === 'inactive') {
    const days = af.inactiveDays || 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const recent = await Appointment.distinct('patientId', {
      clinicId,
      ...(branchScope ? { branchId: branchScope } : {}),
      appointmentDate: { $gte: cutoff },
    });
    filter._id = { $nin: recent.filter(Boolean) };
  }
  if (campaign.audienceType === 'followup') {
    const upcoming = await Appointment.distinct('patientId', {
      clinicId,
      ...(branchScope ? { branchId: branchScope } : {}),
      appointmentType: { $regex: /follow/i },
      appointmentDate: { $gte: new Date() },
    });
    filter._id = { $in: upcoming.filter(Boolean) };
  }
  if (campaign.audienceType === 'upcoming') {
    const hours = af.upcomingHours || 48;
    const until = new Date(Date.now() + hours * 60 * 60 * 1000);
    const upcoming = await Appointment.distinct('patientId', {
      clinicId,
      ...(branchScope ? { branchId: branchScope } : {}),
      appointmentDate: { $gte: new Date(), $lte: until },
      status: { $in: ['pending', 'scheduled', 'confirmed'] },
    });
    filter._id = { $in: upcoming.filter(Boolean) };
  }
  if (campaign.audienceType === 'missed') {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const missed = await Appointment.distinct('patientId', {
      clinicId,
      ...(branchScope ? { branchId: branchScope } : {}),
      status: 'no_show',
      appointmentDate: { $gte: since },
    });
    filter._id = { $in: missed.filter(Boolean) };
  }
  if (campaign.audienceType === 'birthday') {
    const now = new Date();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    // Approximate birthday match using aggregation-friendly filter in memory after fetch
    const patients = await Patient.find({
      ...filter,
      dateOfBirth: { $ne: null },
    })
      .select(
        'name phone email secondaryPhone doctorId branchId tags sendSms communicationPrefs dateOfBirth gender age'
      )
      .limit(5000);
    return patients.filter((p) => {
      const d = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
      return d && d.getMonth() + 1 === month && d.getDate() === day;
    });
  }

  if (af.gender) filter.gender = af.gender;
  if (af.hasEmail) filter.email = { $nin: [null, ''] };
  if (af.hasPhone) filter.phone = { $nin: [null, ''] };

  return Patient.find(filter)
    .select(
      'name phone email secondaryPhone doctorId branchId tags sendSms communicationPrefs dateOfBirth gender age'
    )
    .limit(5000);
}

function isMarketingOptedIn(patient, channel, purpose) {
  if (purpose === 'transactional') return true;
  const prefs = patient.communicationPrefs || {};
  if (prefs.marketingOptOut === true) return false;
  if (channel === 'whatsapp') return prefs.marketingWhatsapp !== false;
  if (channel === 'email') return prefs.marketingEmail !== false;
  return false;
}

/**
 * Split audience into eligible vs excluded with reasons for a channel.
 */
export function classifyAudience(patients, channel, purpose = 'marketing') {
  const eligible = [];
  const excluded = [];
  const reasonCounts = {};

  const bump = (key, label, patient) => {
    reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    excluded.push({ patient, reason: key, reasonLabel: label });
  };

  const seenPhones = new Set();
  const seenEmails = new Set();

  for (const patient of patients) {
    if (!isMarketingOptedIn(patient, channel, purpose)) {
      bump('opted_out', 'Opted out of marketing', patient);
      continue;
    }

    if (channel === 'email') {
      const email = normalizeEmail(patient.email);
      if (!email) {
        bump('missing_email', 'Missing email', patient);
        continue;
      }
      if (seenEmails.has(email)) {
        bump('duplicate_contact', 'Duplicate email', patient);
        continue;
      }
      seenEmails.add(email);
      eligible.push(patient);
      continue;
    }

    const phone = indianMobileDigits(patient.phone || patient.secondaryPhone);
    if (!phone) {
      bump('missing_phone', 'Missing / invalid phone', patient);
      continue;
    }
    if (seenPhones.has(phone)) {
      bump('duplicate_contact', 'Duplicate phone', patient);
      continue;
    }
    seenPhones.add(phone);
    eligible.push(patient);
  }

  return {
    total: patients.length,
    eligible,
    excluded,
    eligibleCount: eligible.length,
    excludedCount: excluded.length,
    reasonCounts,
  };
}
