# Trading Bots — Multi-Pair Crypto (Kraken) + ETF (Alpaca)

Two rule-based trading bots with a market scanner, backtesting engine, full test suite, and a React dashboard.

**How the system fits together:**
1. **`rules.py`** is the single source of truth — every risk rule lives here as a pure, tested function. Both bots import it; neither can bypass it.
2. **`scanner.py`** finds opportunities: it scores symbols 0–5 against the entry conditions. Standalone tool AND the engine inside crypto_bot.
3. **`crypto_bot.py`** trades Kraken: every 15 min it takes the top 30 USD pairs by volume, drops anything failing the liquidity filter ($5M/day volume, 0.2% max spread), and enters ONLY 5/5 scores — max 3 open positions globally.
4. **`etf_bot.py`** trades Alpaca: fixed 6-ETF universe with VIX regime filtering and PDT protection.
5. **`backtest.py`** validates strategies on historical data with fees and slippage modeled.
6. **`dashboard.jsx`** visualizes it all; **`trade_journal.csv`** records every fill from both bots.

## The Rules (hard-coded, enforced everywhere)

| # | Rule | Value |
|---|------|-------|
| 1 | Take profit | Exit at exactly **+1%** |
| 2 | Position size | Max **10%** of portfolio per position |
| 3 | No overtrading | Crypto: 5/5 signals only, 24h per-pair cooldown, max 2 trades/day, global cap 3 positions, liquidity filter ($5M vol, 0.2% max spread). ETF: 2-day cooldown per symbol + max 4 open positions |
| 4 | Circuit breaker | Bot **halts** for the day at **-2%** daily loss |

Plus: 0.5% stop loss (2:1 reward:risk), VIX regime filter for ETFs (no entries ≥25, halve ≥30, cash ≥40), Pattern Day Trader guard, trade journal CSV, kill switch.

## Files

```
trading-bots/
├── rules.py          # Shared strategy rules (pure logic, fully tested)
├── crypto_bot.py     # Multi-pair Kraken bot — scanner-driven, top 30 by volume
├── etf_bot.py        # ETF bot for Alpaca (SPY, QQQ, IWM, XLK, XLV, XLE)
├── backtest.py       # Backtesting engine — models FEES and SLIPPAGE
├── scanner.py        # Market scanner — top 30 Kraken pairs / 20 liquid ETFs
├── test_bots.py      # 38 unit tests (all passing)
├── dashboard.jsx     # React dashboard (charts, signals, trade log)
└── README.md         # This file
```

---

## Quick Start (Linux)

```bash
# 1. Clone your repo (after you push it — see GitHub section below)
git clone https://github.com/YOUR_USERNAME/trading-bots.git
cd trading-bots

# 2. Virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install pandas numpy python-dotenv krakenex alpaca-py pytest

# 4. Run the tests FIRST — never trust untested trading code
python3 -m pytest test_bots.py -v

# 5. Run a demo backtest (synthetic data, no API keys needed)
python3 backtest.py --demo

# 6. Backtest on real historical data (export CSV from Kraken/Alpaca)
python3 backtest.py --csv btc_4h.csv   # any exported OHLCV CSV --fee 0.0016 --slippage 0.0005

# 7. Add your API keys
cp .env.example .env   # then edit .env with nano
```

`.env` contents:
```
API_KEY=your-key-here
SECRET_KEY=your-secret-here
PAPER=true
```

```bash
# 8. Run a bot (PAPER mode first — always!)
python3 etf_bot.py     # or: python3 crypto_bot.py

# Emergency: flatten everything
python3 etf_bot.py --kill
```

---

## Running the Dashboard on Linux (step by step)

The dashboard is a React app. Here's the complete beginner path:

### Step 1 — Install Node.js
```bash
# Ubuntu / Debian / Raspberry Pi OS
sudo apt update && sudo apt install nodejs npm -y

# Verify (need Node 18+)
node --version
```
If your distro ships an old Node, install a current one:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y
```

### Step 2 — Create a React app with Vite
```bash
cd ~
npm create vite@latest bot-dashboard -- --template react
cd bot-dashboard
npm install
npm install recharts
```

### Step 3 — Drop in the dashboard
```bash
# Copy dashboard.jsx over the default App.jsx
cp ~/trading-bots/dashboard.jsx src/App.jsx
```

### Step 4 — Run it
```bash
npm run dev
```
Open the URL it prints (usually `http://localhost:5173`) in your browser. Done.

### Step 5 (optional) — Keep it running 24/7 with systemd
```bash
sudo nano /etc/systemd/system/bot-dashboard.service
```
Paste (replace YOUR_USERNAME):
```ini
[Unit]
Description=Trading Bot Dashboard
After=network.target

[Service]
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/bot-dashboard
ExecStart=/usr/bin/npm run dev -- --host
Restart=always

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bot-dashboard
```
Now it's reachable from any device on your network at `http://YOUR_PC_IP:5173`.

---

## Putting This on Your GitHub (step by step)

I can't push to your account for you, but it's five commands:

```bash
# 1. One-time: create an empty repo at github.com/new (name it "trading-bots",
#    do NOT tick "add README"), then:

cd ~/trading-bots
git init
git add .
git commit -m "Initial commit: multi-pair crypto + ETF bots with rules, tests, backtest, dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/trading-bots.git
git push -u origin main
```

GitHub will ask you to log in — use a Personal Access Token (github.com → Settings → Developer settings → Tokens) as the password.

**CRITICAL — never commit your keys:**
```bash
echo ".env" >> .gitignore
echo "*.log" >> .gitignore
echo "trade_journal.csv" >> .gitignore
git add .gitignore && git commit -m "Ignore secrets and logs"
```
If you ever accidentally push a `.env`, revoke those API keys immediately and generate new ones. Assume they're compromised.

---

## API Costs — What the Scanner & Bots Actually Cost

**Kraken (crypto_bot + scanner --market crypto): $0.**
The scanner uses only Kraken's *public* endpoints (AssetPairs, Ticker, OHLC) — free, no API key needed, no subscription. The only limit is rate (~1 call/sec), which the code already throttles for. You pay Kraken nothing until a trade executes (0.16% maker / 0.26% taker on fills).

**Alpaca (etf_bot + scanner --market stocks): $0 on the Basic plan.**
Every Alpaca account includes the free Basic market-data plan: ~200 API calls/min, real-time quotes from the IEX exchange, and historical bars. Our stock scanner uses ONE batched request for the whole 20-ETF universe, so it barely dents the limit. Trading US stocks/ETFs is commission-free (regulatory fees of a few cents may apply on sells).

**When you'd ever pay:** Alpaca's paid plan (Algo Trader Plus, ~$99/mo) buys full-market (SIP) data instead of IEX-only and higher rate limits. For our strategy — daily bars, 1% targets, a handful of trades per week — the free tier is genuinely sufficient. Don't buy data you don't need.

**Bottom line:** running the scanner all day, every day, on both markets costs $0 in API fees. Your only trading costs are Kraken's fees on filled crypto orders.

## Market Scanner

Sweeps a wider universe than the bots' fixed watchlists and ranks setups by signal quality (0–5 conditions met). Rate-limit aware: Kraken calls are throttled to ~1/sec; Alpaca uses one batched request.

```bash
python3 scanner.py --market crypto   # top 30 Kraken USD pairs by volume (no keys needed)
python3 scanner.py --market stocks   # 20 liquid ETFs via Alpaca (needs .env keys)
```

Output: 🟢 READY = all 5 conditions met. 🟡 n/5 = watchlist only — **never trade partial signals**.

To feed scanner picks into the ETF bot, replace its `UNIVERSE` list with ready symbols from `scanner.scan_stocks()`. Keep Rule 3 intact: scanning more symbols must never mean taking more trades — the cooldowns and position caps still apply.

## Best Practices You Asked About (the ones people forget)

1. **Daily loss circuit breaker** — implemented. Per-trade stops don't protect you from 10 losses in a row.
2. **Fees + slippage in backtests** — implemented. Ignoring them is the #1 way retail backtests lie. Note our demo run on random data *loses* 0.55% — that's realistic.
3. **Kill switch** — `python3 etf_bot.py --kill` flattens everything instantly.
4. **Trade journal** — every trade logged to `trade_journal.csv`. You need this for taxes and for honest strategy review.
5. **Fail-safe defaults** — if the VIX feed fails, the bot assumes danger and stops entering, rather than assuming safety.
6. **Limit orders, not market orders** — maker fees are cheaper and you avoid slippage on entries.
7. **Paper trade 90 days minimum** — no exceptions. Both bots default to `PAPER=true`.
8. **Beware overfitting** — if you tune parameters until the backtest looks perfect, you've fit noise, not markets. Test on data the strategy has never seen (walk-forward testing).
9. **Withdraw-permission OFF on API keys** — trading keys should never be able to move money out.
10. **Alerting** — pipe your logs somewhere you'll see them (e.g., a Telegram bot or email on ERROR). A silently-crashed bot with open positions is the nightmare scenario.

## Disclaimer

Not financial advice. Backtests are simulations; live markets include outages, partial fills, and regime changes no simulation captures. Never trade money you can't afford to lose.
