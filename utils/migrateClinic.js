import Clinic from '../models/Clinic.js';
import User from '../models/User.js';
import Appointment from '../models/Appointment.js';

export const DEFAULT_CLINIC_SLUG = 'shreeshakti-ayurveda';
export const DEFAULT_CLINIC_NAME = 'Shreeshakti Ayurveda';

/**
 * Ensures the default clinic exists and backfills clinicId on existing
 * users and appointments. Additive only — never deletes data.
 */
export const migrateClinicTenancy = async () => {
  try {
    let clinic = await Clinic.findOne({ slug: DEFAULT_CLINIC_SLUG });

    if (!clinic) {
      clinic = await Clinic.create({
        name: DEFAULT_CLINIC_NAME,
        slug: DEFAULT_CLINIC_SLUG,
        phone: process.env.WHATSAPP_CLINIC_NUMBER
          ? String(process.env.WHATSAPP_CLINIC_NUMBER).replace(/^91/, '')
          : '',
        whatsappNumber: process.env.WHATSAPP_CLINIC_NUMBER || '',
        address: '',
        email: '',
        isActive: true,
      });
      console.log(`Created default clinic: ${clinic.name} (${clinic._id})`);
    }

    const userResult = await User.updateMany(
      { $or: [{ clinicId: { $exists: false } }, { clinicId: null }] },
      { $set: { clinicId: clinic._id } }
    );

    const apptResult = await Appointment.updateMany(
      { $or: [{ clinicId: { $exists: false } }, { clinicId: null }] },
      { $set: { clinicId: clinic._id } }
    );

    if (userResult.modifiedCount > 0 || apptResult.modifiedCount > 0) {
      console.log(
        `Clinic migration: assigned clinicId to ${userResult.modifiedCount} user(s), ${apptResult.modifiedCount} appointment(s).`
      );
    }

    return clinic;
  } catch (error) {
    console.warn('Clinic tenancy migration:', error.message);
    return null;
  }
};
