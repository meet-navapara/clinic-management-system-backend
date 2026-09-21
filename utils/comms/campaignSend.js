import Campaign from '../../models/Campaign.js';
import CampaignDelivery from '../../models/CampaignDelivery.js';
import NotificationLog from '../../models/NotificationLog.js';
import Clinic from '../../models/Clinic.js';
import Branch from '../../models/Branch.js';
import User from '../../models/User.js';
import { resolveCampaignAudience, classifyAudience } from '../campaignAudience.js';
import { sendViaChannel, assertChannelConfigured } from './providers.js';
import { renderTemplate, buildRecipientContext, assertSupportedVariables } from './renderTemplate.js';
import { indianMobileDigits, normalizeEmail } from '../normalizeContact.js';

const BATCH_SIZE = 25;

export async function queueCampaignDeliveries(campaign, user) {
  assertSupportedVariables(campaign.message);
  if (campaign.channel === 'email' && campaign.subject) {
    assertSupportedVariables(campaign.subject);
  }
  const clinic = await Clinic.findById(campaign.clinicId);
  assertChannelConfigured(campaign.channel, {
    clinic,
    purpose: campaign.channel === 'whatsapp' ? 'campaign' : 'appointment',
  });

  const patients = await resolveCampaignAudience(campaign.clinicId, campaign, user);
  const classified = classifyAudience(patients, campaign.channel, campaign.purpose || 'marketing');

  for (const patient of classified.eligible) {
    try {
      await CampaignDelivery.updateOne(
        { campaignId: campaign._id, patientId: patient._id },
        {
          $setOnInsert: {
            clinicId: campaign.clinicId,
            campaignId: campaign._id,
            patientId: patient._id,
            channel: campaign.channel,
            recipientPhone: patient.phone || '',
            recipientEmail: patient.email || '',
            recipientName: patient.name || '',
            status: 'queued',
            queuedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch {
      /* unique race — ignore */
    }
  }

  for (const row of classified.excluded) {
    try {
      await CampaignDelivery.updateOne(
        { campaignId: campaign._id, patientId: row.patient._id },
        {
          $setOnInsert: {
            clinicId: campaign.clinicId,
            campaignId: campaign._id,
            patientId: row.patient._id,
            channel: campaign.channel,
            recipientPhone: row.patient.phone || '',
            recipientEmail: row.patient.email || '',
            recipientName: row.patient.name || '',
            status: row.reason === 'opted_out' ? 'opted_out' : 'skipped',
            failureReason: row.reasonLabel,
            queuedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch {
      /* ignore */
    }
  }

  campaign.recipientCount = classified.eligible.length + classified.excluded.length;
  campaign.eligibleCount = classified.eligible.length;
  campaign.excludedCount = classified.excluded.length;
  await campaign.save();

  return classified;
}

async function loadSendContext(campaign) {
  const [clinic, branch, doctor] = await Promise.all([
    Clinic.findById(campaign.clinicId).select('name whatsappCampaignTemplate'),
    campaign.branchId ? Branch.findById(campaign.branchId).select('name') : null,
    campaign.createdBy ? User.findById(campaign.createdBy).select('name') : null,
  ]);
  const tpl = clinic?.whatsappCampaignTemplate;
  return {
    clinic,
    clinicName: clinic?.name || '',
    branchName: branch?.name || '',
    doctorName: doctor?.name || '',
    campaignTemplateName: tpl?.status === 'approved' ? String(tpl.approvedName || '').trim() : '',
    campaignBodyVars:
      tpl?.status === 'approved'
        ? String(tpl.approvedBodyVars || tpl.requestedBodyVars || 'patientName,clinicName,_message').trim()
        : '',
    campaignLanguage:
      tpl?.status === 'approved' ? String(tpl.language || 'en').trim() || 'en' : '',
  };
}

export async function processOneDelivery(delivery, campaign, ctx) {
  if (!['queued', 'failed'].includes(delivery.status)) return delivery;

  const patientStub = {
    name: delivery.recipientName,
    phone: delivery.recipientPhone,
    email: delivery.recipientEmail,
  };
  const context = buildRecipientContext({
    patient: patientStub,
    doctorName: ctx.doctorName,
    clinicName: ctx.clinicName,
    branchName: ctx.branchName,
    campaignName: campaign.name,
  });
  const bodyText = renderTemplate(campaign.message, context);
  const subject = campaign.subject
    ? renderTemplate(campaign.subject, context)
    : `${ctx.clinicName || 'Clinic'}: ${campaign.name}`;

  try {
    let result;
    if (campaign.channel === 'whatsapp') {
      if (!indianMobileDigits(delivery.recipientPhone)) throw Object.assign(new Error('Invalid phone'), { status: 422 });
      result = await sendViaChannel('whatsapp', {
        toPhone: delivery.recipientPhone,
        bodyText,
        context,
        templateKind: 'campaign',
        campaignTemplateName: ctx.campaignTemplateName,
        campaignBodyVars: ctx.campaignBodyVars,
        campaignLanguage: ctx.campaignLanguage,
      });
    } else if (campaign.channel === 'email') {
      if (!normalizeEmail(delivery.recipientEmail)) throw Object.assign(new Error('Invalid email'), { status: 422 });
      result = await sendViaChannel('email', {
        toEmail: delivery.recipientEmail,
        subject,
        text: bodyText,
      });
    } else {
      throw Object.assign(new Error('SMS campaigns are not supported. Use WhatsApp or Email.'), { status: 400 });
    }

    delivery.status = 'sent';
    delivery.provider = result.provider;
    delivery.providerMessageId = result.providerMessageId || '';
    delivery.sentAt = new Date();
    delivery.failureReason = '';
    delivery.renderedMessage = bodyText;
    delivery.metadata = { ...(delivery.metadata || {}), providerRawId: result.providerMessageId };
    await delivery.save();

    await NotificationLog.create({
      clinicId: campaign.clinicId,
      campaignId: campaign._id,
      patientId: delivery.patientId,
      recipientPhone: delivery.recipientPhone,
      recipientName: delivery.recipientName,
      notificationType: 'campaign',
      channel: campaign.channel === 'whatsapp' ? 'whatsapp' : campaign.channel,
      message: bodyText,
      scheduledAt: new Date(),
      sentAt: new Date(),
      status: 'sent',
      provider: result.provider,
      metadata: { providerMessageId: result.providerMessageId },
    });
  } catch (err) {
    delivery.status = 'failed';
    delivery.failedAt = new Date();
    delivery.failureReason = err.message || 'Provider error';
    await delivery.save();
  }
  return delivery;
}

export async function processCampaignQueue(campaignId, { limit = BATCH_SIZE } = {}) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) return { processed: 0 };
  if (!['processing', 'queued'].includes(campaign.status)) return { processed: 0 };

  const ctx = await loadSendContext(campaign);
  const queued = await CampaignDelivery.find({ campaignId: campaign._id, status: 'queued' })
    .sort({ createdAt: 1 })
    .limit(limit);

  for (const delivery of queued) {
    await processOneDelivery(delivery, campaign, ctx);
  }

  await refreshCampaignCounts(campaign);
  return { processed: queued.length };
}

export async function refreshCampaignCounts(campaign) {
  const id = campaign._id;
  const [sent, failed, queued, delivered, skipped, optedOut] = await Promise.all([
    CampaignDelivery.countDocuments({ campaignId: id, status: 'sent' }),
    CampaignDelivery.countDocuments({ campaignId: id, status: 'failed' }),
    CampaignDelivery.countDocuments({ campaignId: id, status: 'queued' }),
    CampaignDelivery.countDocuments({ campaignId: id, status: 'delivered' }),
    CampaignDelivery.countDocuments({ campaignId: id, status: 'skipped' }),
    CampaignDelivery.countDocuments({ campaignId: id, status: 'opted_out' }),
  ]);

  campaign.sentCount = sent;
  campaign.failedCount = failed;
  campaign.deliveredCount = delivered;
  campaign.queuedCount = queued;
  campaign.skippedCount = skipped + optedOut;

  if (queued > 0) {
    campaign.status = 'processing';
  } else if (failed && !sent && !delivered) {
    campaign.status = 'failed';
  } else if (failed && (sent || delivered)) {
    campaign.status = 'partially_completed';
  } else if (sent || delivered || skipped || optedOut) {
    campaign.status = 'completed';
  }

  await campaign.save();
  return campaign;
}

export async function processDueCampaigns() {
  const now = new Date();
  const due = await Campaign.find({
    status: { $in: ['scheduled', 'queued', 'processing'] },
    $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }],
  })
    .sort({ scheduledAt: 1 })
    .limit(5);

  let total = 0;
  for (const campaign of due) {
    if (campaign.channel === 'sms') {
      campaign.status = 'cancelled';
      await campaign.save().catch(() => {});
      await CampaignDelivery.updateMany(
        { campaignId: campaign._id, status: 'queued' },
        { $set: { status: 'skipped', failureReason: 'SMS campaigns are no longer supported' } }
      ).catch(() => {});
      continue;
    }
    if (campaign.status === 'scheduled') {
      campaign.status = 'processing';
      await campaign.save();
    }
    const { processed } = await processCampaignQueue(campaign._id, { limit: BATCH_SIZE });
    total += processed;
  }
  return total;
}

export async function sendTestMessage({
  channel,
  toPhone,
  toEmail,
  message,
  subject,
  context,
  clinic = null,
}) {
  assertChannelConfigured(channel, {
    clinic,
    purpose: channel === 'whatsapp' ? 'campaign' : 'appointment',
  });
  assertSupportedVariables(message || '');
  const bodyText = renderTemplate(message || 'Test message from clinic', context || {});
  if (channel === 'whatsapp') {
    const tpl = clinic?.whatsappCampaignTemplate;
    if (tpl?.status !== 'approved' || !String(tpl.approvedName || '').trim()) {
      const err = new Error(
        'Clinic campaign WhatsApp template is not approved yet. Ask Super Admin after MSG91 approval.'
      );
      err.status = 503;
      throw err;
    }
    return sendViaChannel('whatsapp', {
      toPhone,
      bodyText,
      context: context || {},
      templateKind: 'campaign',
      campaignTemplateName: tpl.approvedName,
      campaignBodyVars: tpl.approvedBodyVars || tpl.requestedBodyVars || '',
      campaignLanguage: tpl.language || 'en',
    });
  }
  if (channel === 'email') {
    return sendViaChannel('email', {
      toEmail,
      subject: subject || 'Clinic test message',
      text: bodyText,
    });
  }
  const err = new Error('SMS campaigns are not supported. Use WhatsApp or Email.');
  err.status = 400;
  throw err;
}
