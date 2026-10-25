"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition } from "react";
import type { FetchResult } from "@/app/actions";

interface Props {
  action: () => Promise<FetchResult>;
  label: string;
  /** Shown under the label, e.g. the expected credit cost. */
  hint?: string;
  /** Label while running. */
  pendingLabel?: string;
  className?: string;
}

/** A text button that runs a Sectors fetch and reports what it cost. */
export function FetchButton({ action, label, hint, pendingLabel = "fetching from Sectors…", className = "" }: Props) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FetchResult | null>(null);

  return (
    <div className={className}>
      <motion.button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setResult(null);
            setResult(await action());
          })
        }
        className="group inline-flex items-center gap-2 text-sm text-ink disabled:text-muted"
        whileTap={{ scale: 0.97 }}
      >
        <motion.span
          aria-hidden
          className="inline-block text-stock"
          animate={pending ? { rotate: 360 } : { rotate: 0 }}
          transition={pending ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0.3 }}
        >
          ↻
        </motion.span>
        <span className="underline decoration-hair underline-offset-4 transition-colors group-hover:decoration-stock">
          {pending ? pendingLabel : label}
        </span>
      </motion.button>

      <div className="mt-1 min-h-4 text-xs">
        <AnimatePresence mode="wait">
          {result ? (
            <motion.p
              key="result"
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={result.error ? "text-down" : "text-faint"}
            >
              {result.error ??
                result.message ??
                (result.used ? `done · ${result.used} credit${result.used === 1 ? "" : "s"} used` : "already up to date · 0 credits")}
            </motion.p>
          ) : hint ? (
            <motion.p key="hint" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-faint">
              {hint}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
