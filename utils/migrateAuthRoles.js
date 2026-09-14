import User from '../models/User.js';

const STAFF_FROM_ROLE = {
  receptionist: 'receptionist',
  nurse: 'nurse',
  assistant: 'assistant',
  clinic_manager: 'other',
};

/**
 * Two-role auth: clinic_admin becomes doctor (clinic operator).
 * Receptionist/nurse/assistant/manager stay as staff records.
 * Login is off until a Doctor enables it (`loginEnabled`).
 * Never deletes users.
 */
export const migrateAuthRoles = async () => {
  const adminResult = await User.updateMany(
    { role: 'clinic_admin' },
    {
      $set: {
        role: 'doctor',
        approvalStatus: 'approved',
        staffStatus: 'active',
        isActive: true,
      },
    }
  );

  let staffPatched = 0;
  for (const [role, staffType] of Object.entries(STAFF_FROM_ROLE)) {
    const result = await User.updateMany(
      { role, $or: [{ staffType: { $exists: false } }, { staffType: '' }, { staffType: null }] },
      { $set: { staffType } }
    );
    staffPatched += result.modifiedCount || 0;
  }

  if (adminResult.modifiedCount || staffPatched) {
    console.log(
      `Auth role migration: ${adminResult.modifiedCount || 0} clinic admin(s) → doctor, ${staffPatched} staff type(s) set.`
    );
  }
};
