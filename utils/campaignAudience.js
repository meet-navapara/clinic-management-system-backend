import Patient from '../models/Patient.js';
import Appointment from '../models/Appointment.js';
import { canAccessBranch, primaryBranchId } from './branchScope.js';
import { isStaffAccount } from './permissions.js';

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

  return Patient.find(filter).select('name phone email doctorId branchId tags').limit(5000);
}
