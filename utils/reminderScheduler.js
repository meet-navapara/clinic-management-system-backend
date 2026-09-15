import { processDueReminders } from './notificationService.js';
import { processDueCampaigns } from './comms/campaignSend.js';

const INTERVAL_MS = 60 * 1000;

/**
 * Lightweight in-process reminder + campaign runner (long-running Node API).
 */
export const startReminderScheduler = () => {
  const tick = async () => {
    try {
      const count = await processDueReminders();
      if (count > 0) {
        console.log(`Reminders processed: ${count}`);
      }
    } catch (error) {
      console.warn('Reminder scheduler:', error.message);
    }
    try {
      const campaigns = await processDueCampaigns();
      if (campaigns > 0) {
        console.log(`Campaign deliveries processed: ${campaigns}`);
      }
    } catch (error) {
      console.warn('Campaign scheduler:', error.message);
    }
  };

  setTimeout(tick, 5000);
  setInterval(tick, INTERVAL_MS);
  console.log('Appointment reminder + campaign scheduler started (every 60s).');
};
