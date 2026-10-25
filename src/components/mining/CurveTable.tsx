"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { CurveRow } from "@/lib/mining/service";
import { idrPerTon, mt, usdT, years } from "./format";

const ease = [0.22, 1, 0.36, 1] as const;
const dash = <span className="text-faint">—</span>;

export function CurveTable({ rows }: { rows: CurveRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (!!a.excluded !== !!b.excluded) return a.excluded ? 1 : -1;
    return (a.economics?.costPerTon ?? Infinity) - (b.economics?.costPerTon ?? Infinity);
  });

  return (
    <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <thead>
          <tr className="eyebrow">
            <th className="pb-4 font-normal">company</th>
            <th className="pb-4 text-right font-normal">sold</th>
            <th className="pb-4 text-right font-normal">cost / t</th>
            <th className="pb-4 text-right font-normal">sells at / t</th>
            <th className="pb-4 text-right font-normal">reserves</th>
            <th className="pb-4 text-right font-normal">reserve life</th>
            <th className="pb-4 text-right font-normal">strip ratio</th>
            <th className="pb-4 text-right font-normal">market cap / t reserves</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <motion.tr
              key={r.slug}
              className="border-t border-hair align-top"
              initial={{ opacity: 0 }}
              animate={{ opacity: r.excluded ? 0.6 : 1 }}
              transition={{ delay: 0.1 + i * 0.04, duration: 0.4, ease }}
            >
              <td className="py-4 pr-4">
                <Link href={`/${r.symbol}`} className="display text-2xl transition-colors hover:text-stock">
                  {r.symbol}
                </Link>
                <span className="block text-xs text-faint">
                  {r.name}
                  {r.year ? ` · ${r.year}` : ""}
                </span>
                {r.excluded && <span className="mt-1 block max-w-xs text-xs leading-relaxed text-muted">Off the curve: {r.excluded}</span>}
              </td>
              <td className="num py-4 text-right">{r.salesMt !== null ? mt(r.salesMt) : dash}</td>
              <td className="num py-4 text-right">{r.economics ? usdT(r.economics.costPerTon) : dash}</td>
              <td className="num py-4 text-right">{r.economics ? usdT(r.economics.aspPerTon) : dash}</td>
              <td className="num py-4 text-right">{r.reservesMt !== null ? mt(r.reservesMt) : dash}</td>
              <td className="num py-4 text-right">{r.reserveLifeYears !== null ? years(r.reserveLifeYears) : dash}</td>
              <td className="num py-4 text-right">{r.stripRatio !== null ? r.stripRatio.toFixed(2) : dash}</td>
              <td className="num py-4 text-right">{r.capPerTonIdr !== null ? idrPerTon(r.capPerTonIdr) : dash}</td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
