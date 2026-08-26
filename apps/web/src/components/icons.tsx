/**
 * Line icons for navigation, empty states and card headers.
 *
 * Inline SVG rather than an icon package: the app ships no client JavaScript
 * for chrome, and these render inside server components. Every icon inherits
 * `currentColor` and sizes from the `--icon-size` custom property, so a single
 * CSS rule can retune a whole surface. They are decorative - each is marked
 * `aria-hidden`, and the visible label beside it carries the meaning.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: IconProps) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </Icon>
  );
}

export function CasesIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 12h18" />
    </Icon>
  );
}

export function QueueIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 7h10" />
      <path d="M4 12h10" />
      <path d="M4 17h6" />
      <path d="m16 15 2 2 4-4" />
    </Icon>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 4.5 21 19H3z" />
      <path d="M12 10v4" />
      <path d="M12 16.6h.01" />
    </Icon>
  );
}

export function DirectoryIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="9" cy="9" r="3" />
      <path d="M4 19c0-2.5 2.2-4.2 5-4.2s5 1.7 5 4.2" />
      <path d="M16 8h4" />
      <path d="M16 12h4" />
      <path d="M17 16h3" />
    </Icon>
  );
}

export function ReportsIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 20V5" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.6" />
      <rect x="12.5" y="8" width="3" height="9" rx="0.6" />
      <rect x="18" y="14" width="3" height="3" rx="0.6" />
    </Icon>
  );
}

export function AuditIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M13 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </Icon>
  );
}

export function AdminIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
    </Icon>
  );
}

export function BookIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
    </Icon>
  );
}

export function LifebuoyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="m6 6 3.5 3.5M18 6l-3.5 3.5M6 18l3.5-3.5M18 18l-3.5-3.5" />
    </Icon>
  );
}

export function ChartIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 15.5 9 10l3.5 3.5L20 6" />
      <path d="M15 6h5v5" />
    </Icon>
  );
}

export function PlusIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}

export function InboxIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M5.5 5h13l1.5 8v5H4v-5z" />
    </Icon>
  );
}

export function CheckCircleIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.3 2.4 2.4 4.6-5" />
    </Icon>
  );
}

export function ClockIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </Icon>
  );
}

export function DocumentIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </Icon>
  );
}

export function BoxIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="m12 3 8 4v10l-8 4-8-4V7z" />
      <path d="m4 7 8 4 8-4" />
      <path d="M12 11v10" />
    </Icon>
  );
}

export function MailIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </Icon>
  );
}

export function SearchIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Icon>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3.5 19 6v6c0 4-2.9 7.2-7 8.5-4.1-1.3-7-4.5-7-8.5V6z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

/* --- entity icons ----------------------------------------------------------
   One family, one stroke weight: these name the kinds of thing the platform
   tracks, so a row is recognizable before its label is read. */

export function UserIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Icon>
  );
}

export function LaptopIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </Icon>
  );
}

export function PhoneIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </Icon>
  );
}

export function KeyIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.85 12.15 19 4l2 2-2 2 2 2-3 3-2-2-1.5 1.5" />
    </Icon>
  );
}

export function CardIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </Icon>
  );
}

export function ShirtIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 3 3 6l2 4 2-1v12h10V9l2 1 2-4-6-3a3 3 0 0 1-6 0Z" />
    </Icon>
  );
}

export function BuildingIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M10 21v-4h4v4" />
    </Icon>
  );
}

export function CalendarIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  );
}

export function CoinsIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </Icon>
  );
}

export function ServerIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </Icon>
  );
}

export function ShieldCheckIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function FlowIcon(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      <path d="M9 6h4a2 2 0 0 1 2 2v10" />
    </Icon>
  );
}
