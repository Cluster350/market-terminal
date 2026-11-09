// Kryptoübersicht (CRYP): Coins mit Entwicklung, Schwankung, Marktanteil und Vergleich mit Aktien und Gold.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IS_STATIC, qs, request } from "./api";

export interface CryptoRow {
  ticker: string;
  name: string;
  symbol: string;
  last: number | null;
  chg1d: number | null;
  chg24h: number | null;
  high24h: number | null;
  low24h: number | null;
  chg7d: number | null;
  chg30d: number | null;
  chgYtd: number | null;
  chg1y: number | null;
  vol30d: number | null;
  fromHigh: number | null;
  highDate: string | null;
  corrBtc: number | null;
  above200d: boolean | null;
  marketCap: number | null;
  share: number | null;
  supply: number | null;
  maxSupply: number | null;
  first: string | null;
  spark: number[];
  asOf: string | null;
}

export interface Line {
  key: string;
  label: string;
  t: string[];
  v: number[];
}

export interface CryptoOverview {
  ccy: "usd" | "eur";
  rows: CryptoRow[];
  totalCap: number | null;
  btcShare: number | null;
  ethShare: number | null;
  shareBasis: "market" | "shown";
  breadthUp: number;
  breadthN: number;
  cross: Line[];
  corr: Line[];
  notes: string[];
  skipped: string[];
}

export const useCrypto = (ccy: "usd" | "eur") =>
  useQuery({
    queryKey: ["crypto", ccy],
    queryFn: () => request<CryptoOverview>(`/crypto${qs({ ccy })}`, undefined, { timeoutMs: 60_000 }),
    enabled: !IS_STATIC,
    staleTime: 30_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });

/** Linie ab ``from`` auf 100 normiert (erster Wert am oder nach dem Stichtag). */
export function normalized(line: { t: string[]; v: (number | null)[] }, from: string): [string, number][] {
  const out: [string, number][] = [];
  let base: number | null = null;
  line.t.forEach((t, i) => {
    const v = line.v[i];
    if (t < from || v === null || v === undefined || !(v > 0)) return;
    if (base === null) base = v;
    out.push([t, (v / base) * 100]);
  });
  return out;
}

/** Stichtag „vor n Monaten“ relativ zum letzten Datum (ISO). */
export function monthsBack(last: string, months: number): string {
  const [y, m, d] = last.slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = total - ty * 12; // 0–11
  const days = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate(); // Monatsende begrenzt (31.03. − 1 M = 28.02.)
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(Math.min(d, days)).padStart(2, "0")}`;
}
