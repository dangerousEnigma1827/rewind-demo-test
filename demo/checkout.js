// Phantom Discount demo: a tiny checkout service with a shared-state bug.
const http = require('http');
const fs = require('fs');
const path = require('path');

let currentCart = null; // BUG: one cart shared by every in-flight request

function loadCart(order, done) {
  fs.readFile(path.join(__dirname, 'prices.json'), 'utf8', (err, txt) => {
    if (err) return done(err);
    const prices = JSON.parse(txt);
    currentCart = { order: order.id, items: order.items.map(sku => ({ sku, price: prices[sku] })) };
    done();
  });
}

function chargePayment(order, done) {
  setTimeout(function paymentConfirmed() { done(); }, order.paymentMs); // simulated payment gateway latency
}

function applyDiscount(order) {
  let total = 0;
  for (let i = 0; i < order.items.length; i++) total += currentCart.items[i].price;
  return order.coupon ? Math.round(total * 0.9) : total;
}

function handleOrder(req, res) {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const order = JSON.parse(body);
    loadCart(order, () => {
      chargePayment(order, () => {
        const total = applyDiscount(order);
        console.log(`order ${order.id}: charged $${total}`);
        res.end(JSON.stringify({ id: order.id, total }));
      });
    });
  });
}

module.exports = () => http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/order') return handleOrder(req, res);
  res.statusCode = 404; res.end();
});
