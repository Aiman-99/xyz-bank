import { describe, expect, it } from 'vitest';
import { formatMinor, parseAmount } from '../src/money.js';

describe('parseAmount', () => {
  it('converts decimal text to integer minor units without floats', () => {
    expect(parseAmount('12.34')).toBe(1234);
    expect(parseAmount('12')).toBe(1200);
    expect(parseAmount('0.1')).toBe(10);
    expect(parseAmount('0.01')).toBe(1);
    expect(parseAmount(' 7.5 ')).toBe(750);
    expect(parseAmount(19.99)).toBe(1999);
    // classic float traps: 0.1 + 0.2 and 1.15 * 100
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(30);
    expect(parseAmount('1.15')).toBe(115);
    expect(parseAmount('1000000')).toBe(100_000_000);
    expect(parseAmount('1000000000')).toBe(100_000_000_000); // the maximum: one billion
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['non-numeric', 'abc'],
    ['negative', '-5'],
    ['negative number', -5],
    ['zero', '0'],
    ['zero with decimals', '0.00'],
    ['three decimal places', '1.234'],
    ['float artefact', 0.1 + 0.2],
    ['exponent notation', '1e5'],
    ['hex', '0x10'],
    ['thousands separator', '1,000'],
    ['just over the one billion limit', '1000000000.01'],
    ['eleven integer digits', '10000000000'],
    ['astronomically large', '99999999999999999999'],
    ['Infinity', Infinity],
    ['NaN', NaN],
    ['boolean', true],
    ['object', { amount: 5 }],
    ['array', [5]],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAmount(value)).toThrowError(/amount/i);
  });
});

describe('formatMinor', () => {
  it('formats minor units as a 2-decimal string', () => {
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(123456)).toBe('1234.56');
  });
});
