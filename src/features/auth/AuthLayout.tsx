import { useState, type ReactNode } from 'react';
import { institution } from '@/lib/institution';

/**
 * Every sign-in screen: the institution's illustration beside the form on a
 * desktop, above it on phones and tablets, sized by screen height so the
 * whole form stays visible without scrolling. With no illustration set, or
 * if it fails to load, the form stands alone.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  const [artFailed, setArtFailed] = useState(false);
  const art = institution.signinImage;
  const showArt = Boolean(art) && !artFailed;

  return (
    <div className={showArt ? 'lg:grid lg:min-h-[calc(100dvh-56px)] lg:grid-cols-2' : undefined}>
      {showArt ? (
        // Decorative, so alt="" and hidden from screen readers. The browser
        // fetches the 640px file on a phone.
        <div
          aria-hidden="true"
          className="flex justify-center px-4 pt-5 sm:px-6 sm:pt-8 lg:order-2 lg:flex-col lg:items-center lg:justify-center lg:bg-brand-surface lg:p-12"
        >
          <img
            src={`${art}-1100.webp`}
            srcSet={`${art}-640.webp 640w, ${art}-1100.webp 1100w`}
            sizes="(min-width: 1024px) 34rem, 18rem"
            width={1100}
            height={967}
            alt=""
            decoding="async"
            onError={() => setArtFailed(true)}
            className="h-[min(25vh,15rem)] w-auto object-contain sm:h-[min(32vh,18rem)] lg:h-auto lg:w-full lg:max-w-[34rem]"
          />
          <p className="mt-6 hidden max-w-[26rem] text-center text-[15px] leading-[23px] text-ink-muted lg:block">
            Scan any label to see a machine&rsquo;s status. Sign in to record use, faults and servicing.
          </p>
        </div>
      ) : null}

      <div className={showArt ? 'lg:order-1 lg:flex lg:items-center' : undefined}>{children}</div>
    </div>
  );
}
