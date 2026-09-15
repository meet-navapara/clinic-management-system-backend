import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePrintHtml } from '../utils/sanitizeHtml.js';
import { reverseInvoiceStock } from '../utils/inventoryStock.js';

test('sanitizePrintHtml strips script and event handlers', () => {
  const dirty = `<p onclick="alert(1)">Hi</p><script>alert(2)</script><a href="javascript:alert(3)">x</a>`;
  const clean = sanitizePrintHtml(dirty);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.equal(clean.includes('javascript:'), false);
  assert.match(clean, /Hi/);
});

test('sanitizePrintHtml keeps basic formatting', () => {
  const clean = sanitizePrintHtml('<strong>Clinic</strong><br/><em>Ayurveda</em>');
  assert.match(clean, /<strong>Clinic<\/strong>/);
  assert.match(clean, /<em>Ayurveda<\/em>/);
});

test('reverseInvoiceStock clears inventoryDeducted flag', async () => {
  const calls = [];
  const invoice = {
    _id: 'inv1',
    clinicId: 'c1',
    branchId: 'b1',
    inventoryDeducted: true,
    items: [],
    async save() {
      calls.push('save');
    },
  };
  // Empty medicine lines — still must clear the flag after reverse path.
  const result = await reverseInvoiceStock(invoice, 'u1', 'test');
  assert.equal(result.reversed, true);
  assert.equal(invoice.inventoryDeducted, false);
  assert.deepEqual(calls, ['save']);
});

test('reverseInvoiceStock is no-op when not deducted', async () => {
  const invoice = {
    inventoryDeducted: false,
    items: [{ type: 'medicine', medicineId: 'm1', quantity: 1 }],
    async save() {
      throw new Error('should not save');
    },
  };
  const result = await reverseInvoiceStock(invoice, 'u1');
  assert.equal(result.reversed, false);
});
