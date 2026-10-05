// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { digestEmail, escapeHtml } from '../supabase/functions/_shared/render';

describe('emails', () => {
  it('escapes anything staff typed before it goes into HTML', () => {
    expect(escapeHtml('Oven <300 C> & "dryer"')).toBe('Oven &lt;300 C&gt; &amp; &quot;dryer&quot;');
  });

  it('says plainly when nothing is outstanding, rather than sending an empty table', () => {
    const email = digestEmail(
      { week: '2026-W40', scope: 'all', total: 0, counts: { overdue: 0, faulty: 0, replace: 0 }, items: [] },
      'https://evidencetag.example',
    );
    expect(email.subject).toContain('nothing outstanding');
    expect(email.html).toContain('Nothing is overdue');
    expect(email.html).not.toContain('<tr>\n        <td style="padding:10px 0');
  });

  it('lists the machines, escaped, and says when the list is cut short', () => {
    const email = digestEmail(
      {
        week: '2026-W40',
        scope: 'own',
        total: 30,
        truncated: true,
        counts: { overdue: 28, faulty: 1, replace: 1 },
        items: [{ asset_id: 'TEST-PHY1-0001', name: 'Vacuum <pump>', lab: 'Physics Lab 1', status: 'overdue', due: '2025-09-01' }],
      },
      'https://evidencetag.example',
    );
    expect(email.subject).toBe('Weekly equipment summary: 30 need attention (2026-W40)');
    expect(email.html).toContain('Vacuum &lt;pump&gt;');
    expect(email.html).toContain('in your laboratories');
    expect(email.html).toContain('25 most urgent of 30');
  });
});
