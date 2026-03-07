/**
 * Import CSV → merge into existing data.json
 * v2: Multi-source support (Einzelhandel, Grosshandel, Webshop)
 *
 * Usage:
 *   node _import.cjs                                              → Einzelhandel from default path
 *   node _import.cjs --source=Grosshandel --file="D:/path/GH.csv" → Grosshandel
 *   node _import.cjs "D:/path/to/file.csv"                       → Einzelhandel from custom path
 *   node _import.cjs --all                                       → skip prompt, import ALL rows
 *   node _import.cjs --new                                       → skip prompt, import only NEW dates
 *
 * Interactive prompt: "Nur neue Zeiträume einlesen?" (default: Ja)
 *   Ja  → only imports rows for dates NOT already in data.json (for same source)
 *   Nein → imports ALL rows (may create duplicates for existing dates!)
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');

// --- Config ---
const DEFAULT_SRC_EH = 'D:/Materialien/Catalog/SHop ab 2025';
const DEFAULT_SRC_GH = 'D:/Materialien/Catalog/Grosshandel';
const DST = path.join(__dirname, 'static', 'data.json');

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

// --- Parse CLI args ---
const args = process.argv.slice(2);
let source = 'Einzelhandel';
let srcFile = null;
let forceMode = null; // null = ask, 'new' = only new, 'all' = all

for (const arg of args) {
  if (arg === '--all') forceMode = 'all';
  else if (arg === '--new') forceMode = 'new';
  else if (arg.startsWith('--source=')) source = arg.split('=')[1];
  else if (arg.startsWith('--file=')) srcFile = arg.split('=').slice(1).join('=');
  else if (!arg.startsWith('--')) srcFile = arg;
}

const isGrosshandel = source === 'Grosshandel';

if (!srcFile) {
  srcFile = isGrosshandel ? DEFAULT_SRC_GH : DEFAULT_SRC_EH;
}

// --- Helper: ask question ---
function ask(question, defaultAnswer) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultAnswer);
    });
  });
}

// --- Helper: parse a CSV line into a row object ---
function parseLine(cols) {
  if (isGrosshandel) {
    // Grosshandel: tab-delimited, 17 columns
    let datum = '';
    const rawDate = cols[0].split(' ')[0];
    if (rawDate.includes('-')) {
      datum = rawDate;
    } else {
      const parts = rawDate.split('.');
      if (parts.length === 3) datum = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    const mm = datum ? datum.split('-')[1] : '';
    const monat = MONAT_MAP[mm] || '';
    const kw = datum ? getISOWeek(datum) : '00';
    const anzahl = parseInt(cols[12]) || 0;
    // Grosshandel uses dot-decimal
    const einzelPreis = (() => {
      const n = parseFloat(cols[13] || '0');
      return isNaN(n) ? 0 : Math.round(n * 100) / 100;
    })();

    return {
      kasse: cols[1],       // Gebiet
      kollektion: cols[3],
      subKollektion: cols[7],
      art: cols[4],
      nr: cols[8],
      form: cols[9],
      formPfad: cols[2],
      bildId: cols[11],
      anzahl, einzelPreis, monat, kw, datum,
    };
  } else {
    // Einzelhandel: semicolon-delimited
    const dateParts = cols[0].split(' ')[0].split('.');
    const datum = dateParts.length === 3
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`
      : '';

    const parseNum = (s) => {
      const n = parseFloat((s || '0').replace(',', '.'));
      return isNaN(n) ? 0 : Math.round(n * 100) / 100;
    };

    if (cols.length >= 29) {
      // Old 29+ column format
      const monat = MONAT_MAP[cols[26]] || cols[25] || '';
      const kw = cols[23].padStart(2, '0');
      const anzahl = parseInt(cols[11]) || 0;
      const einzelPreis = parseNum(cols[12]);
      return {
        kasse: cols[1], kollektion: cols[3], subKollektion: cols[5],
        art: cols[6], nr: cols[7], form: cols[8], formPfad: cols[2],
        bildId: cols[10], anzahl, einzelPreis, monat, kw, datum,
      };
    } else {
      // New 17 column format
      const mm = datum ? datum.split('-')[1] : '';
      const monat = MONAT_MAP[mm] || '';
      const kw = datum ? getISOWeek(datum) : '00';
      const anzahl = parseInt(cols[12]) || 0;
      const einzelPreis = parseNum(cols[13]);
      return {
        kasse: cols[1], kollektion: cols[3], subKollektion: cols[4],
        art: cols[5], nr: cols[10], form: cols[9], formPfad: cols[2],
        bildId: cols[11], anzahl, einzelPreis, monat, kw, datum,
      };
    }
  }
}

// --- Main ---
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║        miranda-liste  CSV Import Tool           ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log(`📌 Quelle: ${source}`);
  console.log(`📂 Format: ${isGrosshandel ? 'Tab-delimited, UTF-8' : 'Semicolon-delimited, ISO-8859-1'}`);

  // 1. Check source file
  if (!fs.existsSync(srcFile)) {
    console.error(`❌ Quelldatei nicht gefunden: ${srcFile}`);
    process.exit(1);
  }
  const srcSize = (fs.statSync(srcFile).size / 1024 / 1024).toFixed(2);
  console.log(`📂 Quelldatei: ${srcFile} (${srcSize} MB)`);

  // 2. Load existing data.json
  let existingDicts = { K: [], L: [], S: [], A: [], N: [], F: [], P: [], Q: [] };
  let existingRows = [];
  let existingDates = new Set(); // dates for THIS source only

  if (fs.existsSync(DST)) {
    console.log(`📦 Lade bestehende data.json...`);
    const existing = JSON.parse(fs.readFileSync(DST, 'utf-8'));
    existingDicts = existing.d;
    if (!existingDicts.Q) existingDicts.Q = [];
    existingRows = existing.r;

    // Find source index in Q dictionary
    let sourceIdx = existingDicts.Q.indexOf(source);

    // Collect dates for THIS source only (for dedup)
    for (const row of existingRows) {
      const rowQuelle = row.length > 13 ? row[13] : -1;
      if (sourceIdx < 0 || rowQuelle === sourceIdx) {
        existingDates.add(row[12]); // datum is at index 12
      }
    }
    console.log(`   → ${existingRows.length} bestehende Zeilen total`);
    if (sourceIdx >= 0) {
      const srcRows = existingRows.filter(r => r.length > 13 && r[13] === sourceIdx).length;
      console.log(`   → ${srcRows} davon ${source}`);
    }
    console.log(`   → ${existingDates.size} unique Tage (${source})`);
  } else {
    console.log(`⚠️  Keine bestehende data.json gefunden — erstelle neue.`);
  }

  // 3. Read CSV
  console.log(`\n📖 Lese CSV-Datei...`);
  const raw = fs.readFileSync(srcFile, isGrosshandel ? 'utf-8' : 'latin1');
  const allLines = raw.split(/\r?\n/).filter(l => l.trim());

  // Skip header for Grosshandel
  const startIdx = isGrosshandel && allLines.length > 0 && allLines[0].includes('Datum') ? 1 : 0;
  const lines = allLines.slice(startIdx);
  console.log(`   → ${lines.length} Zeilen gelesen`);

  // 4. Parse all CSV lines
  const delimiter = isGrosshandel ? '\t' : ';';
  const csvParsed = [];
  let parseErrors = 0;
  const csvDates = new Set();

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map(c => c.replace(/^"|"$/g, '').trim());
    if (cols.length < (isGrosshandel ? 14 : 17)) {
      parseErrors++;
      if (parseErrors <= 3) console.log(`   ⚠️  Zeile ${startIdx + i + 1}: nur ${cols.length} Spalten, übersprungen`);
      continue;
    }
    const parsed = parseLine(cols);
    csvParsed.push(parsed);
    csvDates.add(parsed.datum);
  }

  const sortedCsvDates = [...csvDates].sort();
  console.log(`   → ${csvParsed.length} gültige Zeilen (${parseErrors} Fehler)`);
  if (sortedCsvDates.length > 0) {
    console.log(`   → Zeitraum: ${sortedCsvDates[0]} bis ${sortedCsvDates[sortedCsvDates.length - 1]}`);
  }

  // 5. Calculate new vs existing dates (within same source)
  const newDates = new Set([...csvDates].filter(d => !existingDates.has(d)));
  const overlapDates = new Set([...csvDates].filter(d => existingDates.has(d)));
  const newDateRows = csvParsed.filter(r => newDates.has(r.datum));

  console.log(`\n📊 Analyse:`);
  console.log(`   → ${newDates.size} neue Tage (${newDateRows.length} Zeilen)`);
  console.log(`   → ${overlapDates.size} bereits vorhandene Tage`);

  if (newDates.size > 0) {
    const sortedNew = [...newDates].sort();
    const showDates = sortedNew.slice(0, 5);
    console.log(`   → Neue Tage: ${showDates.join(', ')}${sortedNew.length > 5 ? ` ... (+${sortedNew.length - 5} weitere)` : ''}`);
  }

  // 6. Ask import mode
  let onlyNew = true;
  if (forceMode === 'all') {
    onlyNew = false;
    console.log(`\n🔧 Modus: ALLE Zeilen importieren (--all)`);
  } else if (forceMode === 'new') {
    onlyNew = true;
    console.log(`\n🔧 Modus: Nur NEUE Zeiträume (--new)`);
  } else {
    console.log('');
    const answer = await ask(
      '❓ Nur neue Zeiträume einlesen? [J/n] (Standard: J) → ',
      'J'
    );
    onlyNew = answer.toUpperCase() !== 'N';
    console.log(onlyNew
      ? '   → Nur neue Zeiträume werden importiert.'
      : '   → ALLE Zeilen werden importiert (bestehende Tage werden überschrieben!).'
    );
  }

  // 7. Determine which rows to import
  let rowsToImport;
  if (onlyNew) {
    rowsToImport = newDateRows;
    if (rowsToImport.length === 0) {
      console.log('\n✅ Keine neuen Zeiträume gefunden — data.json ist bereits aktuell!');
      process.exit(0);
    }
  } else {
    rowsToImport = csvParsed;
    // Remove overlapping dates from existingRows (only for THIS source)
    if (overlapDates.size > 0) {
      const sourceIdx = existingDicts.Q.indexOf(source);
      const beforeCount = existingRows.length;
      existingRows = existingRows.filter(r => {
        if (r.length > 13 && r[13] === sourceIdx && overlapDates.has(r[12])) return false;
        // Legacy rows without Q index: only remove if source is Einzelhandel
        if (r.length <= 13 && source === 'Einzelhandel' && overlapDates.has(r[12])) return false;
        return true;
      });
      console.log(`   → ${beforeCount - existingRows.length} bestehende ${source}-Zeilen für überlappende Tage entfernt`);
    }
  }

  console.log(`\n⚙️  Importiere ${rowsToImport.length} Zeilen als ${source}...`);

  // 8. Rebuild dictionary maps from existing dictionaries
  const dictMaps = {
    K: new Map(), L: new Map(), S: new Map(), A: new Map(),
    N: new Map(), F: new Map(), P: new Map(), Q: new Map(),
  };

  // Populate maps from existing dictionaries
  for (const [key, arr] of Object.entries(existingDicts)) {
    if (!dictMaps[key]) continue;
    for (let i = 0; i < arr.length; i++) {
      dictMaps[key].set(arr[i], i);
    }
  }

  function dictIdx(dict, val) {
    const v = val || '';
    if (dict.has(v)) return dict.get(v);
    const idx = dict.size;
    dict.set(v, idx);
    return idx;
  }

  // Ensure source is in Q dictionary
  const quelleIdx = dictIdx(dictMaps.Q, source);

  // Upgrade legacy rows (no Q index) to Einzelhandel
  if (existingRows.length > 0 && existingRows[0].length <= 13) {
    const ehIdx = dictIdx(dictMaps.Q, 'Einzelhandel');
    console.log(`   → Upgrading ${existingRows.length} legacy rows: adding Quelle=Einzelhandel (idx=${ehIdx})`);
    for (const r of existingRows) {
      r.push(ehIdx);
    }
  }

  // 9. Convert new rows to compact format
  const newRows = [];
  for (const r of rowsToImport) {
    newRows.push([
      dictIdx(dictMaps.K, r.kasse),         // 0: Kasse
      dictIdx(dictMaps.L, r.kollektion),     // 1: Kollektion
      dictIdx(dictMaps.S, r.subKollektion),  // 2: SubKollektion
      dictIdx(dictMaps.A, r.art),            // 3: Art
      dictIdx(dictMaps.N, r.nr),             // 4: Nr
      dictIdx(dictMaps.F, r.form),           // 5: Form
      dictIdx(dictMaps.P, r.formPfad),       // 6: FormPfad
      r.bildId,                              // 7: BildId
      r.anzahl,                              // 8: Anzahl
      r.einzelPreis,                         // 9: EinzelPreis
      r.monat,                               // 10: Monat
      r.kw,                                  // 11: KW
      r.datum,                               // 12: Datum
      quelleIdx,                             // 13: Quelle
    ]);
  }

  // 10. Merge rows
  const allRows = [...existingRows, ...newRows];

  // Sort by date
  allRows.sort((a, b) => {
    if (a[12] < b[12]) return -1;
    if (a[12] > b[12]) return 1;
    return 0;
  });

  // 11. Build output dictionaries
  const dictArrays = {};
  for (const [key, map] of Object.entries(dictMaps)) {
    const arr = new Array(map.size);
    for (const [val, idx] of map) arr[idx] = val;
    dictArrays[key] = arr;
  }

  // 12. Write output
  const output = { d: dictArrays, r: allRows };
  const json = JSON.stringify(output);

  // Backup existing data.json
  if (fs.existsSync(DST)) {
    const backupPath = DST.replace('.json', `.backup-${new Date().toISOString().slice(0, 10)}.json`);
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(DST, backupPath);
      console.log(`💾 Backup: ${path.basename(backupPath)}`);
    }
  }

  fs.writeFileSync(DST, json);

  // 13. Stats
  const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(2);
  const gzSize = (zlib.gzipSync(json).length / 1024 / 1024).toFixed(2);
  const brSize = (zlib.brotliCompressSync(json).length / 1024 / 1024).toFixed(2);

  const finalDates = new Set(allRows.map(r => r[12]));
  const sortedFinal = [...finalDates].sort();

  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  ✅ Import abgeschlossen!                        ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Zeilen vorher:  ${String(existingRows.length).padStart(8)}                      ║`);
  console.log(`║  Importiert:     ${String(newRows.length).padStart(8)}                      ║`);
  console.log(`║  Zeilen gesamt:  ${String(allRows.length).padStart(8)}                      ║`);
  console.log(`║  Unique Tage:    ${String(finalDates.size).padStart(8)}                      ║`);
  console.log(`║  Zeitraum:       ${sortedFinal[0]} → ${sortedFinal[sortedFinal.length - 1]}     ║`);
  console.log(`╠══════════════════════════════════════════════════╣`);
  console.log(`║  Raw:    ${sizeMB.padStart(8)} MB                          ║`);
  console.log(`║  Gzip:   ${gzSize.padStart(8)} MB                          ║`);
  console.log(`║  Brotli: ${brSize.padStart(8)} MB                          ║`);
  console.log(`╚══════════════════════════════════════════════════╝`);

  // Dictionary + Source stats
  console.log(`\n📚 Dictionaries:`);
  for (const [key, arr] of Object.entries(dictArrays)) {
    const label = { K: 'Kasse/Gebiet', L: 'Kollektion', S: 'SubKollektion', A: 'Art', N: 'Nr', F: 'Form', P: 'FormPfad', Q: 'Quelle' }[key] || key;
    console.log(`   ${key} (${label}): ${arr.length} Einträge`);
  }

  if (dictArrays.Q && dictArrays.Q.length > 0) {
    console.log(`\n📊 Quellen:`);
    for (let qi = 0; qi < dictArrays.Q.length; qi++) {
      const count = allRows.filter(r => r[13] === qi).length;
      console.log(`   ${dictArrays.Q[qi]}: ${count} Zeilen`);
    }
  }
}

main().catch(err => {
  console.error('❌ Fehler:', err.message);
  process.exit(1);
});
