// ─── Types ───
export interface RawRow {
  Kasse: string; Kollektion: string; SubKollektion: string; Art: string;
  Nr: string; Form: string; Preisgruppe: string; BildId: string;
  Anzahl: number; EinzelPreis: number; GesamtPreis: number; Umsatz: number;
  PreisOberGruppe: string; Monat: string; Wochentag: string; KW: string; TRLUXREST: string;
}

export interface KasseStat { kasse: string; anzahl: number; }

export interface ArticleNode {
  bildId: string; umsatz: number; anzahl: number;
  kassenStats: KasseStat[];
}

export interface GroupNode {
  name: string; thumbBildId: string; umsatz: number; anzahl: number;
  avgPreis: number; anteil: number;
  articles: ArticleNode[];
  subGroups?: GroupNode[];
  // Comparison values (from previous period)
  cmpUmsatz?: number; cmpAnzahl?: number; cmpAvgPreis?: number;
}

export interface TimeFilter {
  jahr: string;   // 'alle' or '2026' etc
  monat: string;  // 'alle' or 'Jan','Feb',...
  kw: string;     // 'alle' or '01','02',...
}

export type CompareMode = 'none' | 'vorperiode' | 'vorjahr';

// ─── Constants ───
export const MONAT_ORDER: Record<string, number> = {
  Jan: 1, Feb: 2, Mär: 3, Mar: 3, Apr: 4, Mai: 5, May: 5,
  Jun: 6, Jul: 7, Aug: 8, Sep: 9, Okt: 10, Oct: 10, Nov: 11, Dez: 12, Dec: 12
};
const MONAT_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

const PREIS_RANGES: [string, number, number][] = [
  ['0–20 €', 0, 20], ['20–50 €', 20, 50], ['50–120 €', 50, 120],
  ['120–250 €', 120, 250], ['über 250 €', 250, Infinity],
];

// ─── Helpers ───
export function getFormPfad(form: string): string {
  return (form || '').trim().split(/\s+/)[0] || '(leer)';
}

export function getPreisgruppe(ep: number): string {
  for (const [label, lo, hi] of PREIS_RANGES) { if (ep >= lo && ep < hi) return label; }
  return 'über 250 €';
}

export function getFieldValue(r: RawRow, field: string): string {
  switch (field) {
    case 'Kollektion': return r.Kollektion || '(leer)';
    case 'FormPfad': return getFormPfad(r.Form);
    case 'Kasse': return r.Kasse || '(leer)';
    case 'SubKollektion': return r.SubKollektion || '(leer)';
    case 'Form': return r.Form || '(leer)';
    case 'Preisgruppe': return getPreisgruppe(Number(r.EinzelPreis) || 0);
    case 'Art': return r.Art || '(leer)';
    default: return (r as any)[field] || '(leer)';
  }
}

// ─── Filtering ───
export function filterData(data: RawRow[], tf: TimeFilter): RawRow[] {
  return data.filter(r => {
    if (tf.jahr !== 'alle') {
      // All data is 2026, so if jahr != '2026', return nothing
      // For future: check a year field
    }
    if (tf.monat !== 'alle' && r.Monat !== tf.monat) return false;
    if (tf.kw !== 'alle' && r.KW !== tf.kw) return false;
    return true;
  });
}

export function getComparisonFilter(tf: TimeFilter, mode: CompareMode): TimeFilter | null {
  if (mode === 'none') return null;

  if (mode === 'vorjahr') {
    // Same period, previous year — since we only have 2026, return filter for 2025
    return { ...tf, jahr: '2025' };
  }

  // vorperiode
  if (tf.kw !== 'alle') {
    const kwNum = parseInt(tf.kw);
    if (kwNum <= 1) return null;
    return { ...tf, kw: String(kwNum - 1).padStart(2, '0') };
  }
  if (tf.monat !== 'alle') {
    const mIdx = MONAT_ORDER[tf.monat];
    if (!mIdx || mIdx <= 1) return null;
    const prevMonat = MONAT_NAMES[mIdx - 2]; // -2 because array is 0-indexed
    return { ...tf, monat: prevMonat };
  }
  return null; // Can't compare 'alle'
}

export function getAvailableMonths(data: RawRow[]): string[] {
  const set = new Set(data.map(r => r.Monat));
  return MONAT_NAMES.filter(m => set.has(m));
}

export function getAvailableKWs(data: RawRow[]): string[] {
  const set = new Set(data.map(r => r.KW));
  return Array.from(set).sort();
}

// ─── Aggregation ───
function buildArticles(rows: RawRow[]): ArticleNode[] {
  const m = new Map<string, { umsatz: number; anzahl: number; kassen: Map<string, number> }>();
  for (const r of rows) {
    const bid = String(r.BildId);
    if (!bid || bid === '0') continue;
    if (!m.has(bid)) m.set(bid, { umsatz: 0, anzahl: 0, kassen: new Map() });
    const a = m.get(bid)!;
    const an = Number(r.Anzahl) || 0;
    a.umsatz += (Number(r.EinzelPreis) || 0) * an;
    a.anzahl += an;
    a.kassen.set(r.Kasse, (a.kassen.get(r.Kasse) || 0) + an);
  }
  return Array.from(m.entries()).map(([bildId, a]) => ({
    bildId, umsatz: a.umsatz, anzahl: a.anzahl,
    kassenStats: Array.from(a.kassen.entries()).map(([kasse, anzahl]) => ({ kasse, anzahl })).sort((x, y) => y.anzahl - x.anzahl),
  })).sort((a, b) => b.umsatz - a.umsatz);
}

export function buildGroup(name: string, rows: RawRow[], total: number, subGroupFields?: string[]): GroupNode {
  let umsatz = 0, anzahl = 0;
  for (const r of rows) { const an = Number(r.Anzahl) || 0; umsatz += (Number(r.EinzelPreis) || 0) * an; anzahl += an; }
  const articles = buildArticles(rows);
  const node: GroupNode = {
    name, thumbBildId: articles[0]?.bildId || '',
    umsatz, anzahl, avgPreis: anzahl > 0 ? umsatz / anzahl : 0,
    anteil: total > 0 ? (umsatz / total) * 100 : 0, articles,
  };
  if (subGroupFields && subGroupFields.length > 0) {
    const field = subGroupFields[0];
    const rest = subGroupFields.slice(1);
    const subMap = new Map<string, RawRow[]>();
    for (const r of rows) { const k = getFieldValue(r, field); if (!subMap.has(k)) subMap.set(k, []); subMap.get(k)!.push(r); }
    node.subGroups = Array.from(subMap.entries())
      .map(([sn, sr]) => buildGroup(sn, sr, total, rest.length > 0 ? rest : undefined))
      .sort((a, b) => b.umsatz - a.umsatz);
  }
  return node;
}

export function buildGroupedData(data: RawRow[], field: string, subFields?: string[]): GroupNode[] {
  const total = data.reduce((s, r) => s + (Number(r.EinzelPreis) || 0) * (Number(r.Anzahl) || 0), 0);
  const buckets = new Map<string, RawRow[]>();
  for (const r of data) {
    const k = getFieldValue(r, field);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(r);
  }
  return Array.from(buckets.entries()).map(([n, rows]) => buildGroup(n, rows, total, subFields));
}

// ─── Comparison Merge ───
export function mergeComparison(main: GroupNode[], cmp: GroupNode[]): GroupNode[] {
  const cmpMap = new Map<string, GroupNode>();
  for (const c of cmp) cmpMap.set(c.name, c);

  return main.map(g => ({
    ...g,
    cmpUmsatz: cmpMap.get(g.name)?.umsatz,
    cmpAnzahl: cmpMap.get(g.name)?.anzahl,
    cmpAvgPreis: cmpMap.get(g.name)?.avgPreis,
  }));
}

// ─── Format ───
export function fmtEUR(v: number) { return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); }
export function fmtNum(v: number) { return v.toLocaleString('de-DE', { maximumFractionDigits: 0 }); }
export function fmtPct(v: number) { return v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' %'; }
export function fmtDelta(curr: number, prev: number | undefined): string {
  if (prev == null || prev === 0) return '';
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `(${sign}${pct.toFixed(1)}%)`;
}

export function imgUrl(bid: string | number, size = 200): string {
  const id = typeof bid === 'number' ? Math.round(bid) : bid;
  return `https://konplott-cdn.com/mytism/image/${id}/${id}.jpg?width=${size}&height=${size}&box=true`;
}
