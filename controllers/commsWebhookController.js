import CampaignDelivery from '../models/CampaignDelivery.js';
import Campaign from '../models/Campaign.js';
import { refreshCampaignCounts } from '../utils/comms/campaignSend.js';
import { asyncHandler } from '../middleware/access.js';

/**
 * MSG91 / generic delivery webhook — fail closed when secret is not configured.
 */
export const msg91Webhook = asyncHandler(async (req, res) => {
  const secret = process.env.COMMS_WEBHOOK_SECRET || process.env.MSG91_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'Webhook secret is not configured. Refusing requests.',
    });
  }
  const provided =
    req.headers['x-webhook-secret'] ||
    req.headers['x-msg91-secret'] ||
    req.query.secret ||
    '';
  if (provided !== secret) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret.' });
  }

  const body = req.body || {};
  const providerMessageId =
    body.requestId ||
    body.messageId ||
    body.message_uuid ||
    body.uuid ||
    body.data?.messageId ||
    body.data?.requestId ||
    null;
  const statusRaw = String(body.status || body.event || body.type || '').toLowerCase();

  if (!providerMessageId) {
    return res.status(200).json({ success: true, ignored: true });
  }

  const delivery = await CampaignDelivery.findOne({ providerMessageId: String(providerMessageId) });
  if (!delivery) {
    return res.status(200).json({ success: true, matched: false });
  }

  if (/deliver/.test(statusRaw)) {
    delivery.status = 'delivered';
    delivery.deliveredAt = new Date();
  } else if (/read|seen/.test(statusRaw)) {
    delivery.status = 'read';
    delivery.readAt = new Date();
  } else if (/fail|undeliver|reject|bounce/.test(statusRaw)) {
    delivery.status = 'failed';
    delivery.failedAt = new Date();
    delivery.failureReason = body.reason || body.error || 'Provider reported failure';
  } else if (/sent|submitted/.test(statusRaw)) {
    delivery.status = 'sent';
    delivery.sentAt = delivery.sentAt || new Date();
  }

  await delivery.save();
  const campaign = await Campaign.findById(delivery.campaignId);
  if (campaign) await refreshCampaignCounts(campaign);

  res.json({ success: true, matched: true, status: delivery.status });
});

/**
 * Resend email webhook — fail closed when secret is not configured.
 */
export const resendWebhook = asyncHandler(async (req, res) => {
  const secret = process.env.COMMS_WEBHOOK_SECRET || process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).json({
      success: false,
      message: 'Webhook secret is not configured. Refusing requests.',
    });
  }
  const provided = req.headers['x-webhook-secret'] || req.query.secret || '';
  if (provided !== secret) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret.' });
  }

  const event = req.body || {};
  const type = String(event.type || '').toLowerCase();
  const providerMessageId = event.data?.email_id || event.data?.id || null;
  if (!providerMessageId) return res.status(200).json({ success: true, ignored: true });

  const delivery = await CampaignDelivery.findOne({ providerMessageId: String(providerMessageId) });
  if (!delivery) return res.status(200).json({ success: true, matched: false });

  if (type.includes('delivered')) {
    delivery.status = 'delivered';
    delivery.deliveredAt = new Date();
  } else if (type.includes('bounced') || type.includes('failed') || type.includes('complained')) {
    delivery.status = 'failed';
    delivery.failedAt = new Date();
    delivery.failureReason = type;
  } else if (type.includes('sent')) {
    delivery.status = 'sent';
    delivery.sentAt = delivery.sentAt || new Date();
  }
  await delivery.save();
  const campaign = await Campaign.findById(delivery.campaignId);
  if (campaign) await refreshCampaignCounts(campaign);
  res.json({ success: true, matched: true, status: delivery.status });
});
