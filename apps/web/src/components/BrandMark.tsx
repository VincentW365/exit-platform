import { BRAND } from '@exit/domain';

/**
 * The company logo as a transparent mark that sits directly on the navy
 * chrome. Screens use the derived mark (BRAND.logoMark*, white canvas
 * removed and trimmed); documents and PDF rendering keep the original
 * white-canvas asset pinned in BRAND.
 */
export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */
    <img
      src={BRAND.logoMarkWebPath}
      alt={BRAND.logoAlt}
      className={size === 'lg' ? 'brand-mark brand-mark--lg' : 'brand-mark'}
      width={BRAND.logoMarkWidth}
      height={BRAND.logoMarkHeight}
    />
  );
}
