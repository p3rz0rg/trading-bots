# Trading Bots — SOL (Kraken) + ETF (Alpaca)

Two rule-based trading bots with backtesting, a full test suite, and a React dashboard.

## The Rules (hard-coded, enforced everywhere)

| # | Rule | Value |
|---|------|-------|
| 1 | Take profit | Exit at exactly **+1%** |
| 2 | Position size | Max **10%** of portfolio per position |
| 3 | No overtrading | SOL: 24h cooldown + max 2 trades/day. ETF: 2-day cooldown per symbol + max 4 open positions |
| 4 | Circuit breaker | Bot **halts** for the day at **-2%** daily loss |

Plus: 0.5% stop loss (2:1 reward:risk), VIX regime filter for ETFs (no entries ≥25, halve ≥30, cash ≥40), Pattern Day Trader guard, trade journal CSV, kill switch.

## Files

```
trading-bots/
├── rules.py          # Shared strategy rules (pure logic, fully tested)
├── sol_bot.py        # SOL/USD bot for Kraken (4h candles)
├── etf_bot.py        # ETF bot for Alpaca (SPY, QQQ, IWM, XLK, XLV, XLE)
├── backtest.py       # Backtesting engine — models FEES and SLIPPAGE
├── test_bots.py      # 25 unit tests (all passing)
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
python3 backtest.py --csv sol_4h.csv --fee 0.0016 --slippage 0.0005

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
python3 etf_bot.py     # or: python3 sol_bot.py

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

```bash
# 1. One-time: create an empty repo at github.com/new (name it "trading-bots",
#    do NOT tick "add README"), then:

cd ~/trading-bots
git init
git add .
git commit -m "Initial commit: SOL + ETF bots with rules, tests, backtest, dashboard"
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

## Best Practices

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
