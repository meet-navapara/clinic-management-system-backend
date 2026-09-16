import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOtpCode,
  hashOtp,
  compareOtp,
  cooldownRemainingMs,
  isOtpExpired,
  isVerificationValid,
  normalizeOtpInput,
  OTP_LENGTH,
  RESEND_COOLDOWN_MS,
  MAX_OTP_ATTEMPTS,
} from '../utils/emailOtp.js';

describe('email OTP helpers', () => {
  it('generates a 6-digit numeric OTP', () => {
    for (let i = 0; i < 20; i += 1) {
      const otp = generateOtpCode();
      assert.equal(otp.length, OTP_LENGTH);
      assert.match(otp, /^\d{6}$/);
    }
  });

  it('hashes and compares OTP without storing plaintext equality', async () => {
    const otp = '123456';
    const hashed = await hashOtp(otp);
    assert.notEqual(hashed, otp);
    assert.equal(await compareOtp(otp, hashed), true);
    assert.equal(await compareOtp('000000', hashed), false);
  });

  it('enforces resend cooldown', () => {
    const now = Date.now();
    assert.equal(cooldownRemainingMs(null, now), 0);
    assert.equal(cooldownRemainingMs(new Date(now), now), RESEND_COOLDOWN_MS);
    assert.equal(cooldownRemainingMs(new Date(now - RESEND_COOLDOWN_MS), now), 0);
    assert.ok(cooldownRemainingMs(new Date(now - 10_000), now) > 0);
  });

  it('detects OTP expiry', () => {
    const now = Date.now();
    assert.equal(isOtpExpired(null, now), true);
    assert.equal(isOtpExpired(new Date(now + 60_000), now), false);
    assert.equal(isOtpExpired(new Date(now - 1), now), true);
  });

  it('validates signup verification window', () => {
    const now = Date.now();
    assert.equal(isVerificationValid(null, now), false);
    assert.equal(
      isVerificationValid(
        {
          verifiedAt: new Date(now),
          verifiedUntil: new Date(now + 60_000),
          consumedAt: null,
        },
        now
      ),
      true
    );
    assert.equal(
      isVerificationValid(
        {
          verifiedAt: new Date(now),
          verifiedUntil: new Date(now + 60_000),
          consumedAt: new Date(now),
        },
        now
      ),
      false
    );
    assert.equal(
      isVerificationValid(
        {
          verifiedAt: new Date(now - 120_000),
          verifiedUntil: new Date(now - 60_000),
          consumedAt: null,
        },
        now
      ),
      false
    );
  });

  it('normalizes OTP input to digits only', () => {
    assert.equal(normalizeOtpInput('12-34 56'), '123456');
    assert.equal(normalizeOtpInput('abcdef'), '');
    assert.equal(normalizeOtpInput('123456789'), '123456');
  });

  it('exposes attempt limit constant', () => {
    assert.equal(MAX_OTP_ATTEMPTS, 5);
  });
});
