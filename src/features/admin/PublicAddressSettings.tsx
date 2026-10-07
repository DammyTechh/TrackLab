import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { institution } from '@/lib/institution';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { normalisePublicAddress, usePublicAddress } from '@/features/equipment';
import { describeError } from '@/lib/errors';

/**
 * The one address every QR label opens. Saved in the database (0012), so it
 * no longer depends on the computer or the build that prints a label, and a
 * move to a custom domain is a change here rather than a rebuild.
 */
export function PublicAddressSettings() {
  const queryClient = useQueryClient();
  const address = usePublicAddress();
  const saved = address.source === 'admin' ? address.url : '';
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!address.loading) setDraft(saved);
  }, [address.loading, saved]);

  const save = useMutation({
    mutationFn: async (url: string) => {
      const { data, error: updateError } = await supabase
        .from('institution')
        .update({ public_base_url: url })
        .eq('code', institution.code)
        .select('public_base_url');
      if (updateError) throw updateError;
      if (!data || data.length === 0) throw new Error('Only an administrator can change the public address.');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['institution-address'] }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const result = normalisePublicAddress(draft);
    if (!result.ok) return setError(result.error);
    setError(undefined);
    setDraft(result.url);
    save.mutate(result.url);
  }

  const changed = normalisePublicAddress(draft);
  const isChange = changed.ok ? changed.url !== saved : draft.trim() !== saved;

  return (
    <section className="mt-8 rounded-lg border border-line-subtle bg-surface-raised p-4 sm:p-5">
      <h2 className="m-0 text-[19px] font-semibold text-ink-strong">Public address</h2>
      <p className="mb-0 mt-2 max-w-[44rem] text-[15px] leading-[23px] text-ink-muted">
        The web address printed into every QR label. Set it once, before printing any labels, to the address everyone
        uses &mdash; your custom domain if you have one. Every phone and computer then prints labels that open it,
        wherever they are printing from.
      </p>

      <form onSubmit={onSubmit} className="mt-4 flex max-w-[36rem] flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Field
            label="Address"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://app.tracklab.edu.ng"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            error={error ?? (save.isError ? (describeError(save.error, 'Not saved.')) : undefined)}
            help="https only, with nothing after the address."
          />
        </div>
        <Button
          type="submit"
          intent="primary"
          icon="save"
          className="sm:mt-[26px]"
          disabled={address.loading || save.isPending || !isChange}
        >
          {save.isPending ? 'Saving…' : 'Save address'}
        </Button>
      </form>

      {saved && !save.isPending ? (
        <p className="mb-0 mt-3 flex items-start gap-2 text-[14px] leading-5 text-ink">
          <Icon name="check_circle" filled size={18} className="shrink-0 text-brand" />
          Labels open <span className="mono break-all text-ink-strong">{saved}</span>
        </p>
      ) : null}

      <p className="mb-0 mt-3 max-w-[44rem] text-[13px] leading-[19px] text-ink-muted">
        Changing it later only affects labels printed afterwards; labels already stuck on machines keep the address they
        were printed with. Keep the old address working (on Vercel, a project&rsquo;s .vercel.app address keeps working
        alongside a custom domain) and those labels will go on scanning.
      </p>
    </section>
  );
}
