const http = require('http');
const req = http.get('http://127.0.0.1:3820/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (res.statusCode !== 200) {
      console.log('Headers:', JSON.stringify(res.headers));
      console.log('Body (first 2000):', data.substring(0, 2000));
    } else {
      console.log('OK - length:', data.length);
    }
  });
});
req.on('error', (e) => console.log('Connection error:', e.message));
req.setTimeout(5000, () => { req.destroy(); console.log('Timeout'); });
