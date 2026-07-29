import type { Metadata } from 'next';
import './globals.css';

// Page titles stay generic: no employee or termination detail may appear in
// the browser title (DesignSystem section 9).
export const metadata: Metadata = {
  title: { default: 'Offboarding Platform', template: '%s - Offboarding Platform' },
  description: "Bert's Auto Parts employee offboarding (internal)",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
