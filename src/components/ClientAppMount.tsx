'use client';

import { useEffect, useState } from 'react';
import App from '@/App';

const WorkstationLoadingShell = () => (
  <div className="min-h-screen flex text-[#0F141F] dark:text-[#F3F6FA] font-sans">
    <aside
      aria-hidden="true"
      className="hidden md:flex md:w-[240px] lg:w-[260px] shrink-0 flex-col bg-white/95 dark:bg-[#0A0D14]/95 border-r border-[#DCE1EB] dark:border-white/[0.08] h-screen"
    >
      <div className="h-14 px-4.5 flex items-center gap-2.5 border-b border-[#DCE1EB] dark:border-white/[0.08]">
        <div className="w-8 h-8 rounded-lg bg-[#0F141F]/80 dark:bg-blue-600/80 animate-pulse" />
        <div className="h-4 w-32 rounded bg-[#EEF1F6] dark:bg-zinc-800 animate-pulse" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="h-10 rounded-xl bg-[#EEF1F6]/80 dark:bg-white/[0.04] animate-pulse"
          />
        ))}
      </div>
    </aside>

    <div className="flex-1 min-w-0 flex flex-col min-h-screen">
      <header className="h-13 md:h-14 bg-white/90 dark:bg-[#090C12]/90 border-b border-[#DCE1EB] dark:border-white/[0.08] px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <div className="h-4 w-48 rounded bg-[#EEF1F6] dark:bg-zinc-800 animate-pulse" />
        <div className="h-8 w-36 rounded-lg bg-[#EEF1F6] dark:bg-zinc-800 animate-pulse" />
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 xl:col-span-8 h-72 rounded-2xl bg-white dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] p-6 space-y-4 animate-pulse">
            <div className="h-7 w-72 max-w-full rounded bg-[#EEF1F6] dark:bg-zinc-800" />
            <div className="h-4 w-96 max-w-full rounded bg-[#F4F6F9] dark:bg-zinc-800/70" />
            <div className="h-11 w-full rounded-xl bg-[#F4F6F9] dark:bg-zinc-800/60 mt-4" />
          </div>
          <div className="lg:col-span-5 xl:col-span-4 h-72 rounded-2xl bg-[#EEF1F6] dark:bg-[#0E121B] border border-[#DCE1EB] dark:border-white/[0.08] animate-pulse" />
        </div>
      </main>
    </div>
  </div>
);

export function ClientAppMount() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <WorkstationLoadingShell />;
  }

  return <App />;
}
