'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const commission = require('../src/services/commission.service');

test('percentage commission with GST + TDS', () => {
  // 2% of ₹1000 = ₹20 commission; GST 18% = 3.60; TDS 5% = 1.00; net (incl GST) = 23.60
  const r = commission.computeAmounts({ commissionType: 'percentage', value: 2, amount: 1000 });
  assert.equal(r.commission, 20);
  assert.equal(r.gst, 3.6);
  assert.equal(r.tds, 1);
  assert.equal(r.net, 23.6);
});

test('flat-amount commission with GST + TDS', () => {
  // ₹6 flat; GST 18% = 1.08; TDS 5% = 0.30; net = 7.08
  const r = commission.computeAmounts({ commissionType: 'amount', value: 6, amount: 5000 });
  assert.equal(r.commission, 6);
  assert.equal(r.gst, 1.08);
  assert.equal(r.tds, 0.3);
  assert.equal(r.net, 7.08);
});

test('custom GST/TDS rates are honored', () => {
  const r = commission.computeAmounts({ commissionType: 'amount', value: 100, amount: 0, gstPercent: 0, tdsPercent: 10 });
  assert.equal(r.commission, 100);
  assert.equal(r.gst, 0);
  assert.equal(r.tds, 10);
  assert.equal(r.net, 100);
});
