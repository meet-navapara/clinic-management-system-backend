import Clinic from '../models/Clinic.js';

/** Public list of active clinics (for staff/patient signup association). */
export const listClinics = async (req, res) => {
  try {
    const clinics = await Clinic.find({ isActive: true })
      .select('name slug address phone email logo')
      .sort({ name: 1 });

    res.json({ success: true, clinics });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getClinicById = async (req, res) => {
  try {
    const clinic = await Clinic.findOne({ _id: req.params.id, isActive: true }).select(
      'name slug address phone email logo appointmentDuration reminderSettings workingHours'
    );

    if (!clinic) {
      return res.status(404).json({ success: false, message: 'Clinic not found.' });
    }

    res.json({ success: true, clinic });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
