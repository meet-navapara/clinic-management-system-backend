/**
 * Core domain tests (no DB) for appointment transitions + patient helpers.
 * Run: node --test tests/*.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, normalizeStatus, assertTransition } from '../utils/appointmentTransitions.js';
import { splitName, deriveAge } from '../utils/patientHelpers.js';

describe('appointment transitions', () => {
  it('maps pending to scheduled', () => {
    assert.equal(normalizeStatus('pending'), 'scheduled');
  });

  it('allows scheduled → completed/cancelled/no_show/confirmed', () => {
    assert.equal(canTransition('scheduled', 'confirmed'), true);
    assert.equal(canTransition('scheduled', 'completed'), true);
    assert.equal(canTransition('scheduled', 'cancelled'), true);
    assert.equal(canTransition('scheduled', 'no_show'), true);
  });

  it('blocks terminal → active', () => {
    assert.equal(canTransition('cancelled', 'scheduled'), false);
    assert.equal(canTransition('completed', 'cancelled'), false);
    assert.equal(canTransition('no_show', 'confirmed'), false);
  });

  it('assertTransition throws on invalid', () => {
    assert.throws(() => assertTransition('completed', 'cancelled'), /Cannot change/);
  });
});

describe('patient helpers', () => {
  it('splits names', () => {
    assert.deepEqual(splitName('Priya Sharma'), { firstName: 'Priya', lastName: 'Sharma' });
    assert.deepEqual(splitName('Asha'), { firstName: 'Asha', lastName: '' });
  });

  it('derives age', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    assert.equal(deriveAge(dob), 30);
    assert.equal(deriveAge(null), null);
  });
});
