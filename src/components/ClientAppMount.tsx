'use client';

import dynamic from 'next/dynamic';

const WorkstationLoadingShell = () => (
  <div className="min-h-screen flex text-[#141413] dark:text-[#F5F4F0] font-sans">
    <aside
      aria-hidden="true"
      className="hidden md:flex md:w-[232px] lg:w-[252px] shrink-0 flex-col bg-[#FBFBF9] dark:bg-[#0D0F14] border-r border-[#E4E0D6] dark:border-white/[0.08] h-screen"
    >
      <div className="h-14 px-5 flex items-center gap-2.5 border-b border-[#E4E0D6] dark:border-white/[0.08]">
        <div className="w-7 h-7 rounded-lg bg-blue-600/80 animate-pulse" />
        <div className="h-4 w-20 rounded bg-[#EFECE4] dark:bg-zinc-800 animate-pulse" />
      </div>
      <div className="p-4 space-y-3">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="h-10 rounded-xl bg-[#EFECE4]/70 dark:bg-white/[0.04] animate-pulse"
          />
        ))}
      </div>
    </aside>

    <div className="flex-1 min-w-0 flex flex-col min-h-screen">
      <header className="h-13 md:h-14 bg-[#FBFBF9]/90 dark:bg-[#0D0F14]/90 border-b border-[#E4E0D6] dark:border-white/[0.08] px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        <div className="h-4 w-40 rounded bg-[#EFECE4] dark:bg-zinc-800 animate-pulse" />
        <div className="h-8 w-36 rounded-lg bg-[#EFECE4] dark:bg-zinc-800 animate-pulse" />
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 xl:col-span-8 h-64 rounded-2xl bg-white dark:bg-[#111319] border border-[#E4E0D6] dark:border-white/[0.08] p-6 space-y-4 animate-pulse">
            <div className="h-7 w-72 max-w-full rounded bg-[#EFECE4] dark:bg-zinc-800" />
            <div className="h-4 w-96 max-w-full rounded bg-[#F6F5F1] dark:bg-zinc-800/70" />
            <div className="h-11 w-full rounded-xl bg-[#F6F5F1] dark:bg-zinc-800/60 mt-4" />
          </div>
          <div className="lg:col-span-5 xl:col-span-4 h-64 rounded-2xl bg-zinc-200 dark:bg-zinc-900 border border-[#E4E0D6] dark:border-white/[0.08] animate-pulse" />
        </div>
      </main>
    </div>
  </div>
);

const DynamicApp = dynamic(() => import('@/App'), {
  ssr: false,
  loading: WorkstationLoadingShell,
});

export function ClientAppMount() {
  return <DynamicApp />;
}
