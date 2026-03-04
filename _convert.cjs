/**
 * Convert "SHop ab 2025" CSV (semicolon-delimited, ISO-8859) → data.json
 * v2: Dictionary-encoded compact format for performance
 *
 * Output format:
 * {
 *   "d": { "K": [...], "L": [...], ... },   // dictionaries for string fields
 *   "r": [ [idx, idx, ...], ... ]             // rows as arrays with dict indices
 * }
 *
 * Row layout: [Kasse, Kollektion, SubKollektion, Art, Nr, Form, FormPfad, BildId, Anzahl, EinzelPreis, Monat, KW, Datum]
 *             [  0       1            2          3    4    5       6        7       8         9        10    11    12  ]
 */
const fs = require('fs');
const path = require('path');

const SRC = 'D:/Materialien/Catalog/SHop ab 2025';
const DST = path.join(__dirname, 'static', 'data.json');

// Read file as latin1 (ISO-8859-1)
const raw = fs.readFileSync(SRC, 'latin1');
const lines = raw.split(/\r?\n/).filter(l => l.trim());

console.log(`Read ${lines.length} lines from source file`);

const MONAT_MAP = {
  '01': 'Jan', '02': 'Feb', '03': 'Mär', '04': 'Apr',
  '05': 'Mai', '06': 'Jun', '07': 'Jul', '08': 'Aug',
  '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Dez'
};

// Dictionary builders
const dicts = {
  K: new Map(),  // Kasse
  L: new Map(),  // Kollektion
  S: new Map(),  // SubKollektion
  A: new Map(),  // Art
  N: new Map(),  // Nr
  F: new Map(),  // Form
  P: new Map(),  // FormPfad
};

function dictIdx(dict, val) {
  const v = val || '';
  if (dict.has(v)) return dict.get(v);
  const idx = dict.size;
  dict.set(v, idx);
  return idx;
}

const rows = [];
let errors = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const cols = line.split(';').map(c => c.replace(/^"|"$/g, '').trim());

  if (cols.length < 29) {
    errors++;
    if (errors <= 5) console.log(`Line ${i + 1}: only ${cols.length} cols, skipping`);
    continue;
  }

  // Parse date from col[0]: "27.09.2025 10:17:07" → "2025-09-27"
  const dateParts = cols[0].split(' ')[0].split('.');
  const datum = dateParts.length === 3
    ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
    : '';

  const parseNum = (s) => {
    const n = parseFloat((s || '0').replace(',', '.'));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  };

  const monat = MONAT_MAP[cols[26]] || cols[25] || '';
  const kw = cols[23].padStart(2, '0');
  const anzahl = parseInt(cols[11]) || 0;
  const einzelPreis = parseNum(cols[12]);

  // Row: [Kasse, Kollektion, SubKollektion, Art, Nr, Form, FormPfad, BildId, Anzahl, EinzelPreis, Monat, KW, Datum]
  rows.push([
    dictIdx(dicts.K, cols[1]),         // 0: Kasse
    dictIdx(dicts.L, cols[3]),         // 1: Kollektion
    dictIdx(dicts.S, cols[5]),         // 2: SubKollektion
    dictIdx(dicts.A, cols[6]),         // 3: Art
    dictIdx(dicts.N, cols[7]),         // 4: Nr
    dictIdx(dicts.F, cols[8]),         // 5: Form
    dictIdx(dicts.P, cols[2]),         // 6: FormPfad
    cols[10],                          // 7: BildId (string, unique per article)
    anzahl,                            // 8: Anzahl
    einzelPreis,                       // 9: EinzelPreis
    monat,                             // 10: Monat (only 12 values, not worth dict)
    kw,                                // 11: KW (only ~52 values)
    datum,                             // 12: Datum
  ]);
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
const sample = rows[0];
console.log('Sample row:', JSON.stringify(sample));
console.log('Decoded:', {
  Kasse: dictArrays.K[sample[0]],
  Kollektion: dictArrays.L[sample[1]],
  Art: dictArrays.A[sample[3]],
  Datum: sample[12],
});

// Stats
const years = [...new Set(rows.map(r => r[12].slice(0, 4)))];
console.log('Years:', years.sort());
console.log('Kassen:', dictArrays.K.sort ? dictArrays.K.slice().sort() : dictArrays.K);

// Write output
const output = { d: dictArrays, r: rows };
const json = JSON.stringify(output);
fs.writeFileSync(DST, json);
const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(2);
console.log(`\nWritten to ${DST} (${sizeMB} MB, ${rows.length} records)`);

// Compare with old size
console.log(`\nCompression estimate:`);
const zlib = require('zlib');
const gzSize = (zlib.gzipSync(json).length / 1024 / 1024).toFixed(2);
const brSize = (zlib.brotliCompressSync(json).length / 1024 / 1024).toFixed(2);
console.log(`  Raw: ${sizeMB} MB`);
console.log(`  Gzip: ${gzSize} MB`);
console.log(`  Brotli: ${brSize} MB`);
