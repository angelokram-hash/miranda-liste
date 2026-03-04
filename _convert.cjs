/**
 * Convert "SHop ab 2025" CSV (semicolon-delimited, ISO-8859) → data.json
 * Replaces existing data.json with new 2025+ data
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

const results = [];
let errors = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Parse semicolon-separated, quoted fields
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

  // Parse numeric values (German: comma as decimal separator)
  const parseNum = (s) => {
    const n = parseFloat((s || '0').replace(',', '.'));
    return isNaN(n) ? 0 : Math.round(n * 100) / 100;
  };

  const row = {
    Kasse: cols[1],
    Kollektion: cols[3],
    SubKollektion: cols[5],
    Art: cols[6],
    Nr: cols[7],
    Form: cols[8],
    FormPfad: cols[2],
    Preisgruppe: cols[9],
    BildId: cols[10],
    Anzahl: parseInt(cols[11]) || 0,
    EinzelPreis: parseNum(cols[12]),
    GesamtPreis: parseNum(cols[13]),
    Umsatz: parseNum(cols[18]),
    PreisOberGruppe: cols[14],
    Monat: MONAT_MAP[cols[26]] || cols[25] || '',
    Wochentag: cols[24],
    KW: cols[23].padStart(2, '0'),
    Datum: datum,
    TRLUXREST: cols[17]
  };

  results.push(row);
}

console.log(`Converted ${results.length} records (${errors} errors)`);
console.log('Sample:', JSON.stringify(results[0], null, 2));

// Verify some stats
const years = [...new Set(results.map(r => r.Datum.slice(0, 4)))];
const kassen = [...new Set(results.map(r => r.Kasse))];
console.log('Years:', years.sort());
console.log('Kassen:', kassen.sort());

// Write output
fs.writeFileSync(DST, JSON.stringify(results));
const sizeMB = (fs.statSync(DST).size / 1024 / 1024).toFixed(1);
console.log(`\nWritten to ${DST} (${sizeMB} MB, ${results.length} records)`);
