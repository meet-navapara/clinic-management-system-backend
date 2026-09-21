import Campaign from '../models/Campaign.js';
import CampaignDelivery from '../models/CampaignDelivery.js';
import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';
import User from '../models/User.js';
import { asyncHandler } from '../middleware/access.js';
import {
  tenantFilter,
  assertSameClinic,
  assertBranchAccess,
  resolveWriteBranchId,
  canAccessBranch,
} from '../utils/branchScope.js';
import { isStaffAccount } from '../utils/permissions.js';
import { parsePagination, paginated, escapeRegex } from '../utils/pagination.js';
import { resolveCampaignAudience, classifyAudience } from '../utils/campaignAudience.js';
import { writeAudit, AUDIT } from '../utils/audit.js';
import { getCommsConfigStatus, assertChannelConfigured } from '../utils/comms/providers.js';
import {
  queueCampaignDeliveries,
  processCampaignQueue,
  sendTestMessage,
  refreshCampaignCounts,
} from '../utils/comms/campaignSend.js';
import {
  renderTemplate,
  buildRecipientContext,
  assertSupportedVariables,
} from '../utils/comms/renderTemplate.js';

export const getIntegrationsStatus = asyncHandler(async (req, res) => {
  const clinic = await Clinic.findById(req.user.clinicId);
  res.json({ success: true, integrations: getCommsConfigStatus(clinic) });
});

export const getCampaignWhatsAppTemplate = asyncHandler(async (req, res) => {
  const clinic = await Clinic.findById(req.user.clinicId);
  if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found.' });
  res.json({
    success: true,
    template: clinic.whatsappCampaignTemplate || { status: 'none' },
    integrations: getCommsConfigStatus(clinic),
  });
});

export const submitCampaignWhatsAppTemplate = asyncHandler(async (req, res) => {
  if (req.user.role !== 'doctor') {
    return res.status(403).json({
      success: false,
      message: 'Only the clinic doctor can submit a WhatsApp campaign template.',
    });
  }
  const clinic = await Clinic.findById(req.user.clinicId);
  if (!clinic) return res.status(404).json({ success: false, message: 'Clinic not found.' });

  const requestedName = String(req.body.requestedName || '').trim().toLowerCase().replace(/\s+/g, '_');
  const sampleBody = String(req.body.sampleBody || '').trim();
  const requestedBodyVars = String(req.body.requestedBodyVars || 'patientName,clinicName,_message').trim();
  const language = String(req.body.language || 'en').trim() || 'en';
  const category = String(req.body.category || 'MARKETING').trim().toUpperCase() || 'MARKETING';

  if (!requestedName || requestedName.length < 3) {
    return res.status(422).json({
      success: false,
      message: 'Enter a template name (letters, numbers, underscores) as you will create it on MSG91.',
    });
  }
  if (!sampleBody || sampleBody.length < 10) {
    return res.status(422).json({
      success: false,
      message: 'Paste the template body Super Admin should create on MSG91 (include {{1}}, {{2}}, …).',
    });
  }
  if (clinic.whatsappCampaignTemplate?.status === 'pending') {
    return res.status(400).json({
      success: false,
      message: 'A template is already pending Super Admin approval.',
    });
  }

  clinic.whatsappCampaignTemplate = {
    status: 'pending',
    requestedName,
    sampleBody,
    requestedBodyVars,
    language,
    category,
    submittedAt: new Date(),
    submittedBy: req.user._id,
    approvedName: '',
    approvedBodyVars: '',
    reviewNote: '',
    reviewedAt: null,
    reviewedBy: null,
  };
  await clinic.save();

  res.json({
    success: true,
    template: clinic.whatsappCampaignTemplate,
    message: 'Submitted for Super Admin. They will create/approve it on MSG91, then approve it for your clinic.',
  });
});

export const listCampaigns = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = tenantFilter(req.user, req.branchId);
  if (req.query.status) filter.status = req.query.status;
  if (req.query.channel) filter.channel = req.query.channel;
  if (req.query.q?.trim()) {
    filter.name = new RegExp(escapeRegex(req.query.q.trim()), 'i');
  }
  const [rows, total] = await Promise.all([
    Campaign.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name'),
    Campaign.countDocuments(filter),
  ]);
  res.json({ success: true, ...paginated({ items: rows, total, page, limit }), campaigns: rows });
});

export const getCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id).populate('createdBy', 'name');
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  if (campaign.channel === 'sms') {
    campaign.channel = 'whatsapp';
    await campaign.save().catch(() => {});
  }
  const { page, limit, skip } = parsePagination(req.query);
  const statusFilter = req.query.deliveryStatus ? { status: req.query.deliveryStatus } : {};
  const [deliveries, total] = await Promise.all([
    CampaignDelivery.find({ campaignId: campaign._id, ...statusFilter })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('patientId', 'name phone email'),
    CampaignDelivery.countDocuments({ campaignId: campaign._id, ...statusFilter }),
  ]);

  const sent = campaign.sentCount || 0;
  const delivered = campaign.deliveredCount || 0;
  const failed = campaign.failedCount || 0;
  const base = sent + delivered + failed;
  const analytics = {
    recipients: campaign.recipientCount || 0,
    eligible: campaign.eligibleCount || 0,
    excluded: campaign.excludedCount || 0,
    queued: campaign.queuedCount || 0,
    sent,
    delivered,
    failed,
    skipped: campaign.skippedCount || 0,
    deliveryRate: base ? Number((((delivered || sent) / base) * 100).toFixed(2)) : null,
    failureRate: base ? Number(((failed / base) * 100).toFixed(2)) : null,
    read: 'Not available',
    click: 'Not available',
  };

  res.json({
    success: true,
    campaign,
    deliveries,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    analytics,
    integrations: getCommsConfigStatus(await Clinic.findById(campaign.clinicId)),
  });
});

export const createCampaign = asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!String(body.name || '').trim() || !String(body.message || '').trim()) {
    return res.status(422).json({ success: false, message: 'Name and message are required.' });
  }
  assertSupportedVariables(body.message);
  if (body.subject) assertSupportedVariables(body.subject);

  const branchId = isStaffAccount(req.user)
    ? await resolveWriteBranchId(req.user, req.branchId)
    : body.branchId || req.branchId || null;

  if (branchId && !canAccessBranch(req.user, branchId)) {
    return res.status(403).json({ success: false, message: 'You do not have access to this branch.' });
  }

  if (body.channel === 'sms') {
    return res.status(400).json({
      success: false,
      message: 'SMS campaigns are not supported. Use WhatsApp or Email.',
    });
  }
  const channel = body.channel === 'email' ? 'email' : 'whatsapp';

  const campaign = await Campaign.create({
    clinicId: req.user.clinicId,
    branchId,
    name: String(body.name).trim(),
    description: body.description || '',
    campaignType: body.campaignType || 'general',
    purpose: body.purpose || 'marketing',
    message: String(body.message).trim(),
    subject: body.subject || '',
    channel,
    audienceType: body.audienceType || 'all',
    audienceFilter: body.audienceFilter || {},
    scheduledAt: body.scheduledAt || null,
    timezone: body.timezone || 'Asia/Kolkata',
    status: body.scheduledAt ? 'draft' : 'draft',
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
  const fields = [
    'name',
    'description',
    'campaignType',
    'purpose',
    'message',
    'subject',
    'channel',
    'audienceType',
    'audienceFilter',
    'scheduledAt',
    'timezone',
  ];
  for (const field of fields) {
    if (req.body[field] !== undefined) campaign[field] = req.body[field];
  }
  // Legacy SMS campaigns: migrate to WhatsApp on save (new SMS creates still blocked).
  if (req.body.channel === 'sms' || campaign.channel === 'sms') {
    campaign.channel = 'whatsapp';
  }
  if (campaign.channel !== 'email' && campaign.channel !== 'whatsapp') {
    campaign.channel = 'whatsapp';
  }
  if (campaign.message) assertSupportedVariables(campaign.message);
  if (campaign.subject) assertSupportedVariables(campaign.subject);
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

  if (campaign.channel === 'sms') {
    campaign.channel = 'whatsapp';
    await campaign.save().catch(() => {});
  }

  const patients = await resolveCampaignAudience(campaign.clinicId, campaign, req.user);
  const classified = classifyAudience(patients, campaign.channel, campaign.purpose || 'marketing');

  campaign.recipientCount = classified.total;
  campaign.eligibleCount = classified.eligibleCount;
  campaign.excludedCount = classified.excludedCount;
  await campaign.save();

  const [clinic, branch, doctor] = await Promise.all([
    Clinic.findById(campaign.clinicId).select('name'),
    campaign.branchId ? Branch.findById(campaign.branchId).select('name') : null,
    campaign.createdBy ? User.findById(campaign.createdBy).select('name') : null,
  ]);

  const sample = classified.eligible[0];
  let messagePreview = campaign.message;
  try {
    messagePreview = renderTemplate(
      campaign.message,
      buildRecipientContext({
        patient: sample || { name: 'Anita Desai' },
        doctorName: doctor?.name || 'Doctor',
        clinicName: clinic?.name || 'Clinic',
        branchName: branch?.name || '',
        campaignName: campaign.name,
      })
    );
  } catch (err) {
    return res.status(422).json({ success: false, message: err.message });
  }

  const clinicDoc = await Clinic.findById(campaign.clinicId);
  const integrations = getCommsConfigStatus(clinicDoc);
  const channelKey = campaign.channel;
  const channelConfigured =
    channelKey === 'whatsapp'
      ? integrations.whatsapp?.campaign?.configured === true
      : integrations[channelKey]?.configured === true;

  res.json({
    success: true,
    recipientCount: classified.total,
    eligibleCount: classified.eligibleCount,
    excludedCount: classified.excludedCount,
    reasonCounts: classified.reasonCounts,
    preview: classified.eligible.slice(0, 20).map((p) => ({
      id: p._id,
      name: p.name,
      phone: p.phone,
      email: p.email,
    })),
    channel: campaign.channel,
    message: campaign.message,
    messagePreview,
    subject: campaign.subject,
    channelConfigured,
    integrationStatus:
      channelKey === 'whatsapp' ? integrations.whatsapp?.campaign : integrations[channelKey],
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
  if (['processing', 'completed', 'partially_completed'].includes(campaign.status)) {
    return res.status(400).json({ success: false, message: 'Campaign already sent or in progress.' });
  }

  const clinicForSend = await Clinic.findById(campaign.clinicId);
  try {
    assertChannelConfigured(campaign.channel, {
      clinic: clinicForSend,
      purpose: campaign.channel === 'whatsapp' ? 'campaign' : 'appointment',
    });
  } catch (err) {
    return res.status(err.status || 503).json({
      success: false,
      message: err.message,
      code: err.code || 'PROVIDER_NOT_CONFIGURED',
      integrations: getCommsConfigStatus(clinicForSend),
    });
  }

  const scheduleAt = req.body.sendNow
    ? new Date()
    : campaign.scheduledAt
      ? new Date(campaign.scheduledAt)
      : new Date();

  if (!req.body.sendNow && campaign.scheduledAt && new Date(campaign.scheduledAt) > new Date()) {
    await queueCampaignDeliveries(campaign, req.user);
    campaign.status = 'scheduled';
    campaign.confirmedAt = new Date();
    await campaign.save();
    return res.json({
      success: true,
      campaign,
      message: 'Campaign scheduled. Messages will send via the configured provider at the scheduled time.',
    });
  }

  campaign.scheduledAt = scheduleAt;
  campaign.confirmedAt = new Date();
  campaign.status = 'processing';
  await campaign.save();

  const classified = await queueCampaignDeliveries(campaign, req.user);

  // Process first batch immediately; remaining batches via scheduler tick
  await processCampaignQueue(campaign._id, { limit: 25 });
  await refreshCampaignCounts(campaign);
  const fresh = await Campaign.findById(campaign._id);

  await writeAudit({
    clinicId: campaign.clinicId,
    branchId: campaign.branchId,
    actorId: req.user._id,
    action: AUDIT.CAMPAIGN_SENT,
    entityType: 'Campaign',
    entityId: campaign._id,
    detail: `${campaign.name} · queued ${classified.eligibleCount}`,
  });

  res.json({
    success: true,
    campaign: fresh,
    eligibleCount: classified.eligibleCount,
    excludedCount: classified.excludedCount,
    message:
      fresh.status === 'processing'
        ? 'Campaign is processing. Remaining messages will continue in the background.'
        : 'Campaign processed.',
  });
});

export const testCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);

  const { toPhone, toEmail } = req.body || {};
  const clinic = await Clinic.findById(campaign.clinicId);
  try {
    assertChannelConfigured(campaign.channel, {
      clinic,
      purpose: campaign.channel === 'whatsapp' ? 'campaign' : 'appointment',
    });
  } catch (err) {
    return res.status(err.status || 503).json({
      success: false,
      message: err.message,
      code: err.code || 'PROVIDER_NOT_CONFIGURED',
    });
  }

  if (campaign.channel === 'email' && !toEmail) {
    return res.status(422).json({ success: false, message: 'Enter a test email address.' });
  }
  if (campaign.channel === 'whatsapp' && !toPhone) {
    return res.status(422).json({ success: false, message: 'Enter a test phone number.' });
  }
  if (campaign.channel === 'sms') {
    return res.status(400).json({
      success: false,
      message: 'SMS campaigns are not supported. Use WhatsApp or Email.',
    });
  }

  const result = await sendTestMessage({
    channel: campaign.channel,
    toPhone,
    toEmail,
    message: campaign.message,
    subject: campaign.subject || `Test: ${campaign.name}`,
    clinic,
    context: buildRecipientContext({
      patient: { name: 'Test Patient' },
      doctorName: req.user.name || 'Doctor',
      clinicName: clinic?.name || 'Clinic',
      campaignName: campaign.name,
    }),
  });

  res.json({
    success: true,
    message: 'Test message accepted by provider.',
    provider: result.provider,
    providerMessageId: result.providerMessageId,
  });
});

export const cancelCampaign = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  if (['completed', 'partially_completed'].includes(campaign.status)) {
    return res.status(400).json({ success: false, message: 'Completed campaigns cannot be cancelled.' });
  }
  campaign.status = 'cancelled';
  await campaign.save();
  await CampaignDelivery.updateMany(
    { campaignId: campaign._id, status: 'queued' },
    { $set: { status: 'skipped', failureReason: 'Campaign cancelled' } }
  );
  res.json({ success: true, campaign });
});

export const retryFailed = asyncHandler(async (req, res) => {
  const campaign = await Campaign.findById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, campaign.clinicId);
  assertBranchAccess(req.user, campaign.branchId);
  try {
    assertChannelConfigured(campaign.channel, {
      clinic: await Clinic.findById(campaign.clinicId),
      purpose: campaign.channel === 'whatsapp' ? 'campaign' : 'appointment',
    });
  } catch (err) {
    return res.status(err.status || 503).json({ success: false, message: err.message });
  }

  const result = await CampaignDelivery.updateMany(
    { campaignId: campaign._id, status: 'failed' },
    { $set: { status: 'queued', failureReason: '', failedAt: null } }
  );
  campaign.status = 'processing';
  await campaign.save();
  await processCampaignQueue(campaign._id, { limit: 25 });
  await refreshCampaignCounts(campaign);
  const fresh = await Campaign.findById(campaign._id);
  res.json({
    success: true,
    campaign: fresh,
    requeued: result.modifiedCount || 0,
  });
});

export const duplicateCampaign = asyncHandler(async (req, res) => {
  const source = await Campaign.findById(req.params.id);
  if (!source) return res.status(404).json({ success: false, message: 'Campaign not found.' });
  assertSameClinic(req.user, source.clinicId);
  assertBranchAccess(req.user, source.branchId);
  const campaign = await Campaign.create({
    clinicId: source.clinicId,
    branchId: source.branchId,
    name: `${source.name} (copy)`,
    description: source.description,
    campaignType: source.campaignType,
    purpose: source.purpose,
    message: source.message,
    subject: source.subject,
    channel: source.channel === 'email' ? 'email' : 'whatsapp',
    audienceType: source.audienceType,
    audienceFilter: source.audienceFilter,
    status: 'draft',
    createdBy: req.user._id,
  });
  res.status(201).json({ success: true, campaign });
});
