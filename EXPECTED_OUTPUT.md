# Expected output

These are **real outputs from one recording session**. They were captured by following the [README](README.md) with
Rewind at commit `1c34e77` on Windows 11, Node.js v24.22.1, colour off (`NO_COLOR=1`), at a terminal width of
100 columns. Rewind fits its layout to your terminal width, so line breaks will differ on your screen.

**These values change between runs:**

| value | example from this session | on your machine |
|---|---|---|
| run ids | `da439bc4` (bad), `54d8285e` (good), `8ab832df` (nowatch), `4921524b` (fixed) | random each recording |
| sequence numbers (`seq`) | the A-101 log line was `seq 258` | can shift by a few |
| millisecond timings | `235.9`, `401.6`, … | depend on the machine |
| event counts | 432 events for the bad run | close to this, but not guaranteed (433 has been seen) |

**These stay the same:** request numbering (#1 is the `GET /health` warm-up, then A-101 = #2, B-202 = #3,
C-303 = #4), the totals, which request crashes, and what each finding says (apart from the `seq` numbers it cites).

The only edit below: absolute paths in the plain Node stack trace are shortened to `…\rewind-demo-test\`.
Everything else is exactly as Rewind printed it.

Rewind prints a write to `currentCart` as `` `currentCart` = at demo/checkout.js:12:5 `` (and as
`currentCart = @ …` in `diff`). It reads oddly but is correct. The whole variable was reassigned, so there's no
property path such as `.items`. The `=` is the kind of write, and the new value is printed separately
(`new value {…}`); `diff` leaves values out entirely.

---

## Step 1: plain Node (`node demo/traffic.js`)

Exit code 1.

```text
order A-101: charged $161
order C-303: charged $11
…\rewind-demo-test\demo\checkout.js:23
  for (let i = 0; i < order.items.length; i++) total += currentCart.items[i].price;
                                                                             ^

TypeError: Cannot read properties of undefined (reading 'price')
    at applyDiscount (…\rewind-demo-test\demo\checkout.js:23:78)
    at …\rewind-demo-test\demo\checkout.js:34:23
    at Timeout.paymentConfirmed [as _onTimeout] (…\rewind-demo-test\demo\checkout.js:18:44)
    at listOnTimeout (node:internal/timers:685:17)
    at process.processTimers (node:internal/timers:618:7)

Node.js v24.22.1
```

## Step 2: `rewind record -l bad -w currentCart -- node demo/traffic.js`

The program's own output passes through unchanged. Its stack trace goes to stderr and is omitted here.

```text
  ◂◂ recording da439bc4  node demo/traffic.js  watch=currentCart
order A-101: charged $161
order C-303: charged $11
  ✖ recorded run da439bc4 bad  432 events · 1 error · exit 1 · failed  0.5s
```

## Step 3: `rewind why bad`

```text
  ◂◂ why  run da439bc4 (bad)  · error 1 of 1

  ✖ TypeError  Cannot read properties of undefined (reading 'price')
    demo/checkout.js:23  in applyDiscount
      23 │ for (let i = 0; i < order.items.length; i++) total += currentCart.items[i].price;

  findings ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ ● observed  ◆ derived  ? inferred
  ● TypeError: Cannot read properties of undefined (reading 'price')  (uncaught exception)
  ● thrown in applyDiscount at demo/checkout.js:23
  ● ran inside the callback of Timeout paymentConfirmed from chargePayment, created at
    demo/checkout.js:18
  ◆ causal chain: Timeout paymentConfirmed from chargePayment (demo/checkout.js:18) ← FSREQCALLBACK
    from loadCart (demo/checkout.js:9) ← request #3 POST /order
  ◆ belongs to request #3 POST /order: its async ancestry reaches that request's handler
  ◆ request #2 POST /order was active while #3 POST /order was in flight (logged, responded)
  ◆ request #4 POST /order was active while #3 POST /order was in flight (arrived, logged,
    responded, wrote state)
  ◆ the failing line reads watched variable `currentCart`:  for (let i = 0; i < order.items.length;
    i++) total += currentCart.items[i].price;
  ● last write to `currentCart` before this point: `currentCart` = at demo/checkout.js:12:5, new
    value {"order":"C-303","items":[{"sku":"cable-03","price":12}]}
  ◆ that write was made by request #4 POST /order
  ◆ #3 POST /order set `currentCart` itself (seq 254); request #4 overwrote it (seq 371) before
    this point (seq 430)
  ? likely root cause: a race on shared module-level state. Another request overwrote it between
    this request's own write and its read, so this request computed with another request's data.
    Fix: keep this state per request instead of in a module-level variable.

  causal chain ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ innermost first
    Timeout paymentConfirmed  scheduled in chargePayment demo/checkout.js:18
  ↑ FSREQCALLBACK  scheduled in loadCart demo/checkout.js:9
  ↑ #3 POST /order

  story of request #3 POST /order ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ + other requests' writes to watched variables
  seq     ms     req     event
  215  235.9  │  #3   →  POST /order
  254  238.2  │  #3   ✎  currentCart = {"order":"A-101","items":[{"sku":"kbd-01","pric… →
                         {"order":"B-202","items":[{"sku":"dock-04","pri…  demo/checkout.js:12:5
  371  284.6  │  #4   ✎  currentCart = {"order":"B-202","items":[{"sku":"dock-04","pri… →
                         {"order":"C-303","items":[{"sku":"cable-03","pr…  demo/checkout.js:12:5
  430  401.6  ┃  #3   ✖  TypeError: Cannot read properties of undefined (reading 'price')
                         demo/checkout.js:23
```

## Step 4: `rewind timeline bad`

```text
  ◂◂ timeline  run da439bc4 (bad)  · 16 events shown of 432 recorded

  seq     ms     req     event                                                    context
    4   51.1  │  ··   ◉  node demo/traffic.js  v24.22.1
    7   88.4  │  ··   ⚙  instrumented demo/checkout.js (1 write site,
                         watch=currentCart)
   43  160.0  │  #1   →  GET /health
   59  166.8  │  #1   ←  404 GET /health 7.2ms
  138  180.4  │  #2   →  POST /order
  177  184.3  │  #2   ✎  currentCart = null →                                     in FSREQCALLBACK…
                         {"order":"A-101","items":[{"sku":"kbd-01","pric…
                         demo/checkout.js:12:5
  215  235.9  │  #3   →  POST /order
  254  238.2  │  #3   ✎  currentCart =                                            in FSREQCALLBACK…
                         {"order":"A-101","items":[{"sku":"kbd-01","pric… →
                         {"order":"B-202","items":[{"sku":"dock-04","pri…
                         demo/checkout.js:12:5
  258  276.0  │  #2   »  order A-101: charged $161                                in Timeout payme…
  270  278.8  │  #2   ←  200 POST /order 98.5ms
  332  281.5  │  #4   →  POST /order
  371  284.6  │  #4   ✎  currentCart =                                            in FSREQCALLBACK…
                         {"order":"B-202","items":[{"sku":"dock-04","pri… →
                         {"order":"C-303","items":[{"sku":"cable-03","pr…
                         demo/checkout.js:12:5
  375  307.4  │  #4   »  order C-303: charged $11                                 in Timeout payme…
  387  309.0  │  #4   ←  200 POST /order 27.7ms
  430  401.6  ┃  #3   ✖  TypeError: Cannot read properties of undefined (reading  in Timeout payme…
                         'price')  demo/checkout.js:23
  431  402.2  │  ··   ◉  exit 1
```

## Step 5: `rewind why bad --seq 258`

`258` was the `seq` of `order A-101: charged $161` in this session. Find yours with `rewind timeline bad -k log`.

```text
  ◂◂ why  run da439bc4 (bad)  · event seq 258

  » order A-101: charged $161

  findings ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ ● observed  ◆ derived  ? inferred
  ● log: order A-101: charged $161
  ● ran inside the callback of Timeout paymentConfirmed from chargePayment, created at
    demo/checkout.js:18
  ◆ causal chain: Timeout paymentConfirmed from chargePayment (demo/checkout.js:18) ← FSREQCALLBACK
    from loadCart (demo/checkout.js:9) ← request #2 POST /order
  ◆ belongs to request #2 POST /order: its async ancestry reaches that request's handler
  ◆ request #3 POST /order was active while #2 POST /order was in flight (arrived, wrote state)
  ● last write to `currentCart` before this point: `currentCart` = at demo/checkout.js:12:5, new
    value
    {"order":"B-202","items":[{"sku":"dock-04","price":149},{"sku":"cable-03","price":12},{"sku":"m
    at-05","price":25}]}
  ◆ that write was made by request #3 POST /order
  ◆ #2 POST /order set `currentCart` itself (seq 177); request #3 overwrote it (seq 254) before
    this point (seq 258)
  ? if #2 POST /order read `currentCart` after seq 254, it got request #3's data, not its own: a
    likely race between concurrent requests. (Reads are not recorded, so this is not proven.)

  causal chain ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ innermost first
    Timeout paymentConfirmed  scheduled in chargePayment demo/checkout.js:18
  ↑ FSREQCALLBACK  scheduled in loadCart demo/checkout.js:9
  ↑ #2 POST /order

  story of request #2 POST /order ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ + other requests' writes to watched variables
  seq     ms     req     event
  138  180.4  │  #2   →  POST /order
  177  184.3  │  #2   ✎  currentCart = null → {"order":"A-101","items":[{"sku":"kbd-01","pric…
                         demo/checkout.js:12:5
  254  238.2  │  #3   ✎  currentCart = {"order":"A-101","items":[{"sku":"kbd-01","pric… →
                         {"order":"B-202","items":[{"sku":"dock-04","pri…  demo/checkout.js:12:5
  258  276.0  │  #2   »  order A-101: charged $161
```

## Step 6: `rewind record -l good -w currentCart -- node demo/traffic.js --sequential`, then `rewind diff good bad`

```text
  ◂◂ recording 54d8285e  node demo/traffic.js --sequential  watch=currentCart
order A-101: charged $128
order B-202: charged $186
order C-303: charged $11
  ● recorded run 54d8285e good  439 events · no errors · exit 0 · ok  0.6s
```

```text
  ◂◂ diff  A run 54d8285e (good)  ·  B run da439bc4 (bad)

  findings ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ ● observed  ◆ derived  ? inferred
  ◆ 14 of 21 (A) / 20 (B) normalised steps line up
  ◆ identical up to and including: #2 ✎ currentCart = @ demo/checkout.js:12:5
  ● next, A does: #2 ▸ Timeout paymentConfirmed from chargePayment @ demo/checkout.js:18
  ● next, B does: #3 http.in POST /order
  ◆ that step also happens in A, but 3 step(s) later: the interleaving changed, not the code path
  ◆ 3 step(s) occur in both runs at different positions (reordered)
  ◆ 4 step(s) only in A, e.g. #2 log order A-101: charged $128
  ◆ 3 step(s) only in B, e.g. #2 log order A-101: charged $161
  ? run B fails and A does not. The first divergence above is the earliest observable point where
    they part ways; it is the place to start, not necessarily the cause. Run `rewind why` on B for
    the causal story.

  aligned steps ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ - only in A   + only in B   seq from A, or B on + lines
    ·····  3 identical steps
      146  #2 ▸ FSREQCALLBACK from loadCart @ demo/checkout.js:9
      156  #2 ✎ currentCart = @ demo/checkout.js:12:5
    ▼ first divergence ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
  -   159  #2 ▸ Timeout paymentConfirmed from chargePayment @ demo/checkout.js:18
  -   160  #2 log order A-101: charged $128
  -   172  #2 http.out 200 POST /order
      223  #3 http.in POST /order
      252  #3 ▸ FSREQCALLBACK from loadCart @ demo/checkout.js:9
      262  #3 ✎ currentCart = @ demo/checkout.js:12:5
  -   265  #3 ▸ Timeout paymentConfirmed from chargePayment @ demo/checkout.js:18
  -   266  #3 log order B-202: charged $186
  -   278  #3 http.out 200 POST /order
  +   257  #2 ▸ Timeout paymentConfirmed from chargePayment @ demo/checkout.js:18
  +   258  #2 log order A-101: charged $161
  +   270  #2 http.out 200 POST /order
      329  #4 http.in POST /order
      358  #4 ▸ FSREQCALLBACK from loadCart @ demo/checkout.js:9
    ·····  2 identical steps
      372  #4 log order C-303: charged $11
      384  #4 http.out 200 POST /order
  -   438  run.end exit 0
  +   429  #3 ▸ Timeout paymentConfirmed from chargePayment @ demo/checkout.js:18
  +   430  #3 error.uncaught Cannot read properties of undefined (reading 'price')
  +   431  run.end exit 1
```

## Step 7 (optional): `rewind why nowatch` (recorded without `--watch`)

Note what is **missing** compared with step 3: no write is claimed. Only shared state is suspected.

```text
  ◂◂ why  run 8ab832df (nowatch)  · error 1 of 1

  ✖ TypeError  Cannot read properties of undefined (reading 'price')
    demo/checkout.js:23  in applyDiscount
      23 │ for (let i = 0; i < order.items.length; i++) total += currentCart.items[i].price;

  findings ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ ● observed  ◆ derived  ? inferred
  ● TypeError: Cannot read properties of undefined (reading 'price')  (uncaught exception)
  ● thrown in applyDiscount at demo/checkout.js:23
  ● ran inside the callback of Timeout paymentConfirmed from chargePayment, created at
    demo/checkout.js:18
  ◆ causal chain: Timeout paymentConfirmed from chargePayment (demo/checkout.js:18) ← FSREQCALLBACK
    from loadCart (demo/checkout.js:9) ← request #3 POST /order
  ◆ belongs to request #3 POST /order: its async ancestry reaches that request's handler
  ◆ request #2 POST /order was active while #3 POST /order was in flight (logged, responded)
  ◆ request #4 POST /order was active while #3 POST /order was in flight (arrived, logged,
    responded)
  ◆ the failing line uses module-level binding(s) `currentCart`, shared by every request:  for (let
    i = 0; i < order.items.length; i++) total += currentCart.items[i].price;
  ? shared state suspected, but writes were not recorded. Re-record with `--watch currentCart` to
    confirm who changed it.

  causal chain ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ innermost first
    Timeout paymentConfirmed  scheduled in chargePayment demo/checkout.js:18
  ↑ FSREQCALLBACK  scheduled in loadCart demo/checkout.js:9
  ↑ #3 POST /order

  story of request #3 POST /order ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
  seq     ms     req     event
  209  141.4  │  #3   →  POST /order
  422  295.1  ┃  #3   ✖  TypeError: Cannot read properties of undefined (reading 'price')
                         demo/checkout.js:23

  tip: record with --watch <variable> to capture writes to shared state
```

## Step 8: after `git apply demo/fix.patch`

`rewind record -l fixed -w currentCart -- node demo/traffic.js`:

```text
  ◂◂ recording 4921524b  node demo/traffic.js  watch=currentCart
order A-101: charged $128
order C-303: charged $11
order B-202: charged $186
  ● recorded run 4921524b fixed  513 events · no errors · exit 0 · ok  0.6s
```

`rewind why fixed`:

```text
  ◂◂ why  run 4921524b (fixed)

  ● no errors recorded. Explain any event with rewind why --seq N
```
