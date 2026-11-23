import type { Metadata } from 'next';
import {
  Plus_Jakarta_Sans,
  Bricolage_Grotesque,
  JetBrains_Mono,
} from 'next/font/google';
import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-bricolage',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const SITE_TITLE = 'FullRes — High-Resolution Image Extractor & Studio';
const SITE_DESCRIPTION =
  'Extract full-size source images from any webpage or Instagram profile with intelligent CDN un-shrinking, contact-sheet inspector, progressive direct save, directory crop & resize, and batch ZIP export.';

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

const THEME_INIT_SCRIPT = `
(function() {
  try {
    var theme = localStorage.getItem('theme');
    var supportDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (theme === 'dark' || (!theme && supportDark)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakartaSans.variable} ${bricolageGrotesque.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        suppressHydrationWarning
        className="studio-canvas-bg text-[#141413] dark:text-[#F5F4F0] font-sans antialiased min-h-screen selection:bg-blue-600/20 selection:text-blue-700 dark:selection:text-blue-300"
      >
        {children}
      </body>
    </html>
  );
}
