import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderTemplate,
  assertSupportedVariables,
  extractTemplateVariables,
} from '../utils/comms/renderTemplate.js';
import { classifyAudience } from '../utils/campaignAudience.js';
import { getCommsConfigStatus } from '../utils/comms/providers.js';

describe('campaign templates', () => {
  it('extracts and renders allowed variables', () => {
    const text = 'Hello {{patientName}} from {{clinicName}}';
    assert.deepEqual(extractTemplateVariables(text).sort(), ['clinicName', 'patientName']);
    const out = renderTemplate(text, { patientName: 'Anita', clinicName: 'Shreeshakti' });
    assert.equal(out, 'Hello Anita from Shreeshakti');
  });

  it('rejects unsupported variables', () => {
    assert.throws(() => assertSupportedVariables('Hi {{ssn}}'), /Unsupported/);
  });
});

describe('campaign audience classification', () => {
  it('excludes missing phone and opted-out patients for WhatsApp marketing', () => {
    const patients = [
      { name: 'A', phone: '9876543210', communicationPrefs: {} },
      { name: 'B', phone: '', communicationPrefs: {} },
      {
        name: 'C',
        phone: '9876543211',
        communicationPrefs: { marketingOptOut: true },
      },
    ];
    const result = classifyAudience(patients, 'whatsapp', 'marketing');
    assert.equal(result.eligibleCount, 1);
    assert.equal(result.excludedCount, 2);
    assert.ok(result.reasonCounts.missing_phone >= 1);
    assert.ok(result.reasonCounts.opted_out >= 1);
  });
});

describe('comms config', () => {
  it('reports unconfigured providers without secrets', () => {
    const status = getCommsConfigStatus();
    assert.equal(typeof status.whatsapp.configured, 'boolean');
    assert.ok(Array.isArray(status.whatsapp.missing));
    assert.ok(!JSON.stringify(status).includes('sk_'));
  });
});
