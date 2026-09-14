/**
 * Legacy helper. Clinic Admin is no longer an authentication role.
 * Super Admin is created once at /admin/register with ADMIN_SETUP_SECRET.
 * Doctors are clinic administrators.
 */
console.log(
  'This script is retired. Create Super Admin at /admin/register. Doctors manage their own clinics.'
);
process.exit(0);
