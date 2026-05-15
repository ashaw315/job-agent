"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[color:var(--bg)] text-[color:var(--text-pri)]">
      <div className="text-center">
        <div className="mb-2 font-mono text-[color:var(--text-sec)]">job-agent</div>
        <div className="mb-4">Couldn&rsquo;t load settings</div>
        <button
          onClick={reset}
          className="rounded border border-[color:var(--border-strong)] px-3 py-1 text-[12px] text-[color:var(--accent)] hover:bg-[color:var(--accent-bg)]"
        >
          Retry
        </button>
      </div>
    </div>
  );
}
