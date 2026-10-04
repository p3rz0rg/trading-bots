/


Readme · MD
Trading Bots — Multi-Pair Crypto (Kraken) + ETF (Alpaca)

Two rule-based trading bots with a market scanner, backtesting engine, unit tests, and a React dashboard.

    Not financial advice. Backtests are simulations. Paper trade for at least 90 days before using real money, and never trade money you can't afford to lose.

Contents

    How the system fits together
    The rules
    Files
    Paper vs live mode
    Getting your API keys
    Installation on Linux
    Installation on Mac
    Running the dashboard
    Putting it on GitHub
    API costs
    Market scanner
    Troubleshooting
    Best practices
    Changelog

How the system fits together

    rules.py is the single source of truth. Every risk rule is a pure, tested function. Both bots import it, and neither can bypass it.
    scanner.py scores symbols 0–5 against the entry conditions. It's a standalone tool and also the engine inside the crypto bot.
    crypto_bot.py trades on Kraken. Every 15 minutes it takes the top 30 USD pairs by volume, drops any that fail the liquidity filter, and enters only 5/5 scores, with at most 3 positions open across all pairs.
    etf_bot.py trades on Alpaca: a fixed universe of 6 ETFs with a VIX risk filter and Pattern Day Trader protection.
    backtest.py tests the strategy on historical data, including fees and slippage.
    dashboard.jsx shows everything in the browser. trade_journal.csv records every trade from both bots.

The rules
#	Rule	Value
1	Take profit	Exit at +1%
2	Position size	Max 10% of the portfolio per position
3	No overtrading	Crypto: max 2 trades/day, 24h cooldown per pair, max 3 open positions. ETF: 2-day cooldown per symbol, max 4 open positions
4	Circuit breaker	No new entries for the rest of the day after a -2% daily loss
5	Signal quality	Crypto enters only on 5/5 conditions; 4/5 is not a trade
6	Liquidity	Crypto pairs need $5M+ 24h volume and a spread of 0.2% or less

Also built in: a 0.5% stop loss (2:1 reward to risk), a VIX filter for ETFs (no entries at 25+, halve positions at 30+, all cash at 40+), a Pattern Day Trader guard, the trade journal, and a kill switch.
Files

trading-bots/
├── .env.example      # Template for your keys (copy to .env)
├── .gitignore        # Keeps .env, logs and the journal off GitHub
├── README.md         # This file
├── RUNBOOK.md        # Short day-to-day operating guide
├── rules.py          # All risk rules (pure logic, fully tested)
├── crypto_bot.py     # Multi-pair Kraken bot, scanner-driven
├── etf_bot.py        # Alpaca ETF bot (SPY, QQQ, IWM, XLK, XLV, XLE)
├── scanner.py        # Market scanner: top 30 Kraken pairs / 20 liquid ETFs
├── backtest.py       # Backtesting engine with fees and slippage
├── test_bots.py      # 38 unit tests
└── dashboard.jsx     # React dashboard

Files created while running (never commit these): .env, trade_journal.csv, *.log, *.out, venv/.
Paper vs live mode

Both bots read PAPER from .env, and it defaults to true.
	PAPER=true (default)	PAPER=false
ETF bot	Uses Alpaca's paper account with fake money. Needs paper keys (start with PK).	Real money. Needs live keys (start with AK).
Crypto bot	Kraken has no paper account, so the bot simulates fills locally: real prices and signals, nothing sent to Kraken. No keys needed. Starting balance is $10,000 (change with PAPER_START_EQUITY=).	Real orders on Kraken with your real balance.

The bot prints which mode it's in at startup. If you ever see ⚠️ LIVE MODE when you didn't expect it, press Ctrl+C immediately.

Note: in crypto paper mode the simulated balance resets every time the bot restarts. The trade journal keeps the full history.
Getting your API keys

You only need keys for the bot you're running.
Kraken (crypto bot, live mode only)

    Log in at kraken.com → Settings → API → Create API key.
    Permissions: tick Query Funds and Create & Modify Orders only. Never tick Withdraw.
    Copy the API Key and the Private Key. The Private Key is about 88 characters and often ends in ==. It's shown only once.

Alpaca (ETF bot and stock scanner)

    Log in at alpaca.markets and switch to the Paper Trading account (top left).
    Use the Trading API, not the Broker API. The Broker API is for companies building their own brokerage apps.
    On the dashboard, find the API Keys panel → Generate New Keys.
    Copy the Key (starts with PK for paper) and the Secret. The Secret is shown only once.

Your .env file
bash

cp .env.example .env
nano .env

KRAKEN_API_KEY=your-kraken-api-key
KRAKEN_SECRET_KEY=your-kraken-private-key
ALPACA_API_KEY=PKxxxxxxxxxxxxxxxx
ALPACA_SECRET_KEY=your-alpaca-secret
PAPER=true

    Kraken and Alpaca use separate variables. Don't put Alpaca keys in the Kraken lines.
    No quotes and no spaces around =.
    Save in nano with Ctrl+X → Y → Enter.

Installation on Linux

Tested on Ubuntu, Debian and Raspberry Pi OS.

1. Install the tools
bash

sudo apt update
sudo apt install python3 python3-pip python3-venv git -y
python3 --version

You need Python 3.10 or newer.

2. Get the code
bash

cd ~
git clone https://github.com/YOUR_USERNAME/trading-bots.git
cd trading-bots

Replace YOUR_USERNAME with your real GitHub username. Or unzip the download into your home folder and cd ~/trading-bots.

3. Virtual environment and libraries
bash

python3 -m venv venv
source venv/bin/activate
pip install pandas numpy python-dotenv krakenex alpaca-py pytest

In every new terminal, run cd ~/trading-bots && source venv/bin/activate first.

4. Add your keys (see Getting your API keys)

5. Verify — run each command separately:
bash

python3 test_bots.py

It must end with Ran 38 tests ... OK.
bash

python3 backtest.py --demo
python3 scanner.py --market crypto

6. Start the bots, each in its own terminal:
bash

python3 crypto_bot.py

bash

python3 etf_bot.py

Stop a bot with Ctrl+C. Emergency exit for all ETF positions: python3 etf_bot.py --kill.

7. Run 24/7 with systemd (optional)

Create a service for the crypto bot:
bash

sudo nano /etc/systemd/system/cryptobot.service

Paste this, replacing YOUR_USERNAME (find it with whoami):
ini

[Unit]
Description=Crypto Trading Bot
After=network-online.target

[Service]
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/trading-bots
ExecStart=/home/YOUR_USERNAME/trading-bots/venv/bin/python3 crypto_bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target

Start it and make it start on boot:
bash

sudo systemctl daemon-reload
sudo systemctl enable --now cryptobot

Repeat with etfbot.service and etf_bot.py for the ETF bot.

Daily commands:
bash

sudo systemctl status cryptobot
sudo journalctl -u cryptobot -f
sudo systemctl restart cryptobot
sudo systemctl stop cryptobot

Restart the service after every code or .env change.
Installation on Mac

Works on Apple Silicon (M1–M4) and Intel Macs, macOS 12 or newer. All commands go in the Terminal app (Cmd+Space → type "Terminal").
Step 1 — Install Homebrew
bash

/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

At the end, Homebrew prints "Next steps" commands to add it to your PATH. Copy and run them. On Apple Silicon they look like:
bash

echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"

If macOS asks to install "Command Line Developer Tools", click Install and wait.
Step 2 — Allow comments in pasted commands

The Mac Terminal (zsh) treats # as normal text by default, so a pasted line like python3 test_bots.py  # note breaks. Turn comment support on once:
bash

echo 'setopt interactivecomments' >> ~/.zshrc
source ~/.zshrc

Step 3 — Install Python, Node.js and git
bash

brew install python node git

Check the versions:
bash

$(brew --prefix)/bin/python3 --version
node --version

Python should be 3.12 or newer and Node 18 or newer. Always type python3, not python.
Step 4 — Get the code
bash

cd ~
git clone https://github.com/YOUR_USERNAME/trading-bots.git
cd trading-bots

Or unzip the download into your home folder and cd ~/trading-bots.
Step 5 — Virtual environment and libraries

Create the venv with Homebrew's Python, not the old Python 3.9 that comes with Apple's developer tools:
bash

$(brew --prefix)/bin/python3 -m venv venv
source venv/bin/activate
python3 --version
pip install pandas numpy python-dotenv krakenex alpaca-py pytest

Your prompt now starts with (venv). In every new Terminal window, run cd ~/trading-bots && source venv/bin/activate first.

If python3 --version inside the venv says 3.9, rebuild it:
bash

deactivate
rm -rf venv
$(brew --prefix)/bin/python3 -m venv venv
source venv/bin/activate
pip install pandas numpy python-dotenv krakenex alpaca-py pytest

Step 6 — Add your keys

See Getting your API keys. Finder hides .env; press Cmd+Shift+. to show hidden files.
Step 7 — Verify, then run

Run these one at a time:
bash

python3 test_bots.py

It must end with Ran 38 tests ... OK.
bash

python3 backtest.py --demo
python3 scanner.py --market crypto
python3 crypto_bot.py

For the ETF bot, open a new tab (Cmd+T):
bash

cd ~/trading-bots && source venv/bin/activate
python3 etf_bot.py

Step 8 — Keep the Mac awake

A sleeping Mac stops the bot. Either run the bot with caffeinate, which keeps the Mac awake only while it runs:
bash

caffeinate -i python3 crypto_bot.py

Or stop the Mac sleeping while it's plugged in:
bash

sudo pmset -c sleep 0

Step 9 — Auto-start with launchd (optional)

Create the file:
bash

nano ~/Library/LaunchAgents/com.cryptobot.plist

Paste this, replacing YOURUSERNAME (find it with whoami):
xml

<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cryptobot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/YOURUSERNAME/trading-bots/venv/bin/python3</string>
    <string>crypto_bot.py</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOURUSERNAME/trading-bots</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOURUSERNAME/trading-bots/crypto_bot.out</string>
  <key>StandardErrorPath</key><string>/Users/YOURUSERNAME/trading-bots/crypto_bot.out</string>
</dict>
</plist>

Commands:
bash

launchctl load ~/Library/LaunchAgents/com.cryptobot.plist
launchctl list | grep cryptobot
tail -f ~/trading-bots/crypto_bot.log
launchctl unload ~/Library/LaunchAgents/com.cryptobot.plist

These start the bot (and auto-start it at login), check it's running, watch the log, and stop it. Repeat with com.etfbot.plist and etf_bot.py for the ETF bot. After any code or .env change, unload and load again.
Running the dashboard

The dashboard is a React app. You need Node.js 18+ (Mac: installed in Step 3; Linux: below).

Linux only — install Node.js:
bash

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs -y
node --version

Both systems:
bash

cd ~
npm create vite@latest bot-dashboard -- --template react
cd bot-dashboard
npm install
npm install recharts
cp ~/trading-bots/dashboard.jsx src/App.jsx
npm run dev

Open http://localhost:5173.

To view it from your phone on the same Wi-Fi, run npm run dev -- --host and visit http://YOUR_COMPUTER_IP:5173. Find the IP with ipconfig getifaddr en0 (Mac) or hostname -I (Linux).

The dashboard currently shows illustrative example data. It isn't yet connected to trade_journal.csv.
Putting it on GitHub
First time

    Create an empty repo at github.com/new named trading-bots. Choose Private, and do not tick "Add a README".
    Create a token: GitHub → profile picture → Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic). Tick repo, generate, and copy the ghp_... token right away.
    Push, replacing YOUR_USERNAME with your real username:

bash

cd ~/trading-bots
git init
git add .
git status
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/trading-bots.git
git push -u origin main

When asked, the username is your GitHub username and the password is the token. Nothing appears on screen while you paste it; just press Enter.

Before committing, check git status. If .env or trade_journal.csv is in the list, stop: the .gitignore file is missing. Copy it from the zip first.
Updating with a new version
bash

cd ~/trading-bots
git add -A
git commit -m "Describe what changed"
git push

If you pushed your .env by accident

Revoke those keys on Kraken and Alpaca immediately and create new ones. Deleting the file from GitHub isn't enough, because it stays in the history.
API costs

Kraken: $0. The scanner and crypto paper mode use only Kraken's free public data. Kraken charges only when a real order fills: 0.16% maker / 0.26% taker.

Alpaca: $0 on the default Basic plan. It includes about 200 API calls per minute and real-time IEX data. The stock scanner uses one batched request for all 20 ETFs. US stock and ETF trades are commission-free (small regulatory fees may apply on sells). The paid plan (about $99/month) adds full-market data and isn't needed for this strategy.
Market scanner

Scores a wider universe than the bots' watchlists, 0–5 by how many entry conditions pass.
bash

python3 scanner.py --market crypto
python3 scanner.py --market stocks

crypto scans the top 30 Kraken USD pairs and needs no keys. stocks scans 20 liquid ETFs and needs your Alpaca keys.

🟢 READY means all 5 conditions are met. 🟡 n/5 is watchlist only — never trade partial signals. The scanner on its own never places trades.
Troubleshooting
Error	Cause and fix
unittest.loader._FailedTest / module '__main__' has no attribute '#'	You pasted a command with a # comment on a Mac. Enable comments (Mac Step 2) or run the command without the comment.
scanner.py: error: unrecognized arguments: # no keys needed	Same cause as above.
Invalid base64-encoded string	The Kraken secret is wrong. Use the Kraken Private Key in KRAKEN_SECRET_KEY, not an Alpaca secret, with no quotes or spaces. The bot now catches this at startup with a clear message.
KRAKEN_API_KEY / KRAKEN_SECRET_KEY missing	You're in live mode without Kraken keys. Add them, or set PAPER=true.
Alpaca unauthorized / forbidden	Paper keys with PAPER=false (or the reverse), or a typo. Paper keys start with PK.
NotOpenSSLWarning ... LibreSSL	Your venv uses Apple's old Python 3.9. Rebuild it with Homebrew Python (Mac Step 5).
ModuleNotFoundError	The venv isn't active. Run source venv/bin/activate.
command not found: brew	Run Homebrew's PATH commands from Mac Step 1, then open a new Terminal.
command not found: python	Use python3.
Password authentication is not supported	GitHub needs a token, not your password. See Putting it on GitHub.
Repository not found / URL contains YOUR_USERNAME	Replace YOUR_USERNAME with your real username: git remote set-url origin https://github.com/REALNAME/trading-bots.git
cd: no such file or directory: trading-bots	The clone failed, so the folder doesn't exist. Fix the clone error first.
Bot stops overnight	The computer slept. See Mac Step 8, or use systemd on Linux.
Best practices

    Daily loss circuit breaker — per-trade stops don't protect you from ten losses in a row.
    Fees and slippage in backtests — ignoring them is the most common way backtests mislead. The demo run on random data loses 0.55%, which is realistic.
    Know your edge after fees — a +1% take profit nets roughly +0.5% on Kraken after taker fees both ways. Losses cost more than 0.5% for the same reason.
    Kill switch — python3 etf_bot.py --kill closes all ETF positions immediately.
    Trade journal — every trade goes to trade_journal.csv, for taxes and honest review.
    Fail-safe defaults — if the VIX feed fails, the ETF bot assumes danger and stops entering.
    Limit orders — cheaper maker fees and less slippage on entries.
    Paper trade 90 days — both bots default to PAPER=true.
    Avoid overfitting — tuning parameters until the backtest looks perfect fits noise, not markets. Test on data the strategy hasn't seen.
    Withdraw permission off — trading keys should never be able to move money out.
    Alerting — send errors somewhere you'll see them. A silently crashed bot with open positions is the worst case.

Changelog

v3.1

    Kraken and Alpaca keys now use separate variables: KRAKEN_API_KEY, KRAKEN_SECRET_KEY, ALPACA_API_KEY, ALPACA_SECRET_KEY. Update your .env.
    The crypto bot now has a real paper mode. With PAPER=true it simulates fills and sends nothing to Kraken. Previously it ignored PAPER and would have placed real orders.
    The crypto bot checks the Kraken key at startup and explains what's wrong instead of crashing.
    Mac instructions: zsh comment setting, Homebrew Python for the venv, one-command-at-a-time verification.
    New troubleshooting table covering every error reported so far.

v3.0

    crypto_bot.py replaces sol_bot.py: scans the top 30 pairs and trades only 5/5 signals, with a global cap of 3 positions and a liquidity filter.
    Rebuilt multi-pair dashboard. 38 tests.

Disclaimer

Not financial advice. Backtests are simulations; live markets include outages, partial fills, and regime changes no simulation captures. Never trade money you can't afford to lose.
