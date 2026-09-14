import Clinic from '../models/Clinic.js';
import Branch from '../models/Branch.js';
import PrintSettings from '../models/PrintSettings.js';
import { seedClinicTemplates } from './migrateV2.js';

export const slugifyClinic = (name) => {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || 'clinic';
};

export const uniqueClinicSlug = async (name) => {
  const base = slugifyClinic(name);
  let slug = base;
  let n = 0;
  while (await Clinic.exists({ slug })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
};

/**
 * Create an isolated clinic + default main branch for a new doctor practice.
 * Never reuses another doctor's clinic.
 */
export const provisionClinicForDoctor = async ({
  clinicName,
  clinicAddress = '',
  phone = '',
  email = '',
  city = '',
}) => {
  const name = String(clinicName || '').trim();
  if (!name) {
    const err = new Error('Clinic / practice name is required.');
    err.status = 400;
    throw err;
  }

  const slug = await uniqueClinicSlug(name);
  const addressParts = [clinicAddress, city].map((p) => String(p || '').trim()).filter(Boolean);

  const clinic = await Clinic.create({
    name,
    slug,
    address: addressParts.join(', '),
    phone: phone || '',
    email: email || '',
    isActive: true,
  });

  const branch = await Branch.create({
    clinicId: clinic._id,
    name: `${name} — Main`,
    code: 'MAIN',
    address: clinic.address || '',
    phone: clinic.phone || '',
    email: clinic.email || '',
    isDefault: true,
    isActive: true,
    displayTitle: name,
  });

  await PrintSettings.create({
    clinicId: clinic._id,
    clinicName: clinic.name,
    address: clinic.address || '',
    phone: clinic.phone || '',
    email: clinic.email || '',
  });

  try {
    await seedClinicTemplates(clinic._id);
  } catch {
    /* templates are optional at signup */
  }

  return { clinic, branch };
};
