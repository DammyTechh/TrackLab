import { describe, expect, it } from 'vitest';
import { normalisePublicAddress, resolvePublicAddress } from '../src/features/equipment/qr';

describe('which address a QR label opens', () => {
  it("prefers the admin's saved address over the build setting and the current page", () => {
    expect(resolvePublicAddress('https://app.example.edu.ng', 'https://old.example', 'http://localhost:5173')).toEqual({
      url: 'https://app.example.edu.ng',
      source: 'admin',
      isPrivate: false,
    });
  });

  it('falls back to the build setting, then to the current page', () => {
    expect(resolvePublicAddress(null, 'https://equipment.example.edu.ng/', 'http://localhost:5173').url).toBe(
      'https://equipment.example.edu.ng',
    );
    expect(resolvePublicAddress(null, undefined, 'http://localhost:5173')).toMatchObject({
      source: 'browser',
      isPrivate: true,
    });
  });
});

describe('what the admin may save', () => {
  it.each([
    ['equipment.example.edu.ng', 'https://equipment.example.edu.ng'],
    ['HTTPS://App.Example.edu.ng/', 'https://app.example.edu.ng'],
  ])('accepts %s as %s', (input, url) => {
    expect(normalisePublicAddress(input)).toEqual({ ok: true, url });
  });

  it.each([
    ['localhost:5173', /only works on one computer/],
    ['http://equipment.example.edu.ng', /https/],
    ['https://equipment.example.edu.ng/login', /nothing after it/],
    ['https://192.168.0.10', /only works on one computer/],
    ['', /Enter the address/],
  ])('refuses %s with a plain reason', (input, reason) => {
    const result = normalisePublicAddress(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(reason);
  });
});
