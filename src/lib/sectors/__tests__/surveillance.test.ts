import { describe, expect, it } from "vitest";
import { parseAffiliates, parseBrokerSummary, parseScreenerSymbols, parseSuspensions } from "../surveillance";

// Payloads mirror the Sectors v2 docs examples.

describe("surveillance parsers", () => {
  it("maps broker summary rows and sorts days", () => {
    const days = parseBrokerSummary({
      symbol: "BBCA.JK",
      data: [
        { date: "2025-05-05", summary: [{ broker_code: "MG", bval: 10, sval: 4, nval: 6 }] },
        { date: "2025-05-02", summary: [{ broker_code: "AF", bval: 48950000, sval: 44875000, nval: null }] },
      ],
    });
    expect(days.map((d) => d.date)).toEqual(["2025-05-02", "2025-05-05"]);
    expect(days[0].rows[0]).toEqual({ broker: "AF", buyValue: 48950000, sellValue: 44875000, netValue: 4075000 });
  });

  it("maps suspensions", () => {
    expect(
      parseSuspensions({
        results: [
          {
            symbol: "FLMC.JK",
            suspension_date: "2026-07-03",
            reason: " Terjadinya penurunan harga kumulatif yang signifikan ",
            pdf_url: "https://www.idx.co.id/x.pdf",
          },
        ],
      }),
    ).toEqual([{ date: "2026-07-03", reason: "Terjadinya penurunan harga kumulatif yang signifikan", url: "https://www.idx.co.id/x.pdf" }]);
  });

  it("dedupes affiliates and tolerates a missing overview", () => {
    expect(parseAffiliates({ overview: { affiliates: ["Djarum", "Hartono", "Djarum", " "] } })).toEqual(["Djarum", "Hartono"]);
    expect(parseAffiliates({})).toEqual([]);
  });

  it("strips .JK from screener symbols", () => {
    expect(parseScreenerSymbols({ results: [{ symbol: "BBCA.JK" }, { symbol: "TOWR.JK" }] })).toEqual(["BBCA", "TOWR"]);
  });
});
