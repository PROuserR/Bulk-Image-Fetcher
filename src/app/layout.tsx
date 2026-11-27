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

const SITE_TITLE = 'FrameVault — Capture, Local AI Synthesis & Grading Studio';
const SITE_DESCRIPTION =
  'FrameVault local-first imaging suite: full-resolution web & Instagram capture, local folder gallery, batch crop/resize, non-destructive color grading, GIF89a motion, Ollama/Gemma vision, and local SD/ComfyUI/MOSS generation.';

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
    if (theme === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
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
        className="studio-canvas-bg text-[#0F141F] dark:text-[#F3F6FA] font-sans antialiased min-h-screen selection:bg-blue-600/20 selection:text-blue-700 dark:selection:text-blue-300"
      >
        {children}
      </body>
    </html>
  );
}
