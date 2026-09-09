/**
 * Shared user payload for auth responses (never includes password).
 */
export const toAuthUser = (user) => {
  if (!user) return null;

  const doc = typeof user.toObject === 'function' ? user.toObject() : user;

  return {
    id: doc._id,
    _id: doc._id,
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    role: doc.role,
    clinicId: doc.clinicId || null,
    specialization: doc.specialization || '',
    qualification: doc.qualification || '',
    experience: doc.experience ?? 0,
    consultationFee: doc.consultationFee ?? 500,
    bio: doc.bio || '',
    availableDays: doc.availableDays || [],
    availableSlots: doc.availableSlots || [],
    isActive: doc.isActive !== false,
    profilePhoto: doc.profilePhoto || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
