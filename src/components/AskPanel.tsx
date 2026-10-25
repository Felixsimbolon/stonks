"use client";

import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ease } from "./charts/kit";

// Ask Stonks: a drawer chat over the local data. The server streams NDJSON
// events; our guardrails can withhold a finished answer.

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Tool currently being read, while streaming. */
  tool?: string;
  withheld?: string[];
  /** Declined as off-topic by our guardrail (or the model's marker). */
  offTopic?: boolean;
  error?: string;
  pending?: boolean;
}

const TOOL_LABEL: Record<string, string> = {
  list_watchlist: "reading your watchlist",
  get_stock_facts: "reading the engine's facts",
  get_move_investigation: "opening the investigation",
  get_coal_cost_curve: "reading the coal cost curve",
  get_case_files: "reading the case files",
};

const STORAGE_KEY = "stonks.ask.v1";
const MAX_CHARS = 2000;

function suggestions(ticker: string | null): string[] {
  return ticker
    ? [`Why did ${ticker} move last?`, `What would prove that explanation wrong?`, `Ringkas kondisi ${ticker} dari datanya`]
    : ["Which watchlist stock had the most unusual moves?", "How has the engine's track record looked?", "Bandingkan biaya per ton emiten batu bara"];
}

export function AskPanel({ configured }: { configured: boolean }) {
  const pathname = usePathname();
  const ticker = pathname.match(/^\/([A-Za-z]{4})$/)?.[1]?.toUpperCase() ?? null;
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Per-viewer convenience: keep the conversation across page navigations.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setMsgs((JSON.parse(saved) as Msg[]).filter((m) => !m.pending));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.filter((m) => !m.pending)));
    } catch {}
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patchLast = (fn: (m: Msg) => Msg) => setMsgs((prev) => [...prev.slice(0, -1), fn(prev.at(-1)!)]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    // Only clean turns go back to the server: withheld or failed answers are left out.
    const history = [...msgs, { role: "user" as const, content: q }]
      .filter((m) => !m.withheld && !m.error && !m.offTopic && m.content.trim())
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
    setMsgs((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);
    setInput("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: history, ticker }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        patchLast((m) => ({ ...m, pending: false, error: body.error ?? `Request failed (${res.status}).` }));
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.t === "text") patchLast((m) => ({ ...m, content: m.content + e.d, tool: undefined }));
          else if (e.t === "tool") patchLast((m) => ({ ...m, tool: e.name }));
          else if (e.t === "withheld") patchLast((m) => ({ ...m, withheld: e.reasons }));
          else if (e.t === "offtopic") patchLast((m) => ({ ...m, content: e.message, offTopic: true, tool: undefined }));
          else if (e.t === "error") patchLast((m) => ({ ...m, error: e.message }));
        }
      }
      patchLast((m) => ({ ...m, pending: false, tool: undefined }));
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === "AbortError";
      patchLast((m) => ({ ...m, pending: false, tool: undefined, error: aborted ? "Stopped." : "Connection lost." }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full border border-hair bg-[#121117]/90 px-4 py-2.5 text-sm text-ink shadow-xl backdrop-blur"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: open ? 0 : 1, y: 0 }}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.97 }}
        aria-label="Ask Stonks"
      >
        <span className="block h-2 w-2 rounded-full" style={{ background: "linear-gradient(135deg, var(--stock), var(--sector))" }} />
        Ask Stonks{ticker ? ` about ${ticker}` : ""}
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              role="dialog"
              aria-label="Ask Stonks"
              className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-md flex-col border-l border-hair bg-[#0d0c12]/95 backdrop-blur-xl"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.45, ease }}
            >
              <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-6">
                <div>
                  <p className="display text-2xl italic">Ask Stonks</p>
                  <p className="mt-1 text-xs text-faint">
                    Answers from your stored data only{ticker ? ` · looking at ${ticker}` : ""} · not financial advice
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {msgs.length > 0 && !busy && (
                    <button type="button" onClick={() => setMsgs([])} className="eyebrow hover:text-ink">
                      clear
                    </button>
                  )}
                  <button type="button" onClick={() => setOpen(false)} className="eyebrow hover:text-ink" aria-label="Close">
                    close
                  </button>
                </div>
              </header>
              <div className="hairline" />

              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {!configured && (
                  <p className="text-sm text-muted">
                    Ask Stonks needs <span className="text-ink">ANTHROPIC_API_KEY</span> in <span className="num">.env</span>.
                  </p>
                )}
                {configured && msgs.length === 0 && (
                  <div>
                    <p className="text-sm text-muted">Ask about moves, explanations, case files, or mining assets. Try:</p>
                    <div className="mt-3 space-y-2">
                      {suggestions(ticker).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => ask(s)}
                          className="block w-full rounded-md border border-hair px-3 py-2 text-left text-sm text-muted transition-colors hover:border-[var(--c-series)] hover:text-ink"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {msgs.map((m, i) =>
                  m.role === "user" ? (
                    <motion.div key={i} className="ml-10 rounded-lg bg-white/[0.05] px-3.5 py-2.5 text-sm text-ink" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                      {m.content}
                    </motion.div>
                  ) : (
                    <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm leading-relaxed">
                      {m.withheld ? (
                        <p className="border-l-2 border-[var(--c-neg)] pl-3 text-muted">
                          This answer was withheld: it drifted into advice ({m.withheld.join("; ")}). Stonks describes evidence; it
                          doesn&apos;t tell you what to trade. Try asking what the data shows instead.
                        </p>
                      ) : m.offTopic ? (
                        <p className="border-l-2 border-hair pl-3 text-faint">{m.content}</p>
                      ) : (
                        m.content && <p className="whitespace-pre-wrap text-muted">{m.content}</p>
                      )}
                      {m.pending && (
                        <p className="mt-1 flex items-center gap-2 text-xs text-faint">
                          <motion.span
                            className="block h-1.5 w-1.5 rounded-full bg-[var(--c-series)]"
                            animate={{ opacity: [0.3, 1, 0.3] }}
                            transition={{ repeat: Infinity, duration: 1.2 }}
                          />
                          {m.tool ? `${TOOL_LABEL[m.tool] ?? m.tool}…` : m.content ? "writing…" : "thinking…"}
                        </p>
                      )}
                      {m.error && <p className="mt-1 text-xs text-down">{m.error}</p>}
                    </motion.div>
                  ),
                )}
                <div ref={endRef} />
              </div>

              <form
                className="border-t border-hair p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  ask(input);
                }}
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      ask(input);
                    }
                  }}
                  rows={2}
                  disabled={!configured}
                  placeholder={ticker ? `Ask about ${ticker}…` : "Ask about your stocks…"}
                  className="w-full resize-none bg-transparent text-sm text-ink outline-none placeholder:text-faint"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="num text-[10px] text-faint">
                    {input.length}/{MAX_CHARS} · Enter to send
                  </span>
                  {busy ? (
                    <button type="button" onClick={() => abortRef.current?.abort()} className="eyebrow hover:text-ink">
                      stop
                    </button>
                  ) : (
                    <button type="submit" disabled={!input.trim() || !configured} className="eyebrow text-ink disabled:text-faint">
                      ask →
                    </button>
                  )}
                </div>
              </form>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
