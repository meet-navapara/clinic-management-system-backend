import dns from 'dns';
import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import { migrateClinicTenancy } from '../utils/migrateClinic.js';
import { migrateDoctorApprovals } from '../utils/migrateApprovals.js';

export const migrateAppointmentIndexes = async () => {
  try {
    const collection = Appointment.collection;
    const indexes = await collection.indexes();

    for (const index of indexes) {
      const keys = index.key;
      const isSlotIndex =
        keys?.doctor === 1 && keys?.appointmentDate === 1 && keys?.timeSlot === 1;

      if (isSlotIndex && !index.partialFilterExpression) {
        await collection.dropIndex(index.name);
        console.log('Dropped legacy appointment slot index (allows rebooking cancelled slots).');
      }
    }

    await Appointment.syncIndexes();
  } catch (error) {
    console.warn('Appointment index migration:', error.message);
  }
};

export const cleanupOrphanAppointments = async () => {
  try {
    const db = mongoose.connection.db;
    const appointments = await db.collection('appointments').find({}).toArray();
    let removed = 0;

    for (const appt of appointments) {
      const doctor = appt.doctor
        ? await db.collection('users').findOne({ _id: appt.doctor })
        : null;

      let hasPatient = false;
      if (appt.patientId) {
        hasPatient = Boolean(await db.collection('patients').findOne({ _id: appt.patientId }));
      } else if (appt.patient) {
        hasPatient = Boolean(await db.collection('users').findOne({ _id: appt.patient }));
      }

      if (!doctor || !hasPatient) {
        await db.collection('appointments').deleteOne({ _id: appt._id });
        removed += 1;
      }
    }

    if (removed > 0) {
      console.log(`Removed ${removed} orphaned appointment(s).`);
    }
  } catch (error) {
    console.warn('Orphan appointment cleanup:', error.message);
  }
};

const connectDB = async () => {
  dns.setServers(['8.8.8.8', '1.1.1.1']);

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
    await migrateClinicTenancy();
    await migrateDoctorApprovals();
    await migrateAppointmentIndexes();
    await cleanupOrphanAppointments();
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
