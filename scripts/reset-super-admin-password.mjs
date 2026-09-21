import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

dotenv.config();

const NEW_PASS = 'Admin@12345';

await mongoose.connect(process.env.MONGODB_URI);
const hash = await bcrypt.hash(NEW_PASS, 12);
const r = await mongoose.connection.db.collection('users').updateOne(
  { role: 'super_admin', email: 'admin@gmail.com' },
  { $set: { password: hash } }
);
console.log(
  JSON.stringify({
    matched: r.matchedCount,
    modified: r.modifiedCount,
    email: 'admin@gmail.com',
    password: NEW_PASS,
  })
);
await mongoose.disconnect();
