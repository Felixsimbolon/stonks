"use client";

import { motion } from "motion/react";
import type { Credits } from "@/lib/views";

export function CreditMeter({ used, limit }: Credits) {
  const frac = Math.min(1, used / limit);
  return (
    <div className="w-44" title="Billed Sectors API calls. Cached data is free.">
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">credits</span>
        <span className="num text-xs text-muted">
          {used}
          <span className="text-faint"> / {limit}</span>
        </span>
      </div>
      <div className="mt-2 h-px w-full bg-hair">
        <motion.div
          className="h-px origin-left"
          style={{ background: "linear-gradient(90deg, var(--stock), var(--sector))" }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: frac }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}
