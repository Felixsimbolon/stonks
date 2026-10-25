import { checkCasesAction } from "@/app/actions";
import { CaseList } from "@/components/CaseList";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { TrackRecord } from "@/components/TrackRecord";
import { getCasesView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const { cases, record, headline } = await getCasesView();
  const open = cases.filter((c) => c.status === "open");
  const closed = cases.filter((c) => c.status === "closed");

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="flex flex-col gap-8 pb-14 pt-20 sm:flex-row sm:items-end sm:justify-between sm:pt-28">
        <div>
          <FadeIn>
            <p className="eyebrow mb-6">case files</p>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="display max-w-3xl text-6xl sm:text-7xl">
              Every call, <em className="gradient-text">on the record.</em>
            </h1>
          </FadeIn>
          <FadeIn delay={0.14}>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              Each case freezes what the engine concluded about a move, then follows the conditions that would prove it
              wrong. Closed cases show how often its explanations actually held.
            </p>
          </FadeIn>
        </div>
        <FadeIn delay={0.2}>
          <FetchButton
            action={checkCasesAction}
            label="check open cases"
            pendingLabel="checking…"
            hint="0 credits · update prices first for new sessions"
            className="sm:text-right"
          />
        </FadeIn>
      </section>

      <section>
        <p className="eyebrow mb-6">track record</p>
        <TrackRecord rows={record} headline={headline} />
      </section>

      <section className="mt-20">
        <p className="eyebrow mb-2">open · {open.length}</p>
        <div className="hairline" />
        {open.length > 0 ? (
          <CaseList cases={open} />
        ) : (
          <p className="py-8 text-sm text-faint">No open cases. File one from any investigation.</p>
        )}
      </section>

      <section className="mt-16">
        <p className="eyebrow mb-2">closed · {closed.length}</p>
        <div className="hairline" />
        {closed.length > 0 ? <CaseList cases={closed} /> : <p className="py-8 text-sm text-faint">Nothing closed yet.</p>}
      </section>
    </main>
  );
}
