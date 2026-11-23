// Starts the checkout service and replays three customer orders against it.
//   node demo/traffic.js               -> orders overlap (bug appears)
//   node demo/traffic.js --sequential  -> one order at a time (bug hidden)
const http = require('http');
const createServer = require('./checkout');

const ORDERS = [
  // timings chosen with >=40ms margins so the interleaving is the same on every run
  { id: 'A-101', items: ['kbd-01', 'mouse-02'], paymentMs: 80, at: 0 },
  { id: 'B-202', items: ['dock-04', 'cable-03', 'mat-05'], paymentMs: 150, at: 40 },
  { id: 'C-303', items: ['cable-03'], coupon: 'SAVE10', paymentMs: 10, at: 100 },
];
const sequential = process.argv.includes('--sequential') || process.env.DEMO_SEQUENTIAL === '1';

function send(port, order) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(order);
    const req = http.request({ port, method: 'POST', path: '/order', headers: { 'content-type': 'application/json' } }, res => {
      let out = ''; res.on('data', c => (out += c)); res.on('end', () => resolve(out));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const server = createServer().listen(0, async () => {
  const { port } = server.address();
  await new Promise(r => http.get({ port, path: '/health' }, res => res.resume().on('end', r))); // warm up the connection path
  if (sequential) {
    for (const o of ORDERS) await send(port, o);
  } else {
    await Promise.all(ORDERS.map(o => new Promise(r => setTimeout(r, o.at)).then(() => send(port, o))));
  }
  server.close();
});
