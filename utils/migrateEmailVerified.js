import User from '../models/User.js';
import mongoose from 'mongoose';

const FLAG = 'email_verified_backfill_v1';

/**
 * One-time: mark all existing non-patient users as emailVerified
 * so the new staff OTP login gate does not lock current accounts.
 * New staff created afterward stay unverified until OTP.
 */
export const migrateEmailVerified = async () => {
  const Meta =
    mongoose.models.AppMigration ||
    mongoose.model(
      'AppMigration',
      new mongoose.Schema(
        {
          key: { type: String, unique: true, required: true },
          appliedAt: { type: Date, default: Date.now },
        },
        { collection: 'app_migrations' }
      )
    );

  const already = await Meta.findOne({ key: FLAG }).lean();
  if (already) return;

  const result = await User.updateMany(
    { emailVerified: { $ne: true }, role: { $ne: 'patient' } },
    { $set: { emailVerified: true } }
  );

  await Meta.create({ key: FLAG, appliedAt: new Date() });
  console.log(
    `Email verified migration: marked ${result.modifiedCount || 0} existing user(s) as verified.`
  );
};
