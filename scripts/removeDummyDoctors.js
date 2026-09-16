/**
 * Remove seeded dummy doctors and the dummy-seed clinic.
 * Usage: node scripts/removeDummyDoctors.js
 */
import dns from 'dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';

dotenv.config();
dns.setServers(['8.8.8.8', '1.1.1.1']);

const DUMMY_EMAIL_SUFFIX = '@dummy.clinic.local';
const DUMMY_SLUG = 'dummy-seed-clinic';

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const doctors = await User.deleteMany({
    role: 'doctor',
    email: { $regex: `${DUMMY_EMAIL_SUFFIX.replace('.', '\\.')}$` },
  });
  console.log(`Removed ${doctors.deletedCount} dummy doctors.`);

  const clinic = await Clinic.findOne({ slug: DUMMY_SLUG });
  if (clinic) {
    const branches = await Branch.deleteMany({ clinicId: clinic._id });
    console.log(`Removed ${branches.deletedCount} dummy branches.`);
    await Clinic.deleteOne({ _id: clinic._id });
    console.log(`Removed clinic "${clinic.name}".`);
  } else {
    console.log('No dummy-seed clinic found.');
  }

  await User.deleteMany({ email: { $regex: `${DUMMY_EMAIL_SUFFIX.replace('.', '\\.')}$` } });
  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
