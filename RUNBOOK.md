# RUNBOOK — Running Everything on Linux & Mac

## Is it automatic?
**Once started, yes:** price fetching, signal checks, entries, 1% take-profits, 0.5% stops, cooldowns, the 10% position cap, the -2% daily circuit breaker, trade journaling, and (with step 5 below) crash/reboot recovery.
**Still manual:** one-time setup, the first start, restarting after code edits, weekly journal review, and the go-live decision. The scanner is on-demand only — it never auto-trades.

## 1. Prerequisites
**Linux:** `sudo apt update && sudo apt install python3 python3-pip python3-venv git nodejs npm -y`
**Mac:** install [Homebrew](https://brew.sh), then `brew install python node git`
Need Python 3.10+ and Node 18+.

## 2. Setup (identical on both)
```bash
git clone https://github.com/YOUR_USERNAME/trading-bots.git
cd trading-bots
python3 -m venv venv
source venv/bin/activate
pip install pandas numpy python-dotenv krakenex alpaca-py
cp .env.example .env && nano .env    # add keys, keep PAPER=true
```

## 3. Verify before starting anything
```bash
python3 test_bots.py                 # must print: Ran 38 tests ... OK
python3 backtest.py --demo
python3 scanner.py --market crypto   # no keys needed
```

## 4. Run the bots
```bash
python3 crypto_bot.py     # terminal 1
python3 etf_bot.py        # terminal 2
python3 etf_bot.py --kill # EMERGENCY: flatten all ETF positions
```

## 5. Always-on / auto-restart
**Linux (systemd):** see README "systemd" section — `Restart=always` handles crashes and `enable` handles reboots.
**Mac (launchd):** create `~/Library/LaunchAgents/com.cryptobot.plist` with `KeepAlive=true` and `RunAtLoad=true`, pointing ProgramArguments at `venv/bin/python3` + `crypto_bot.py`, then `launchctl load` it. Disable sleep: `sudo pmset -a sleep 0`.

## 6. Dashboard
```bash
npm create vite@latest bot-dashboard -- --template react
cd bot-dashboard && npm install && npm install recharts
cp ../trading-bots/dashboard.jsx src/App.jsx
npm run dev                          # open http://localhost:5173
```

## 7. Operator routine
- **Daily (2 min):** bots running? errors in logs?
- **Weekly (15 min):** review `trade_journal.csv` vs backtest expectations.
- **Day 90:** if paper results match design → `PAPER=false`, live keys, small size.
- **Golden rule:** don't understand a trade? Stop first, investigate second.
