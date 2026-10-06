import { Icon } from '@/ui/Icon';
import type { PublicAddress } from './qr';

/**
 * Says, next to every label, exactly which address its QR code will open,
 * and stops a label being printed when that address would not work.
 */
export function AddressNotice({ address }: { address: PublicAddress & { loading: boolean } }) {
  if (address.loading) return null;

  if (address.isPrivate) {
    return (
      <p role="alert" className="mb-0 mt-4 flex items-start gap-3 rounded-lg bg-urgent-tint p-4 text-[14px] leading-5 text-urgent-ink">
        <Icon name="error" filled className="shrink-0" />
        <span>
          <strong>Labels can&rsquo;t be printed yet.</strong> Their codes would open{' '}
          <span className="mono break-all">{address.url}</span>, which only works on this computer. An administrator sets
          the live address once, under <strong>Admin &rarr; Public address</strong>; after that every device prints
          labels that work.
        </span>
      </p>
    );
  }

  if (address.source === 'admin') {
    return (
      <p className="mb-0 mt-4 flex items-start gap-2 text-[14px] leading-5 text-ink-muted">
        <Icon name="qr_code_2" className="shrink-0" />
        <span>
          These codes open <span className="mono break-all text-ink-strong">{address.url}</span>
        </span>
      </p>
    );
  }

  return (
    <p className="mb-0 mt-4 flex items-start gap-3 rounded-lg bg-attention-tint p-4 text-[14px] leading-5 text-attention-ink">
      <Icon name="warning" className="shrink-0" />
      <span>
        These codes will open <span className="mono break-all">{address.url}</span>, because no public address has been
        saved yet. Labels printed from a different address would differ. Before printing for real, an administrator
        should save it under <strong>Admin &rarr; Public address</strong>.
      </span>
    </p>
  );
}
