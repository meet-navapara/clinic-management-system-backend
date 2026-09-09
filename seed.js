import dns from 'dns';

import mongoose from 'mongoose';

import bcrypt from 'bcryptjs';

import dotenv from 'dotenv';



dotenv.config();

dns.setServers(['8.8.8.8', '1.1.1.1']);



const userSchema = new mongoose.Schema({

  name: String,

  email: String,

  password: String,

  phone: String,

  role: String,

  specialization: String,

  experience: Number,

  consultationFee: Number,

  bio: String,

  availableDays: [String],

  availableSlots: [String],

  isActive: Boolean,

});



const appointmentSchema = new mongoose.Schema({

  patient: mongoose.Schema.Types.ObjectId,

  doctor: mongoose.Schema.Types.ObjectId,

  appointmentDate: Date,

  timeSlot: String,

  reason: String,

  status: String,

});



const User = mongoose.model('User', userSchema);

const Appointment = mongoose.model('Appointment', appointmentSchema);



const seedDoctor = {

  name: 'Dr. Priya Sharma',

  email: 'priya.sharma@shreeshakti.com',

  password: 'doctor123',

  phone: '9876543210',

  role: 'doctor',

  specialization: 'Panchakarma Specialist',

  experience: 12,

  consultationFee: 800,

  bio: 'Expert in Panchakarma detox therapies and rejuvenation with 12+ years of Ayurvedic practice.',

  availableDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

  availableSlots: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'],

};



async function seed() {

  await mongoose.connect(process.env.MONGODB_URI);

  console.log('Connected to MongoDB');



  const existingDoctors = await User.find({

    role: 'doctor',

    email: { $regex: '@(medbook|shreeshakti)\\.com' },

  }).select('_id');



  if (existingDoctors.length > 0) {

    const doctorIds = existingDoctors.map((d) => d._id);

    await Appointment.deleteMany({ doctor: { $in: doctorIds } });

  }



  await User.deleteMany({

    role: 'doctor',

    email: { $regex: '@(medbook|shreeshakti)\\.com' },

  });



  const hashed = await bcrypt.hash(seedDoctor.password, 12);

  await User.create({ ...seedDoctor, password: hashed, isActive: true });



  console.log('Seeded 1 clinic doctor admin account.');

  console.log('Demo doctor login: priya.sharma@shreeshakti.com / doctor123');

  console.log('For fresh setup via UI, use /admin/register with ADMIN_SETUP_SECRET from .env');

  process.exit(0);

}



seed().catch((err) => {

  console.error(err);

  process.exit(1);

});


