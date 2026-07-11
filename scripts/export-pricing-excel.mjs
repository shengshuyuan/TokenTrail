import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import xlsx from 'xlsx';
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

const worksheet = xlsx.utils.json_to_sheet(excelData);

// Adjust column widths
const colWidths = [
  { wch: 15 }, // Provider
  { wch: 25 }, // Model ID
  { wch: 25 }, // Display Name
  { wch: 25 }, // Input Price
  { wch: 30 }, // Cached Input
  { wch: 25 }, // Output Price
  { wch: 30 }, // Reasoning Price
];
worksheet['!cols'] = colWidths;

const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'Model Pricing');

const outPath = path.join(__dirname, '..', 'TokenTrail_Model_Pricing.xlsx');
xlsx.writeFile(workbook, outPath);

console.log(`✅ Excel file successfully generated at: ${outPath}`);
