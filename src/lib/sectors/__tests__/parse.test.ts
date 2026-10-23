import { describe, expect, it } from "vitest";
import { chunkRange } from "..";
import { parseDaily, parseDividendEvents, parseIndexDaily, parsePeers } from "../parse";

// Payloads mirror the shapes in the Sectors v2 docs.

describe("sectors parsers", () => {
  it("sorts daily rows ascending and fills missing OHLC with close", () => {
    const bars = parseDaily([
      { symbol: "BBCA.JK", date: "2026-10-22", close: 5175, open: 5125, high: 5275, low: 5100, volume: 10, market_cap: 1 },
      { symbol: "BBCA.JK", date: "2026-10-21", close: 5100, open: null, high: null, low: null, volume: 5, market_cap: 1 },
    ]);
    expect(bars.map((b) => b.date)).toEqual(["2026-10-21", "2026-10-22"]);
    expect(bars[0]).toMatchObject({ open: 5100, high: 5100, low: 5100, close: 5100 });
  });

  it("maps index levels to flat bars", () => {
    const bars = parseIndexDaily([{ index_code: "IHSG", date: "2026-10-22", price: 5387.9 }]);
    expect(bars[0]).toEqual({ date: "2026-10-22", open: 5387.9, high: 5387.9, low: 5387.9, close: 5387.9, volume: 0 });
  });

  it("keeps same-subsector peers and drops the company itself", () => {
    const { subSector, peers } = parsePeers({
      symbol: "BBCA.JK",
      peers: [{
        peers_data: {
          companies: [
            { symbol: "BBCA.JK", group: ["self"] },
            { symbol: "BBRI.JK", group: ["sub_sector", "sector"] },
            { symbol: "ASII.JK", group: ["sector"] },
          ],
          group_name: { sub_sector: "Banks" },
        },
      }],
    });
    expect(subSector).toBe("Banks");
    expect(peers).toEqual(["BBRI"]);
  });

  it("maps dividends to ex-dividend events", () => {
    const events = parseDividendEvents({
      symbol: "BBCA.JK",
      corporate_actions: { dividend: [{ ex_date: "2026-08-31", dividend_amount: 25, dividend_yield: null }] },
    });
    expect(events).toEqual([{ type: "ex_dividend", date: "2026-08-31", dividendPerShare: 25 }]);
  });

  it("handles a null dividend list", () => {
    expect(parseDividendEvents({ symbol: "X.JK", corporate_actions: { dividend: null } })).toEqual([]);
  });
});

describe("chunkRange", () => {
  it("splits long ranges into ≤90-day chunks", () => {
    const chunks = chunkRange("2026-01-01", "2026-07-01");
    expect(chunks[0]).toEqual(["2026-01-01", "2026-03-31"]);
    expect(chunks.at(-1)![1]).toBe("2026-07-01");
    for (const [a, b] of chunks) expect((Date.parse(b) - Date.parse(a)) / 86_400_000).toBeLessThan(90);
  });

  it("returns one chunk for a short range", () => {
    expect(chunkRange("2026-10-01", "2026-10-05")).toEqual([["2026-10-01", "2026-10-05"]]);
  });
});
