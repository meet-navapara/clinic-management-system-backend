import Campaign from '../models/Campaign.js';
import CampaignDelivery from '../models/CampaignDelivery.js';
import NotificationLog from '../models/NotificationLog.js';
import { asyncHandler } from '../middleware/access.js';
import { tenantFilter, clinicQuery, assertSameClinic, assertBranchAccess, resolveWriteBranchId, canAccessBranch } from '../utils/branchScope.js';
import { isStaffAccount } from '../utils/permissions.js';
import { parsePagination, paginated } from '../utils/pagination.js';
import { resolveCampaignAudience } from '../utils/campaignAudience.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { buildWhatsAppUrl } from '../utils/whatsapp.js';

export const listCampaigns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.status) filter.status = req.query.status;
  const [rows, total] = await Promise.all([
    Campaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name'),
    Campaign.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), campaigns: rows });
});

export const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  const { page, limit, skip } = parsePagination(req.query);
  const [deliveries, total] = await Promise.all([
    CampaignDelivery.find({ campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('patientId', 'name phone'),
    CampaignDelivery.countDocuments({ campaignId: campaign._id }),
  ]);
  res.json({ success: true, campaign, deliveries, total, page, pages: Math.ceil(total / limit) || 1 });
});

export const createCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.create({
    clinicId: req.user.clinicId,
    branchId: isStaffAccount(req.user)
      ? await resolveWriteBranchId(req.user, req.branchId)
      : req.branchId || null,
    name: req.body.name,
    message: req.body.message,
    channel: req.body.channel || 'whatsapp',
    audienceType: req.body.audienceType || 'all',
    audienceFilter: req.body.audienceFilter || {},
    scheduledAt: req.body.scheduledAt || null,
    status: 'draft',
    createdBy: req.user._id,
  });
  res.status(201).json({ success: true, campaign });
});

export const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  if (!['draft', 'scheduled'].includes(campaign.status)) {
    return res.status(400).json({ success: false, message: 'Only draft/scheduled campaigns can be edited.' });
  }
  const fields = ['name', 'message', 'channel', 'audienceType', 'audienceFilter', 'scheduledAt'];
  for (const field of fields) {
    if (req.body[field] !== undefined) campaign[field] = req.body[field];
  }
  // Staff cannot retarget audience to another branch via audienceFilter.
  if (isStaffAccount(req.user) && campaign.audienceFilter?.branchId) {
    if (!canAccessBranch(req.user, campaign.audienceFilter.branchId)) {
      return res.status(403).json({ success: false, message: 'You do not have access to this branch.' });
    }
  }
  await campaign.save();
  res.json({ success: true, campaign });
});

export const previewCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  const patients = await resolveCampaignAudience(campaign.clinicId, campaign, req.user);
  campaign.recipientCount = patients.length;
  await campaign.save();
  res.json({
    success: true,
    recipientCount: patients.length,
    preview: patients.slice(0, 20).map((p) => ({ id: p._id, name: p.name, phone: p.phone })),
    channel: campaign.channel,
    message: campaign.message,
  });
});

export const sendCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  if (!req.body.confirm) {
    return res.status(400).json({ success: false, message: 'Confirm send is required.' });
  }
  if (['processing', 'completed'].includes(campaign.status)) {
    return res.status(400).json({ success: false, message: 'Campaign already sent or in progress.' });
  }

  const patients = await resolveCampaignAudience(campaign.clinicId, campaign, req.user);
  campaign.status = 'processing';
  campaign.confirmedAt = new Date();
  campaign.recipientCount = patients.length;
  await campaign.save();

  let sent = 0;
  let failed = 0;
  for (const patient of patients) {
    try {
      await CampaignDelivery.create({
        clinicId: campaign.clinicId,
        campaignId: campaign._id,
        patientId: patient._id,
        channel: campaign.channel,
        recipientPhone: patient.phone || '',
        recipientEmail: patient.email || '',
        recipientName: patient.name,
        status: 'queued',
      });
    } catch {
      continue;
    }
  }

  const queued = await CampaignDelivery.find({ campaignId: campaign._id, status: 'queued' });
  for (const delivery of queued) {
    try {
      const meta = {};
      if (campaign.channel === 'whatsapp' && delivery.recipientPhone) {
        const fakeAppt = { appointmentDate: new Date(), timeSlot: '', reason: campaign.message };
        try {
          meta.whatsappUrl = `https://wa.me/${String(delivery.recipientPhone).replace(/\D/g, '')}?text=${encodeURIComponent(campaign.message)}`;
        } catch {
          meta.whatsappUrl = '';
        }
        delivery.status = 'sent';
        delivery.provider = 'internal_whatsapp_link';
      } else if (campaign.channel === 'sms' || campaign.channel === 'email') {
        delivery.status = 'skipped';
        delivery.failureReason = 'No SMS/email provider configured. Message logged only.';
        delivery.provider = 'internal';
      } else {
        delivery.status = 'sent';
        delivery.provider = 'internal';
      }
      delivery.sentAt = new Date();
      delivery.metadata = meta;
      await delivery.save();

      await NotificationLog.create({
        clinicId: campaign.clinicId,
        campaignId: campaign._id,
        patientId: delivery.patientId,
        recipientPhone: delivery.recipientPhone,
        recipientName: delivery.recipientName,
        notificationType: 'campaign',
        channel: campaign.channel === 'whatsapp' ? 'whatsapp_link' : campaign.channel === 'email' ? 'email' : 'sms',
        message: campaign.message,
        scheduledAt: new Date(),
        sentAt: new Date(),
        status: delivery.status === 'sent' ? 'sent' : 'skipped',
        provider: delivery.provider,
        metadata: meta,
      });

      if (delivery.status === 'sent') sent += 1;
      else failed += 1;
    } catch (err) {
      delivery.status = 'failed';
      delivery.failureReason = err.message;
      await delivery.save();
      failed += 1;
    }
  }

  campaign.sentCount = sent;
  campaign.failedCount = failed;
  campaign.status = failed && !sent ? 'failed' : 'completed';
  await campaign.save();

  await writeAudit({
    clinicId: campaign.clinicId,
    branchId: campaign.branchId,
    actorId: req.user._id,
    action: AUDIT.CAMPAIGN_SENT,
    entityType: 'Campaign',
    entityId: campaign._id,
    detail: `${campaign.name} · ${sent} sent`,
  });

  res.json({ success: true, campaign, sent, failed, recipientCount: patients.length });
});

export const cancelCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  if (campaign.status === 'completed') {
    return res.status(400).json({ success: false, message: 'Completed campaigns cannot be cancelled.' });
  }
  campaign.status = 'cancelled';
  await campaign.save();
  await CampaignDelivery.updateMany({ campaignId: campaign._id, status: 'queued' }, { $set: { status: 'skipped', failureReason: 'Campaign cancelled' } });
  res.json({ success: true, campaign });
});

void clinicQuery;
void buildWhatsAppUrl;
