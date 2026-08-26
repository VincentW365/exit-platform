import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
// Loaded after globals so the design system refines the foundation rather
// than competing with it.
import './design-system.css';

// Page titles stay generic: no employee or termination detail may appear in
// the browser title (DesignSystem section 9).
export const metadata: Metadata = {
  title: { default: 'Offboarding Platform', template: '%s - Offboarding Platform' },
  description: "Bert's Auto Parts employee offboarding (internal)",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Explicit theme choice from the ThemeToggle preference cookie; with none,
  // the stylesheet follows the system preference.
  const themeCookie = (await cookies()).get('exit_theme')?.value;
  const theme = themeCookie === 'dark' || themeCookie === 'light' ? themeCookie : undefined;
  return (
    <html lang="en" data-theme={theme}>
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
