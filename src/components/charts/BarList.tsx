"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { ease } from "./kit";

export interface BarItem {
  key: string;
  label: string;
  sublabel?: string;
  value: number | null;
  display: string;
  /** Highlight this item; the others recede to gray. */
  emphasis?: boolean;
  href?: string;
}

interface Props {
  items: BarItem[];
  /** Values on both sides of zero: bars grow left/right from a zero line in pos/neg colors. */
  diverging?: boolean;
  color?: string;
}

/**
 * Horizontal bars, one per item, value at the tip. 12px thick, 4px rounded
 * data-end, square at the baseline. Emphasis grays everything but the
 * highlighted item.
 */
export function BarList({ items, diverging = false, color = "var(--c-series)" }: Props) {
  const vals = items.map((i) => i.value).filter((v): v is number => v !== null);
  const maxPos = Math.max(0, ...vals);
  const maxNeg = Math.max(0, ...vals.map((v) => -v));
  const span = diverging ? maxPos + maxNeg || 1 : maxPos || 1;
  const zero = diverging ? maxNeg / span : 0; // position of zero along the track, 0..1
  const anyEmphasis = items.some((i) => i.emphasis);

  return (
    <ul className="space-y-1">
      {items.map((it, i) => {
        const v = it.value ?? 0;
        const frac = Math.abs(v) / span;
        const neg = v < 0;
        const fill = anyEmphasis
          ? it.emphasis
            ? color
            : "var(--c-dim)"
          : diverging
            ? neg
              ? "var(--c-neg)"
              : "var(--c-pos)"
            : color;
        const label = (
          <>
            <span className={`block truncate text-sm ${it.emphasis ? "text-ink" : "text-muted"}`}>{it.label}</span>
            {it.sublabel && <span className="block truncate text-[11px] text-faint">{it.sublabel}</span>}
          </>
        );
        return (
          <motion.li
            key={it.key}
            className="group grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 rounded-md px-1 py-1.5 transition-colors hover:bg-white/[0.03] sm:grid-cols-[10rem_1fr_6.5rem]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 + i * 0.04 }}
          >
            {it.href ? (
              <Link href={it.href} className="min-w-0 hover:text-ink">
                {label}
              </Link>
            ) : (
              <span className="min-w-0">{label}</span>
            )}
            <div className="relative h-3">
              {diverging && <span className="absolute inset-y-[-4px] w-px bg-[var(--c-axis)]" style={{ left: `${zero * 100}%` }} />}
              {it.value !== null && (
                <motion.span
                  className="absolute inset-y-0 block transition-[filter] group-hover:brightness-125"
                  style={{
                    background: fill,
                    left: neg ? undefined : `${zero * 100}%`,
                    right: neg ? `${(1 - zero) * 100}%` : undefined,
                    borderRadius: neg ? "4px 0 0 4px" : "0 4px 4px 0",
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${frac * 100}%` }}
                  transition={{ delay: 0.15 + i * 0.05, duration: 0.7, ease }}
                />
              )}
            </div>
            <span className={`num text-right text-sm ${it.value === null ? "text-faint" : "text-ink"}`}>{it.display}</span>
          </motion.li>
        );
      })}
    </ul>
  );
}
