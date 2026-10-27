import Database from 'better-sqlite3';
import path from 'path';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'data', 'token-trail.db');

console.log(`Connecting to database at ${DB_PATH}...`);
const db = new Database(DB_PATH);

console.log('Querying model_pricing table...');
const rows = db.prepare('SELECT model_id, display_name, provider, input_price_per_1m, cached_input_price_per_1m, output_price_per_1m, reasoning_price_per_1m FROM model_pricing ORDER BY provider, model_id').all();

console.log(`Found ${rows.length} pricing records. Generating Excel file...`);

// Format data for Excel
const excelData = rows.map(row => ({
  'Provider': row.provider,
  'Model ID': row.model_id,
  'Display Name': row.display_name,
  'Input Price (/1M tokens)': row.input_price_per_1m,
  'Cached Input Price (/1M tokens)': row.cached_input_price_per_1m,
  'Output Price (/1M tokens)': row.output_price_per_1m,
  'Reasoning Price (/1M tokens)': row.reasoning_price_per_1m,
}));

const workbook = new ExcelJS.Workbook();
const worksheet = workbook.addWorksheet('Model Pricing');
worksheet.columns = [
  { header: 'Provider', key: 'Provider', width: 15 },
  { header: 'Model ID', key: 'Model ID', width: 25 },
  { header: 'Display Name', key: 'Display Name', width: 25 },
  { header: 'Input Price (/1M tokens)', key: 'Input Price (/1M tokens)', width: 25 },
  { header: 'Cached Input Price (/1M tokens)', key: 'Cached Input Price (/1M tokens)', width: 30 },
  { header: 'Output Price (/1M tokens)', key: 'Output Price (/1M tokens)', width: 25 },
  { header: 'Reasoning Price (/1M tokens)', key: 'Reasoning Price (/1M tokens)', width: 30 },
];
worksheet.addRows(excelData);

const outPath = path.join(__dirname, '..', 'TokenTrail_Model_Pricing.xlsx');
await workbook.xlsx.writeFile(outPath);

console.log(`✅ Excel file successfully generated at: ${outPath}`);
