export const pct = (x: number, digits = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)}%`;

export const share = (x: number) => `${Math.round(x * 100)}%`;

export const price = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-16" → "16 Oct" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

export const sigma = (z: number) => `${z >= 0 ? "+" : "−"}${Math.abs(z).toFixed(1)}σ`;

export const dirColor = (x: number) => (x >= 0 ? "var(--up)" : "var(--down)");
