/**
 * Canonical Indian mobile: "+91 9876543210"
 * Accepts: 9876543210 | +919876543210 | +91 9876543210 | 919876543210 | 09876543210
 */
export function normalizeIndianMobile(input) {
  if (input == null || String(input).trim() === '') return null;
  const digits = String(input).replace(/\D/g, '');
  if (!digits) return null;

  let ten = digits;
  if (digits.length === 12 && digits.startsWith('91')) ten = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) ten = digits.slice(1);
  else if (digits.length === 10) ten = digits;
  else return null;

  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return `+91 ${ten}`;
}

/** Digits-only form for WhatsApp / loose matching: 919876543210 */
export function indianMobileDigits(input) {
  const normalized = normalizeIndianMobile(input);
  if (!normalized) return null;
  return normalized.replace(/\D/g, '');
}

export function phoneMatchVariants(input) {
  const normalized = normalizeIndianMobile(input);
  if (!normalized) return [];
  const ten = normalized.replace(/\D/g, '').slice(-10);
  return [
    normalized,
    ten,
    `+91${ten}`,
    `+91 ${ten}`,
    `91${ten}`,
    `0${ten}`,
  ];
}

export function normalizeEmail(input) {
  if (input == null || String(input).trim() === '') return '';
  return String(input).trim().toLowerCase();
}

export function isValidEmail(input) {
  if (!input) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input).trim());
}
