// node --test src/lib/financing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPayment, applyUrl } from './financing.js';

test('monthly payment matches Enhancify\'s calculator', () => {
  assert.equal(monthlyPayment(71000, 9.1, 5).toFixed(2), '1477.29');
  assert.equal(monthlyPayment(5000, 10, 3).toFixed(2), '161.34'); // their representative example
  assert.equal(monthlyPayment(1200, 0, 1), 100);
  assert.equal(monthlyPayment(0), 0);
});

test('apply link goes to our Enhancify page', () => {
  assert.ok(applyUrl('quote').startsWith('https://www.enhancify.com/peninsula-siding-company?'));
});
