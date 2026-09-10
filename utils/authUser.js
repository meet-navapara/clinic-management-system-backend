/**
 * Shared user payload for auth responses (never includes password).
 */
export const toAuthUser = (user) => {
  if (!user) return null;

  const doc = typeof user.toObject === 'function' ? user.toObject() : user;
  const settings = doc.practiceSettings || {};

  return {
    id: doc._id,
    _id: doc._id,
    name: doc.name,
    firstName: doc.firstName || '',
    lastName: doc.lastName || '',
    email: doc.email,
    phone: doc.phone,
    role: doc.role,
    clinicId: doc.clinicId || null,
    approvalStatus: doc.approvalStatus || (doc.role === 'doctor' ? 'pending' : 'approved'),
    specialization: doc.specialization || '',
    qualification: doc.qualification || '',
    experience: doc.experience ?? 0,
    licenseNumber: doc.licenseNumber || '',
    consultationFee: doc.consultationFee ?? 500,
    consultationTypes: doc.consultationTypes || [],
    bio: doc.bio || '',
    clinicName: doc.clinicName || '',
    clinicAddress: doc.clinicAddress || '',
    city: doc.city || '',
    state: doc.state || '',
    country: doc.country || '',
    postalCode: doc.postalCode || '',
    availableDays: doc.availableDays || [],
    availableSlots: doc.availableSlots || [],
    practiceSettings: {
      defaultDurationMinutes: settings.defaultDurationMinutes ?? 30,
      reminderHoursBefore: settings.reminderHoursBefore || [24, 2],
      sendConfirmationReminder: settings.sendConfirmationReminder !== false,
      appointmentTypes: settings.appointmentTypes || ['Consultation', 'Follow-up', 'Procedure'],
    },
    isActive: doc.isActive !== false,
    profilePhoto: doc.profilePhoto || '',
    lastActiveAt: doc.lastActiveAt || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
