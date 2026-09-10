import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

dotenv.config();

await mongoose.connect(process.env.MONGODB_URI);
const hash = await bcrypt.hash('admin123', 12);

await mongoose.connection.db.collection('users').updateOne(
  { role: 'clinic_admin' },
  {
    $set: {
      email: 'admin@shreeshakti.com',
      name: 'Clinic Admin',
      password: hash,
      isActive: true,
    },
  }
);

const check = await mongoose.connection.db
  .collection('users')
  .findOne({ role: 'clinic_admin' }, { projection: { email: 1, name: 1, role: 1 } });

console.log('Clinic admin ready:', JSON.stringify(check));
await mongoose.disconnect();
