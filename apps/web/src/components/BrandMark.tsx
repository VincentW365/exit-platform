import { BRAND } from '@exit/domain';

/**
 * The company logo presented as a framed brand plate.
 *
 * The approved v1 asset (path, dimensions and hash pinned in BRAND) bakes a
 * white canvas around the artwork, so rendering the file directly reads as a
 * pasted image. The plate frames the mark deliberately and its inner window
 * crops to the measured artwork region; the crop ratios live with the
 * .brand-mark rules in globals.css and must be re-measured if the asset
 * version changes.
 */
export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={size === 'lg' ? 'brand-mark brand-mark--lg' : 'brand-mark'}>
      <span className="brand-mark__window">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static brand asset */}
        <img
          src={BRAND.logoWebPath}
          alt={BRAND.logoAlt}
          width={BRAND.logoWidth}
          height={BRAND.logoHeight}
        />
      </span>
    </span>
  );
}
