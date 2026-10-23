export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="mt-28 max-w-xl">
        <p className="eyebrow mb-6">investigating</p>
        <p className="display text-5xl text-muted">
          Gathering evidence<span className="inline-block animate-pulse">…</span>
        </p>
        <p className="mt-4 text-sm text-faint">
          Prices, the index, subsector peers and corporate actions. The first look at a ticker fetches peer history;
          after that it&apos;s cached.
        </p>
      </div>
      <div className="mt-16 space-y-6">
        {[0.9, 0.7, 0.8, 0.5].map((w, i) => (
          <div key={i} className="relative h-px overflow-hidden bg-hair" style={{ width: `${w * 100}%` }}>
            <div
              className="absolute inset-y-0 w-1/3 animate-[shimmer_1.6s_ease-in-out_infinite]"
              style={{
                background: "linear-gradient(90deg, transparent, var(--stock), transparent)",
                animationDelay: `${i * 0.15}s`,
              }}
            />
          </div>
        ))}
      </div>
    </main>
  );
}
