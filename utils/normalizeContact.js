/**
 * Canonical mobile: exactly 10 digits (Indian mobile starting 6–9).
 * Accepts pasted forms with +91 / 0 prefix and returns digits only.
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
  return ten;
}

/** Digits for WhatsApp / MSG91: 919876543210 */
export function indianMobileDigits(input) {
  const ten = normalizeIndianMobile(input);
  if (!ten) return null;
  return `91${ten}`;
}

export function phoneMatchVariants(input) {
  const ten = normalizeIndianMobile(input);
  if (!ten) return [];
  return [
    ten,
    `+91 ${ten}`,
    `+91${ten}`,
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
