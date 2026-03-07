/**
 * Convert CSV → data.json (full rebuild from a single source)
 * v3: Multi-source support with Quelle dictionary
 *
 * Usage:
 *   node _convert.cjs                                         → Einzelhandel from default path
 *   node _convert.cjs --source=Grosshandel --file="GH.csv"   → Grosshandel from custom path
 *   node _convert.cjs --file="D:/path/to/file.csv"           → Einzelhandel from custom path
 *
 * Output format:
 * {
 *   "d": { "K": [...], "L": [...], ..., "Q": [...] },
 *   "r": [ [idx, idx, ...], ... ]
 * }
 *
 * Row layout: [Kasse, Kollektion, SubKollektion, Art, Nr, Form, FormPfad, BildId, Anzahl, EinzelPreis, Monat, KW, Datum, Quelle]
 *             [  0       1            2          3    4    5       6        7       8         9        10    11    12      13  ]
 */
const fs = require('fs');
const path = require('path');

// --- Parse CLI args ---
const args = process.argv.slice(2);
let source = 'Einzelhandel';
let srcFile = null;

for (const arg of args) {
  if (arg.startsWith('--source=')) source = arg.split('=')[1];
  else if (arg.startsWith('--file=')) srcFile = arg.split('=').slice(1).join('=');
  else if (!arg.startsWith('--')) srcFile = arg;
}

const isGrosshandel = source === 'Grosshandel';

// Default source paths
if (!srcFile) {
  srcFile = isGrosshandel
    ? 'D:/Materialien/Catalog/Grosshandel'
    : 'D:/Materialien/Catalog/SHop ab 2025';
}

const DST = path.join(__dirname, 'static', 'data.json');

console.log(`Source: ${source}`);
console.log(`File:   ${srcFile}`);
console.log(`Format: Semicolon-delimited, ISO-8859-1`);

// Read file — both formats use semicolon-delimited ISO-8859-1
const raw = fs.readFileSync(srcFile, 'latin1');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

// Skip header line for Grosshandel (first line contains column names)
const startIdx = isGrosshandel && lines.length > 0 && lines[0].includes('Datum') ? 1 : 0;

console.log(`Read ${lines.length - startIdx} data lines from source file`);

const MONAT_MAP = {
  '01': 'Jan', '02': 'Feb', '03': 'Mär', '04': 'Apr',
  '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Dez'
};

// ISO week number calculation
function getISOWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return String(1 + Math.round(((date - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)).padStart(2, '0');
}

// Dictionary builders
const dicts = {
  K: new Map(),  // Kasse / Gebiet
  L: new Map(),  // Kollektion
  S: new Map(),  // SubKollektion
  A: new Map(),  // Art
  N: new Map(),  // Nr
  F: new Map(),  // Form
  P: new Map(),  // FormPfad
  Q: new Map(),  // Quelle (Einzelhandel, Grosshandel, Webshop)
};

function dictIdx(dict, val) {
  const v = val || '';
  if (dict.has(v)) return dict.get(v);
  const idx = dict.size;
  dict.set(v, idx);
  return idx;
}

// Pre-register the source
const quelleIdx = dictIdx(dicts.Q, source);

const rows = [];
let errors = 0;

for (let i = startIdx; i < lines.length; i++) {
  const line = lines[i];
  const cols = line.split(';').map(c => c.replace(/^"|"$/g, '').trim());

  if (isGrosshandel) {
    // Grosshandel: 17 semicolon-delimited columns
    if (cols.length < 14) {
      errors++;
      if (errors <= 5) console.log(`Line ${i + 1}: only ${cols.length} cols, skipping`);
      continue;
    }

    // Datum: "2025-09-27" or "27.09.2025" — detect format
    let datum = '';
    const rawDate = cols[0].split(' ')[0];
    if (rawDate.includes('-')) {
      datum = rawDate; // already ISO format
    } else {
      const parts = rawDate.split('.');
      if (parts.length === 3) datum = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    const mm = datum ? datum.split('-')[1] : '';
    const monat = MONAT_MAP[mm] || '';
    const kw = datum ? getISOWeek(datum) : '00';

    const anzahl = parseInt(cols[12]) || 0;
    // Grosshandel uses dot-decimal (no comma replacement needed)
    const einzelPreis = (() => {
      const n = parseFloat(cols[13] || '0');
      return isNaN(n) ? 0 : Math.round(n * 100) / 100;
    })();

    const kasse = cols[1];       // Gebiet
    const formPfad = cols[2];
    const kollektion = cols[3];
    const art = cols[4];
    const subKollektion = cols[7];
    const nr = cols[8];
    const form = cols[9];
    const bildId = cols[11];

    rows.push([
      dictIdx(dicts.K, kasse),           // 0: Kasse (Gebiet for GH)
      dictIdx(dicts.L, kollektion),      // 1: Kollektion
      dictIdx(dicts.S, subKollektion),   // 2: SubKollektion
      dictIdx(dicts.A, art),             // 3: Art
      dictIdx(dicts.N, nr),              // 4: Nr
      dictIdx(dicts.F, form),            // 5: Form
      dictIdx(dicts.P, formPfad),        // 6: FormPfad
      bildId,                            // 7: BildId
      anzahl,                            // 8: Anzahl
      einzelPreis,                       // 9: EinzelPreis
      monat,                             // 10: Monat
      kw,                                // 11: KW
      datum,                             // 12: Datum
      quelleIdx,                         // 13: Quelle
    ]);
  } else {
    // Einzelhandel: semicolon-delimited, 17 columns (same layout as Grosshandel)
    // Also supports legacy 29+ column format from older exports
    if (cols.length < 14) {
      errors++;
      if (errors <= 5) console.log(`Line ${i + 1}: only ${cols.length} cols, skipping`);
      continue;
    }

    let kasse, kollektion, subKollektion, art, nr, form, formPfad, bildId, anzahl, einzelPreis, monat, kw, datum;

    if (cols.length >= 29) {
      // Legacy 29+ column format (old SHops CSV exports)
      const dateParts = cols[0].split(' ')[0].split('.');
      datum = dateParts.length === 3
        ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
        : '';
      const parseNum = (s) => { const n = parseFloat((s || '0').replace(',', '.')); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
      monat = MONAT_MAP[cols[26]] || cols[25] || '';
      kw = cols[23].padStart(2, '0');
      anzahl = parseInt(cols[11]) || 0;
      einzelPreis = parseNum(cols[12]);
      kasse = cols[1]; kollektion = cols[3]; subKollektion = cols[5];
      art = cols[6]; nr = cols[7]; form = cols[8]; formPfad = cols[2];
      bildId = cols[10];
    } else {
      // New 17 column format (same as Grosshandel)
      // Col layout: Datum;Kasse;FormPfad;Kollektion;Art;Gruppe;KollId;SubKoll;Nr;Form;PG;BildId;Anzahl;Preis;...
      const rawDate = cols[0].split(' ')[0];
      if (rawDate.includes('-')) {
        datum = rawDate;
      } else {
        const parts = rawDate.split('.');
        datum = parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : '';
      }
      const mm = datum ? datum.split('-')[1] : '';
      monat = MONAT_MAP[mm] || '';
      kw = datum ? getISOWeek(datum) : '00';
      anzahl = parseInt(cols[12]) || 0;
      einzelPreis = (() => { const n = parseFloat(cols[13] || '0'); return isNaN(n) ? 0 : Math.round(n * 100) / 100; })();
      kasse = cols[1]; formPfad = cols[2]; kollektion = cols[3];
      art = cols[4]; subKollektion = cols[7]; nr = cols[8];
      form = cols[9]; bildId = cols[11];
    }

    rows.push([
      dictIdx(dicts.K, kasse),           // 0: Kasse
      dictIdx(dicts.L, kollektion),      // 1: Kollektion
      dictIdx(dicts.S, subKollektion),   // 2: SubKollektion
      dictIdx(dicts.A, art),             // 3: Art
      dictIdx(dicts.N, nr),              // 4: Nr
      dictIdx(dicts.F, form),            // 5: Form
      dictIdx(dicts.P, formPfad),        // 6: FormPfad
      bildId,                            // 7: BildId
      anzahl,                            // 8: Anzahl
      einzelPreis,                       // 9: EinzelPreis
      monat,                             // 10: Monat
      kw,                                // 11: KW
      datum,                             // 12: Datum
      quelleIdx,                         // 13: Quelle
    ]);
  }
}

console.log(`Converted ${rows.length} records (${errors} errors)`);

// Build output dictionaries (Map → Array)
const dictArrays = {};
for (const [key, map] of Object.entries(dicts)) {
  const arr = new Array(map.size);
  for (const [val, idx] of map) arr[idx] = val;
  dictArrays[key] = arr;
  console.log(`Dict ${key}: ${arr.length} entries`);
}

// Verify sample
if (rows.length > 0) {
  const sample = rows[0];
  console.log('Sample row:', JSON.stringify(sample));
  console.log('Decoded:', {
    Kasse: dictArrays.K[sample[0]],
    Kollektion: dictArrays.L[sample[1]],
    Art: dictArrays.A[sample[3]],
    Datum: sample[12],
    Quelle: dictArrays.Q[sample[13]],
  });
}

// Stats
const years = [...new Set(rows.map(r => r[12].slice(0, 4)))];
console.log('Years:', years.sort());
console.log('Kassen:', dictArrays.K.slice().sort());

// Write output — merge with existing if different source
let output;
if (fs.existsSync(DST)) {
  const existing = JSON.parse(fs.readFileSync(DST, 'utf-8'));
  const existingHasQ = existing.d.Q && existing.d.Q.length > 0;

  if (existingHasQ) {
    // Check if existing data has rows from OTHER sources we should keep
    const existingQIdx = existing.d.Q.indexOf(source);
    const otherRows = existingQIdx >= 0
      ? existing.r.filter(r => r[13] !== existingQIdx)
      : existing.r;

    if (otherRows.length > 0) {
      console.log(`\nMerging: keeping ${otherRows.length} rows from other sources`);
      // Rebuild with merged dictionaries
      const mergedDicts = {
        K: new Map(), L: new Map(), S: new Map(), A: new Map(),
        N: new Map(), F: new Map(), P: new Map(), Q: new Map(),
      };

      // Populate from existing dictionaries
      for (const key of Object.keys(mergedDicts)) {
        if (existing.d[key]) {
          for (let j = 0; j < existing.d[key].length; j++) {
            mergedDicts[key].set(existing.d[key][j], j);
          }
        }
      }

      // Ensure new source dict entries exist
      for (const key of Object.keys(dicts)) {
        for (const [val] of dicts[key]) {
          if (!mergedDicts[key].has(val)) {
            mergedDicts[key].set(val, mergedDicts[key].size);
          }
        }
      }

      // Re-encode new rows with merged dict indices
      const reEncodedRows = rows.map(r => [
        mergedDicts.K.get(dictArrays.K[r[0]]),
        mergedDicts.L.get(dictArrays.L[r[1]]),
        mergedDicts.S.get(dictArrays.S[r[2]]),
        mergedDicts.A.get(dictArrays.A[r[3]]),
        mergedDicts.N.get(dictArrays.N[r[4]]),
        mergedDicts.F.get(dictArrays.F[r[5]]),
        mergedDicts.P.get(dictArrays.P[r[6]]),
        r[7], r[8], r[9], r[10], r[11], r[12],
        mergedDicts.Q.get(dictArrays.Q[r[13]]),
      ]);

      const allRows = [...otherRows, ...reEncodedRows];
      allRows.sort((a, b) => a[12] < b[12] ? -1 : a[12] > b[12] ? 1 : 0);

      const mergedDictArrays = {};
      for (const [key, map] of Object.entries(mergedDicts)) {
        const arr = new Array(map.size);
        for (const [val, idx] of map) arr[idx] = val;
        mergedDictArrays[key] = arr;
      }

      output = { d: mergedDictArrays, r: allRows };
      console.log(`Total rows after merge: ${allRows.length}`);
    } else {
      output = { d: dictArrays, r: rows };
    }
  } else {
    // Existing data has no Q dict — add Q to existing rows as Einzelhandel, then merge
    if (source !== 'Einzelhandel') {
      console.log(`\nUpgrading existing data.json: tagging ${existing.r.length} rows as Einzelhandel`);
      const mergedDicts = { ...existing.d };
      mergedDicts.Q = ['Einzelhandel', source];
      const ehIdx = 0;
      const newSrcIdx = 1;

      // Tag existing rows with Einzelhandel
      for (const r of existing.r) r.push(ehIdx);

      // Re-encode new rows
      const mergedK = new Map(); for (let j = 0; j < (mergedDicts.K || []).length; j++) mergedK.set(mergedDicts.K[j], j);
      const mergedL = new Map(); for (let j = 0; j < (mergedDicts.L || []).length; j++) mergedL.set(mergedDicts.L[j], j);
      const mergedS = new Map(); for (let j = 0; j < (mergedDicts.S || []).length; j++) mergedS.set(mergedDicts.S[j], j);
      const mergedA = new Map(); for (let j = 0; j < (mergedDicts.A || []).length; j++) mergedA.set(mergedDicts.A[j], j);
      const mergedN = new Map(); for (let j = 0; j < (mergedDicts.N || []).length; j++) mergedN.set(mergedDicts.N[j], j);
      const mergedF = new Map(); for (let j = 0; j < (mergedDicts.F || []).length; j++) mergedF.set(mergedDicts.F[j], j);
      const mergedP = new Map(); for (let j = 0; j < (mergedDicts.P || []).length; j++) mergedP.set(mergedDicts.P[j], j);

      const allMaps = { K: mergedK, L: mergedL, S: mergedS, A: mergedA, N: mergedN, F: mergedF, P: mergedP };
      for (const key of Object.keys(allMaps)) {
        for (const [val] of dicts[key]) {
          if (!allMaps[key].has(val)) {
            allMaps[key].set(val, allMaps[key].size);
          }
        }
      }

      const reEncodedRows = rows.map(r => [
        allMaps.K.has(dictArrays.K[r[0]]) ? allMaps.K.get(dictArrays.K[r[0]]) : r[0],
        allMaps.L.has(dictArrays.L[r[1]]) ? allMaps.L.get(dictArrays.L[r[1]]) : r[1],
        allMaps.S.has(dictArrays.S[r[2]]) ? allMaps.S.get(dictArrays.S[r[2]]) : r[2],
        allMaps.A.has(dictArrays.A[r[3]]) ? allMaps.A.get(dictArrays.A[r[3]]) : r[3],
        allMaps.N.has(dictArrays.N[r[4]]) ? allMaps.N.get(dictArrays.N[r[4]]) : r[4],
        allMaps.F.has(dictArrays.F[r[5]]) ? allMaps.F.get(dictArrays.F[r[5]]) : r[5],
        allMaps.P.has(dictArrays.P[r[6]]) ? allMaps.P.get(dictArrays.P[r[6]]) : r[6],
        r[7], r[8], r[9], r[10], r[11], r[12],
        newSrcIdx,
      ]);

      // Rebuild dict arrays
      for (const [key, map] of Object.entries(allMaps)) {
        const arr = new Array(map.size);
        for (const [val, idx] of map) arr[idx] = val;
        mergedDicts[key] = arr;
      }

      const allRows = [...existing.r, ...reEncodedRows];
      allRows.sort((a, b) => a[12] < b[12] ? -1 : a[12] > b[12] ? 1 : 0);

      output = { d: mergedDicts, r: allRows };
      console.log(`Total rows after merge: ${allRows.length}`);
    } else {
      output = { d: dictArrays, r: rows };
    }
  }
} else {
  output = { d: dictArrays, r: rows };
}

const json = JSON.stringify(output);
fs.writeFileSync(DST, json);
const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(2);
console.log(`\nWritten to ${DST} (${sizeMB} MB, ${output.r.length} records)`);

// Compression estimate
const zlib = require('zlib');
const gzSize = (zlib.gzipSync(json).length / 1024 / 1024).toFixed(2);
const brSize = (zlib.brotliCompressSync(json).length / 1024 / 1024).toFixed(2);
console.log(`  Raw: ${sizeMB} MB`);
console.log(`  Gzip: ${gzSize} MB`);
console.log(`  Brotli: ${brSize} MB`);

// Source stats
if (output.d.Q) {
  console.log(`\nSources (Q): ${output.d.Q.join(', ')}`);
  for (let qi = 0; qi < output.d.Q.length; qi++) {
    const count = output.r.filter(r => r[13] === qi).length;
    console.log(`  ${output.d.Q[qi]}: ${count} rows`);
  }
}
