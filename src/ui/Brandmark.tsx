import { institution } from '@/lib/institution';

/**
 * One component, both institutions. An institution with supplied artwork gets
 * the image; one without gets its name set in the brand colour with an accent
 * rule under it, in the same slot at the same height.
 */
export function Brandmark({ height = 28 }: { height?: number }) {
  if (institution.logoUrl) {
    return (
      <img src={institution.logoUrl} alt={institution.productName} style={{ height }} className="w-auto" />
    );
  }

  return (
    <span className="inline-block" style={{ maxWidth: 160 }}>
      <span
        className="block font-bold tracking-[-0.02em] text-brand"
        style={{ fontSize: height * 0.52, lineHeight: 1.08 }}
      >
        {institution.productName}
      </span>
      <span className="block bg-accent" style={{ height: 3, marginTop: 3 }} />
    </span>
  );
}
