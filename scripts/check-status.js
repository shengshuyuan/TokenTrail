const Database = require('better-sqlite3')
const db = new Database('data/token-trail.db')

const recent = db.prepare(`
  SELECT date((timestamp+28800000)/1000, 'unixepoch') as day, COUNT(*) as cnt, SUM(cost_usd) as cost
  FROM usage_records
  WHERE timestamp > ?
  GROUP BY day
  ORDER BY day DESC
  LIMIT 7
`).all(Date.now() - 7 * 86400000)

console.log('Last 7 days:')
recent.forEach(r => console.log(`  ${r.day}: ${r.cnt} records, $${r.cost.toFixed(2)}`))

const pricing = db.prepare('SELECT COUNT(*) as cnt FROM model_pricing').get()
console.log('\nPricing entries:', pricing.cnt)

db.close()
