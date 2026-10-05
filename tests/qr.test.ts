import { describe, expect, it } from 'vitest';
import { generateQrToken } from '../src/features/equipment/qr';

describe('the QR token', () => {
  it('avoids characters a person would mistype off a damaged label', () => {
    const tokens = Array.from({ length: 500 }, () => generateQrToken());
    expect(tokens.join('')).not.toMatch(/[ILOU01]/);
  });

  it('is 12 characters and does not repeat', () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => generateQrToken()));
    expect(tokens.size).toBe(2000);
    expect([...tokens][0]).toHaveLength(12);
  });
});
