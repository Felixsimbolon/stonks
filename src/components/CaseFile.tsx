"use client";

import { motion } from "motion/react";
import type { FetchResult } from "@/app/actions";
import { hypothesisLabel, type CaseEventKind } from "@/lib/casebook/logic";
import type { CaseView } from "@/lib/casebook/store";
import { FetchButton } from "./FetchButton";
import { shortDate } from "./format";

const ease = [0.22, 1, 0.36, 1] as const;

const KIND: Record<CaseEventKind, { label: string; color: string }> = {
  move: { label: "the move", color: "var(--stock)" },
  falsifier_broke: { label: "broke", color: "var(--down)" },
  falsifier_held: { label: "held", color: "var(--up)" },
  closed: { label: "closed", color: "var(--sector)" },
  refiled: { label: "re-filed", color: "var(--muted)" },
};

interface Props {
  caseFile: CaseView | null;
  fileCase: () => Promise<FetchResult>;
  checkCases: () => Promise<FetchResult>;
}

export function CaseFile({ caseFile: c, fileCase, checkCases }: Props) {
  if (!c) {
    return (
      <div className="max-w-2xl">
        <p className="display text-3xl leading-tight text-muted">
          Freeze this conclusion and <em className="gradient-text">see if it survives.</em>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-faint">
          A case file records what the engine concluded today, then re-checks each &ldquo;would break if&rdquo; against
          the sessions that follow. Closed cases feed the engine&apos;s track record.
        </p>
        <FetchButton action={fileCase} label="file this case" pendingLabel="filing…" hint="0 credits · uses stored data" className="mt-5" />
      </div>
    );
  }

  const pending = c.falsifiers.filter((f) => f.status === "pending");
  const closed = c.status === "closed";

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_18rem]">
      <div>
        <p className="text-sm text-muted">
          Filed {shortDate(c.filedOn)}
          {closed ? (
            <>
              {" "}
              · <span style={{ color: "var(--sector)" }}>closed {c.closedOn ? shortDate(c.closedOn) : ""}</span>
            </>
          ) : (
            <>
              {" "}
              · <span className="text-ink">open</span>, watching {pending.length} condition{pending.length === 1 ? "" : "s"}
            </>
          )}
        </p>

        <ol className="relative mt-8 pl-8">
          <motion.span
            aria-hidden
            className="absolute bottom-2 left-[5px] top-2 w-px origin-top"
            style={{ background: "linear-gradient(180deg, var(--stock), var(--sector) 60%, transparent)" }}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.9, ease }}
          />
          {c.events.map((e, i) => {
            const k = KIND[e.kind];
            return (
              <motion.li
                key={`${e.kind}-${e.date}-${i}`}
                className="relative pb-7 last:pb-0"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.12, duration: 0.5, ease }}
              >
                <motion.span
                  aria-hidden
                  className="absolute -left-8 top-1.5 block h-[11px] w-[11px] rounded-full border-2"
                  style={{ borderColor: k.color, background: e.kind === "move" ? k.color : "var(--bg)" }}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.25 + i * 0.12, type: "spring", stiffness: 420, damping: 16 }}
                />
                <div className="flex items-baseline gap-3">
                  <span className="num text-xs text-faint">{shortDate(e.date)}</span>
                  <span className="eyebrow" style={{ color: k.color }}>
                    {k.label}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{e.message}</p>
              </motion.li>
            );
          })}
        </ol>
      </div>

      <aside className="space-y-8">
        {pending.length > 0 && (
          <div>
            <p className="eyebrow mb-3">still watching</p>
            <ul className="space-y-4">
              {pending.map((f) => (
                <li key={f.id}>
                  <p className="text-sm text-ink">{hypothesisLabel(f.hypothesisType)}</p>
                  <div className="mt-2 flex items-center gap-1">
                    {Array.from({ length: f.window }, (_, i) => (
                      <span
                        key={i}
                        className="block h-1.5 w-4 rounded-full"
                        style={{ background: i < f.daysObserved ? "var(--ink)" : "var(--hair)", opacity: i < f.daysObserved ? 0.55 : 1 }}
                      />
                    ))}
                    <span className="num ml-2 text-xs text-faint">
                      {f.daysObserved}/{f.window}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!closed && (
          <div className="space-y-5">
            <FetchButton
              action={checkCases}
              label="check open cases"
              pendingLabel="checking…"
              hint="0 credits · run after updating prices"
            />
            <FetchButton
              action={fileCase}
              label="re-file with current evidence"
              pendingLabel="re-filing…"
              hint="resets this case's checks"
            />
          </div>
        )}
      </aside>
    </div>
  );
}
