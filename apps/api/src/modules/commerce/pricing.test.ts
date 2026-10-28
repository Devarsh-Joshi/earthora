import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeGst } from './pricing.js';

/** Data-driven parity with the shared pricing fixture (GST rules must not drift). */
const fixture = JSON.parse(readFileSync(new URL('./pricing-cases.json', import.meta.url), 'utf8')) as {
  gst: { name: string; input: { totalAmount: number; country: string; state: string }; expected: Record<string, number | boolean> }[];
};

describe('computeGst — fixture parity', () => {
  for (const c of fixture.gst) {
    it(c.name, () => {
      const g = computeGst(c.input.totalAmount, c.input.country, c.input.state);
      if (c.expected.isIndia !== undefined) expect(g.isIndia).toBe(c.expected.isIndia);
      if (c.expected.isGujarat !== undefined) expect(g.isGujarat).toBe(c.expected.isGujarat);
      if (c.expected.cgstAmount !== undefined) expect(Math.round(g.cgstAmount)).toBe(Math.round(c.expected.cgstAmount as number));
      if (c.expected.sgstAmount !== undefined) expect(Math.round(g.sgstAmount)).toBe(Math.round(c.expected.sgstAmount as number));
      if (c.expected.igstAmount !== undefined) expect(Math.round(g.igstAmount)).toBe(Math.round(c.expected.igstAmount as number));
    });
  }
});

describe('computeGst — edge cases', () => {
  it('international order is exempt', () => { const g = computeGst(1000, 'United States', 'California'); expect(g.isIndia).toBe(false); expect(g.totalGstAmount).toBe(0); });
  it('Gujarat abbreviation splits CGST/SGST', () => { const g = computeGst(1180, 'India', 'GJ'); expect(g.isGujarat).toBe(true); expect(Math.round(g.cgstAmount)).toBe(90); expect(Math.round(g.sgstAmount)).toBe(90); });
  it('other Indian state uses IGST', () => { const g = computeGst(1180, 'India', 'Maharashtra'); expect(g.isGujarat).toBe(false); expect(Math.round(g.igstAmount)).toBe(180); });
  it('Devanagari India + Gujarati script state', () => { const g = computeGst(1180, 'भारत', 'ગુજરાત'); expect(g.isIndia).toBe(true); expect(g.isGujarat).toBe(true); });
});
