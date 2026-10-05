import { describe, expect, it } from 'vitest';
import { vapidKeyBytes } from '../src/features/notifications/push';

describe('the VAPID key', () => {
  it('decodes URL-safe base64 without padding, as web-push prints it', () => {
    // 'hello?' in standard base64 is 'aGVsbG8/'; URL-safe and unpadded: 'aGVsbG8_'
    expect(Array.from(vapidKeyBytes('aGVsbG8_'))).toEqual([104, 101, 108, 108, 111, 63]);
  });

  it('is backed by a plain ArrayBuffer, which pushManager.subscribe requires', () => {
    expect(vapidKeyBytes('AAAA').buffer).toBeInstanceOf(ArrayBuffer);
  });
});
