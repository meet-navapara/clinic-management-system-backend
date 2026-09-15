/**
 * Resolve {{variable}} placeholders safely for one recipient context.
 * Unknown variables are left as empty string (never another patient's data).
 */
const ALLOWED = new Set([
  'patientName',
  'doctorName',
  'clinicName',
  'branchName',
  'appointmentDate',
  'appointmentTime',
  'followUpDate',
  'campaignName',
]);

export function extractTemplateVariables(text = '') {
  const found = new Set();
  String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    found.add(key);
    return '';
  });
  return [...found];
}

export function assertSupportedVariables(text = '') {
  const vars = extractTemplateVariables(text);
  const unsupported = vars.filter((v) => !ALLOWED.has(v));
  if (unsupported.length) {
    const err = new Error(`Unsupported template variables: ${unsupported.join(', ')}`);
    err.status = 422;
    throw err;
  }
  return vars;
}

export function renderTemplate(text = '', context = {}) {
  assertSupportedVariables(text);
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!ALLOWED.has(key)) return '';
    const value = context[key];
    return value == null ? '' : String(value);
  });
}

export function buildRecipientContext({
  patient,
  doctorName = '',
  clinicName = '',
  branchName = '',
  campaignName = '',
  appointmentDate = '',
  appointmentTime = '',
  followUpDate = '',
} = {}) {
  return {
    patientName: patient?.name || patient?.firstName || 'Patient',
    doctorName: doctorName || '',
    clinicName: clinicName || '',
    branchName: branchName || '',
    campaignName: campaignName || '',
    appointmentDate: appointmentDate || '',
    appointmentTime: appointmentTime || '',
    followUpDate: followUpDate || '',
  };
}
