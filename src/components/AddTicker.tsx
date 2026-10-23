"use client";

import { AnimatePresence, motion } from "motion/react";
import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { addTicker, type AddState } from "@/app/actions";

const SUGGESTIONS = ["BBCA", "BBRI", "TLKM", "ASII", "ADRO", "GOTO"];

export function AddTicker({ existing }: { existing: string[] }) {
  const [state, action, pending] = useActionState<AddState, FormData>(addTicker, {});
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.added) setValue("");
  }, [state]);

  const suggestions = SUGGESTIONS.filter((s) => !existing.includes(s)).slice(0, 4);

  return (
    <div>
      <form ref={formRef} action={action} className="group relative flex items-end gap-4">
        <label className="relative flex-1">
          <span className="sr-only">Add a ticker</span>
          <input
            name="ticker"
            value={value}
            onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, 4))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Add a ticker"
            autoComplete="off"
            spellCheck={false}
            className="display w-full bg-transparent pb-2 text-4xl tracking-wide text-ink outline-none placeholder:text-faint sm:text-5xl"
          />
          <span className="absolute inset-x-0 bottom-0 h-px bg-hair" />
          <motion.span
            className="absolute inset-x-0 bottom-0 h-px origin-left"
            style={{ background: "linear-gradient(90deg, var(--stock), var(--sector), var(--market))" }}
            animate={{ scaleX: focused || value ? 1 : 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          />
        </label>
        <motion.button
          type="submit"
          disabled={pending || value.length !== 4}
          className="eyebrow pb-3 text-ink disabled:text-faint"
          whileHover={{ x: 4 }}
          whileTap={{ scale: 0.95 }}
        >
          {pending ? "fetching…" : "watch →"}
        </motion.button>
      </form>

      <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <AnimatePresence mode="wait">
          {state.error ? (
            <motion.p
              key="err"
              className="text-down"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {state.error}
            </motion.p>
          ) : (
            <motion.div key="sugg" className="flex flex-wrap gap-x-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              {suggestions.length > 0 && <span className="text-faint">try</span>}
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    flushSync(() => setValue(s));
                    formRef.current?.requestSubmit();
                  }}
                  className="num text-muted underline decoration-hair underline-offset-4 transition-colors hover:text-ink hover:decoration-stock"
                >
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
