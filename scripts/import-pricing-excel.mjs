import Database from 'better-sqlite3';
import path from 'path';
import xlsx from 'xlsx';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db');
const EXCEL_PATH = process.argv[2] || '/Users/shengshuyuan/Downloads/TokenTrail_Model_Pricing_Updated_2026-07-11.xlsx';

const db = new Database(DB_PATH);

console.log(`Reading Excel file from ${EXCEL_PATH}...`);
let workbook;
try {
  workbook = xlsx.readFile(EXCEL_PATH);
} catch (error) {
  console.error(`Failed to read Excel file: ${error.message}`);
  process.exit(1);
}

const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];
const data = xlsx.utils.sheet_to_json(worksheet);

console.log(`Found ${data.length} records. Updating database...`);

const upsertStmt = db.prepare(`
  INSERT INTO model_pricing (
    model_id, display_name, provider, input_price_per_1m,
    cached_input_price_per_1m, output_price_per_1m, reasoning_price_per_1m
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(model_id) DO UPDATE SET
    display_name = excluded.display_name,
    provider = excluded.provider,
    input_price_per_1m = excluded.input_price_per_1m,
    cached_input_price_per_1m = excluded.cached_input_price_per_1m,
    output_price_per_1m = excluded.output_price_per_1m,
    reasoning_price_per_1m = excluded.reasoning_price_per_1m
`);

const updateTransaction = db.transaction((rows) => {
  for (const row of rows) {
    if (!row['Model ID']) continue; // Skip empty rows
    upsertStmt.run(
      row['Model ID'],
      row['Display Name'] || row['Model ID'],
      row['Provider'] || 'unknown',
      Number(row['Input Price (/1M tokens)']) || 0,
      Number(row['Cached Input Price (/1M tokens)']) || 0,
      Number(row['Output Price (/1M tokens)']) || 0,
      Number(row['Reasoning Price (/1M tokens)']) || 0
    );
  }
});

updateTransaction(data);
console.log('✅ Model pricing updated successfully.');

console.log('Recalculating costs for all usage records...');
const recalculateStmt = db.prepare(`
  UPDATE usage_records
  SET cost_usd = (
    SELECT 
      ROUND(
        (usage_records.input_tokens / 1000000.0) * model_pricing.input_price_per_1m +
        (usage_records.cached_input_tokens / 1000000.0) * model_pricing.cached_input_price_per_1m +
        (usage_records.output_tokens / 1000000.0) * model_pricing.output_price_per_1m +
        (usage_records.reasoning_tokens / 1000000.0) * model_pricing.reasoning_price_per_1m
      , 6)
    FROM model_pricing
    WHERE model_pricing.model_id = usage_records.model
  )
  WHERE EXISTS (
    SELECT 1 FROM model_pricing WHERE model_pricing.model_id = usage_records.model
  )
`);

const result = recalculateStmt.run();
console.log(`✅ Recalculated cost for ${result.changes} usage records.`);
