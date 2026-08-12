/**
 * Approved company branding (Directive 5.1 section H).
 *
 * One controlled configuration record for the brand: screens and the PDF
 * renderer consume THIS module (plus the configurable BRAND_LOGO_PATH), so a
 * future logo replacement changes this file and the asset - never document
 * templates. The logo binary lives at exactly one source location
 * (apps/web/public/brand/) and is referenced everywhere else by path.
 */
export const BRAND = {
  companyName: "Bert's Auto Parts",
  legalName: "BERT'S AUTO PARTS LTD.",
  /** Accessible alternative text (H.6). */
  logoAlt: "Bert's Auto Parts",
  /** Web path served by the application shell. */
  logoWebPath: '/brand/berts-auto-parts.png',
  /** Asset provenance (H.13): user-approved logo supplied 2026-07-30. */
  logoFileName: 'berts-auto-parts.png',
  logoVersion: 1,
  logoSha256: '08de3c0a33c9bbcd9916c57b5fee21b66618d92a21951f75b3ab4ec89c6229d5',
  /** Native pixel size of version 1 (used to preserve aspect ratio). */
  logoWidth: 1184,
  logoHeight: 880,
  /**
   * Derived web-display mark: the v1 artwork with its baked white canvas
   * removed and trimmed, so screens place the logo directly on the navy
   * chrome. Derived from the approved v1 asset at the user's request
   * (2026-08-12); documents/PDF rendering keep the original file above.
   */
  logoMarkWebPath: '/brand/berts-auto-parts-mark.png',
  logoMarkFileName: 'berts-auto-parts-mark.png',
  logoMarkSha256: 'e698c712261e6b4c41b7603948e7212e2269e422cbe88504f613ea2a197f113d',
  /** Native pixel size of the derived mark. */
  logoMarkWidth: 1038,
  logoMarkHeight: 587,
} as const;
