# Phantom Discount: a Rewind demo

A small Node.js checkout service with a race condition, and step-by-step instructions for investigating it with
[**Rewind**](https://github.com/dangerousEnigma1827/Rewind). Rewind is a causal debugger for Node.js: you record a
run once, then ask *why* something happened.

This repository contains only the demo program and this walkthrough. You install Rewind from its own repository,
pinned to commit [`1c34e77`](https://github.com/dangerousEnigma1827/Rewind/commit/1c34e77861f5708d8fb3e4246a117763401decee).

Want to see what to expect before running anything? [EXPECTED_OUTPUT.md](EXPECTED_OUTPUT.md) shows real output from
one recorded run.

---

## 1. The bug

`demo/checkout.js` is an order service. Each `POST /order` runs three async steps:

1. `loadCart`: reads `prices.json` with `fs.readFile` and builds the cart.
2. `chargePayment`: waits on a timer that stands in for a payment gateway.
3. `applyDiscount`: adds up the cart's prices and logs `order <id>: charged $<total>`.

The cart is stored in **one module-level variable**, shared by every request:

```js
let currentCart = null; // BUG: one cart shared by every in-flight request   (line 6)
currentCart = { order: order.id, items: ... };                               // written in loadCart (line 12)
total += currentCart.items[i].price;                                         // used in applyDiscount (line 23)
```

Each request writes the cart, waits for its payment timer, and only then uses the cart. If another request writes
`currentCart` while the first one waits, the first request computes its total from someone else's cart.

`demo/traffic.js` starts the service and sends a `GET /health` warm-up request, then three orders that overlap in time:

| request | order | items | correct total | what actually happens |
|---|---|---|---|---|
| #1 | — | `GET /health` warm-up | — | — |
| #2 | A-101 | keyboard 89 + mouse 39 | **$128** | charged **$161**. Request #3 replaced the cart before A-101's payment finished. No error is raised. |
| #3 | B-202 | dock 149 + cable 12 + mat 25 | **$186** | **crashes**. Request #4 replaced the cart with C-303's one-item cart, so `items[1]` is undefined. |
| #4 | C-303 | cable 12, 10% coupon | **$11** | correct. Its payment is fast enough that nobody overwrites its cart first. |

Rewind numbers requests in arrival order. **Request #1 is the health check, so the orders are #2, #3 and #4.**

With `--sequential`, each order waits for the previous one to finish. The bug disappears: $128, $186, $11.

---

## 2. Prerequisites

- **Git**
- **Python 3.12 or newer**
- **Node.js 20 or newer**, with **npm**

Rewind was verified on Windows 11 (Python 3.15, Node 24) and on Ubuntu 24.04 under WSL2 (Python 3.12, Node 24).
macOS has not been tested.

---

## 3. Install Rewind

Both repositories go side by side in one folder:

```
some-folder/
  Rewind/              ← Rewind itself, pinned to 1c34e77
  rewind-demo-test/    ← this repository; run every demo command from here
```

**Two things are easy to get wrong:**

- **Install Rewind in editable mode (`pip install -e .`).** Rewind has two parts: a Python CLI and a Node.js recorder
  (`recorder/recorder.js`) that the CLI injects into your program. The CLI finds the recorder relative to its own
  source folder. A normal `pip install` copies only the Python package, so the recorder is missing and recording fails
  with "recorder produced no output". Editable mode runs the CLI from the cloned folder, next to the recorder.
- **Install the recorder's npm dependencies separately (`npm install --prefix recorder`).** `pip` doesn't install
  Node packages. The recorder needs `acorn`, `acorn-walk` and `magic-string` for `--watch`, which this demo uses.
  Without them, a `--watch` recording fails with `Cannot find module 'acorn'`.

### Windows (PowerShell)

These commands avoid activating the virtual environment, so they work even if PowerShell is set to block scripts.

```powershell
git clone https://github.com/dangerousEnigma1827/Rewind.git
cd Rewind
git checkout 1c34e77861f5708d8fb3e4246a117763401decee
python -m venv .venv
.venv\Scripts\python -m pip install -e .
npm install --prefix recorder
cd ..

git clone https://github.com/dangerousEnigma1827/rewind-demo-test.git
cd rewind-demo-test
Set-Alias rewind (Resolve-Path ..\Rewind\.venv\Scripts\rewind.exe)
```

`git checkout` reports a "detached HEAD". That's expected: it means you're on the exact pinned commit.
`Set-Alias` lasts for the current PowerShell window only. In a new window, `cd` into `rewind-demo-test` and run it again.

### Linux and macOS

```sh
git clone https://github.com/dangerousEnigma1827/Rewind.git
cd Rewind
git checkout 1c34e77861f5708d8fb3e4246a117763401decee
python3 -m venv .venv            # Ubuntu/Debian: needs `sudo apt install python3-venv`
.venv/bin/python -m pip install -e .
npm install --prefix recorder
cd ..

git clone https://github.com/dangerousEnigma1827/rewind-demo-test.git
cd rewind-demo-test
alias rewind="$(cd ../Rewind && pwd)/.venv/bin/rewind"
```

(`source ../Rewind/.venv/bin/activate` works too.)

**Check the install:** `rewind runs` should print `no runs yet — try rewind record -- node app.js`.

---

## 4. Walkthrough

Run everything from the `rewind-demo-test` folder. The commands are the same in PowerShell and in a Linux/macOS shell.

> **Run ids, sequence numbers (`seq`), millisecond timings and event counts differ every time you record.** Use the
> values your own terminal prints. Request numbers, totals, and which request crashes stay the same.

### Step 1: run it with plain Node

```sh
node demo/traffic.js
```

You'll see `order A-101: charged $161`, then `order C-303: charged $11`, then a crash:
`TypeError: Cannot read properties of undefined (reading 'price')` in `applyDiscount`. The stack trace points at line
23, inside a timer callback. It doesn't say which order crashed, who changed the cart, or that $161 is wrong.

### Step 2: record it with Rewind

```sh
rewind record -l bad -w currentCart -- node demo/traffic.js
```

- `-l bad` labels the run so you can refer to it as `bad`.
- `-w currentCart` (`--watch`) records every write to the `currentCart` variable.
- Everything after `--` is the program. It runs normally: same output, same crash, same exit code.

Rewind saves the recording in `./.rewind/` and prints a summary like `recorded run <id> bad … 1 error · exit 1 · failed`.

### Step 3: ask why it crashed

```sh
rewind why bad
```

Rewind explains the crash. Every line is labelled with how certain it is (see section 5). The key findings:

- `● thrown in applyDiscount at demo/checkout.js:23`
- `◆ causal chain: Timeout paymentConfirmed … ← FSREQCALLBACK from loadCart … ← request #3 POST /order`.
  The crash happened in B-202's payment callback.
- `◆ request #4 POST /order was active while #3 POST /order was in flight (… wrote state)`
- `● last write to currentCart before this point: … new value {"order":"C-303", …}`
- `◆ #3 POST /order set currentCart itself (seq …); request #4 overwrote it (seq …) before this point`
- `? likely root cause: a race on shared module-level state … Fix: keep this state per request`

Add `--evidence` to show the recorded event numbers behind every finding.

### Step 4: see the interleaving

```sh
rewind timeline bad
```

This lists the run's requests, logs, writes and errors in order, each tagged with its request number. You can see all
three requests write `currentCart`, and the `order A-101: charged $161` line attributed to request **#2**. The bug has
a second, silent victim.

Other views:
- `rewind timeline bad -r 3` shows only request #3.
- `rewind tree bad` shows the async causality tree: which callback scheduled which.

### Step 5: explain the silent overcharge

The overcharge isn't an error, so ask about that specific event. Find its `seq` number in the first column of:

```sh
rewind timeline bad -k log
```

Use the number on the `order A-101: charged $161` line:

```sh
rewind why bad --seq <that number>
```

Rewind shows that request #3 overwrote #2's cart before the log line. Then it says plainly what it can't prove:
`(Reads are not recorded, so this is not proven.)`

### Step 6: compare with a run that works

```sh
rewind record -l good -w currentCart -- node demo/traffic.js --sequential
rewind diff good bad
```

The sequential run charges $128, $186 and $11 with no errors. `diff` aligns the two runs:
- `identical up to and including: #2 ✎ currentCart = @ demo/checkout.js:12:5`
- In the good run, A-101's payment completes next. In the bad run, request #3 arrives first.
- `the interleaving changed, not the code path`

Record both runs with the same `-w`. If only one run watches `currentCart`, writes are left out of the comparison.

### Step 7 (optional): without `--watch`

```sh
rewind record -l nowatch -- node demo/traffic.js
rewind why nowatch
```

Without `--watch`, Rewind has no recorded writes, and it won't claim any. It still finds the crashing request and the
causal chain. It notes that the failing line uses the module-level `currentCart`, and stops at
`? shared state suspected, but writes were not recorded. Re-record with --watch currentCart to confirm who changed it.`

### Step 8: fix it, verify, undo

`demo/fix.patch` passes each request's cart through its callbacks instead of the shared variable.

```sh
git apply demo/fix.patch
node demo/traffic.js
rewind record -l fixed -w currentCart -- node demo/traffic.js
rewind why fixed
```

All three orders are now correct: A-101 $128, C-303 $11, B-202 $186. They print in that order because B-202's payment
is the slowest. The program exits normally, and `rewind why fixed` reports `no errors recorded`.

To restore the original buggy demo:

```sh
git apply -R demo/fix.patch
git status          # should show nothing to commit
```

To start over with no recordings, delete the `.rewind` folder.

---

## 5. Reading Rewind's output: observed, derived, inferred

Every finding is marked with how certain Rewind is about it:

| mark | level | meaning | example from this demo |
|---|---|---|---|
| `●` | **observed** | a recorded event, reported as it was recorded | the error and where it was thrown; a write to `currentCart` with its new value |
| `◆` | **derived** | computed from recorded events: which request an event belongs to, ordering, causal chains | "that write was made by request #4"; "#3 set it, then #4 overwrote it" |
| `?` | **inferred** | a likely explanation, always citing the observed and derived findings behind it | "likely root cause: a race on shared module-level state" |

Rewind records writes to variables you name with `--watch`. It does **not** record reads. So "request #3 *read*
request #4's cart" is an inference, and Rewind labels it that way.

---

## 6. Limits worth knowing

- `--watch` records direct writes to a top-level variable in a CommonJS file. It misses writes through another
  reference (`const c = currentCart; c.x = 1`), writes inside functions the value is passed to, ES modules and
  `node_modules`.
- Request tracking covers Node's built-in `http` server. `https`, `http2`, worker threads and child processes are not
  instrumented.
- Rewind records what happened (async lifecycle, requests, logs, errors, watched writes) and lets you query it
  afterwards. It doesn't record every function call or value, and it can't step backwards through a program.

Full details: the [Rewind README](https://github.com/dangerousEnigma1827/Rewind#readme).

---

## License

The files in **this repository** (the demo program and this documentation) are MIT licensed: see [LICENSE](LICENSE).
The `demo/` files are unchanged copies from Rewind commit `1c34e77`. **Rewind itself is a separate project and is not
covered by this license.**
