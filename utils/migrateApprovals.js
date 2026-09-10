import User from '../models/User.js';

/**
 * Existing doctors (created before approval flow) are marked approved
 * so they are not locked out of their dashboards.
 */
export const migrateDoctorApprovals = async () => {
  try {
    const result = await User.updateMany(
      {
        role: 'doctor',
        $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }],
      },
      { $set: { approvalStatus: 'approved' } }
    );

    if (result.modifiedCount > 0) {
      console.log(`Doctor approval migration: approved ${result.modifiedCount} existing doctor(s).`);
    }
  } catch (error) {
    console.warn('Doctor approval migration:', error.message);
  }
};
