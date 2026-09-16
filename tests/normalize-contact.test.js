import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIndianMobile,
  phoneMatchVariants,
  indianMobileDigits,
  normalizeEmail,
} from '../utils/normalizeContact.js';

describe('normalizeIndianMobile', () => {
  it('normalizes to exactly 10 digits', () => {
    assert.equal(normalizeIndianMobile('9876543210'), '9876543210');
    assert.equal(normalizeIndianMobile('+91 9876543210'), '9876543210');
    assert.equal(normalizeIndianMobile('+919876543210'), '9876543210');
    assert.equal(normalizeIndianMobile('919876543210'), '9876543210');
    assert.equal(normalizeIndianMobile('09876543210'), '9876543210');
  });

  it('rejects invalid numbers', () => {
    assert.equal(normalizeIndianMobile('12345'), null);
    assert.equal(normalizeIndianMobile('abcdefghij'), null);
    assert.equal(normalizeIndianMobile('5876543210'), null);
  });

  it('builds phone match variants including legacy +91 forms', () => {
    const variants = phoneMatchVariants('9876543210');
    assert.ok(variants.includes('9876543210'));
    assert.ok(variants.includes('+91 9876543210'));
  });

  it('builds WhatsApp digits with country code', () => {
    assert.equal(indianMobileDigits('9876543210'), '919876543210');
  });

  it('normalizes email', () => {
    assert.equal(normalizeEmail('  A@B.Com '), 'a@b.com');
  });
});
