import { processDueReminders } from './notificationService.js';

const INTERVAL_MS = 60 * 1000;

/**
 * Lightweight in-process reminder runner (compatible with a long-running Node API).
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
  };

  setTimeout(tick, 5000);
  setInterval(tick, INTERVAL_MS);
  console.log('Appointment reminder scheduler started (every 60s).');
};
