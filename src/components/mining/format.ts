export const usdT = (x: number) => `$${x.toFixed(1)}/t`;

export const mt = (x: number) => `${x.toLocaleString("en-US", { maximumFractionDigits: 1 })} Mt`;

export const idrPerTon = (x: number) => `IDR ${Math.round(x).toLocaleString("en-US")}/t`;

export const years = (x: number) => `${x < 10 ? x.toFixed(1) : Math.round(x)} yr`;

export const ha = (x: number) => `${Math.round(x).toLocaleString("en-US")} ha`;

export const pctShare = (x: number) => `${Math.round(x * 100)}%`;
