import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const checks = [
  { label: "Sectors API key", ok: Boolean(env.SECTORS_API_KEY), hint: "SECTORS_API_KEY in .env" },
  { label: "Anthropic API key", ok: Boolean(env.ANTHROPIC_API_KEY), hint: "optional: narration + chat" },
  { label: "Telegram alerts", ok: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), hint: "optional" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">Stonks</h1>
      <p className="mt-2 opacity-80">
        See what moved a stock, test which explanation holds, and know what would prove it wrong.
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Setup</h2>
        <ul className="mt-3 divide-y divide-current/10 rounded-lg border border-current/15">
          {checks.map((c) => (
            <li key={c.label} className="flex items-center justify-between px-4 py-3">
              <span>{c.label}</span>
              <span className={`text-sm ${c.ok ? "text-green-600" : "opacity-60"}`}>
                {c.ok ? "configured" : c.hint}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
