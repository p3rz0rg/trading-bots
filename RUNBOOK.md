# RUNBOOK — Day-to-Day Operation

Short operating guide. Full setup instructions are in README.md.

## What's automatic
Once a bot is running: fetching prices, checking signals, entries, +1% take profits, -0.5% stops, cooldowns, the 10% position cap, the -2% daily circuit breaker, and the trade journal. With systemd (Linux) or launchd (Mac), it also restarts after crashes and reboots.

## What's manual
First-time setup, starting the bots, restarting after code or `.env` changes, the weekly journal review, and the decision to go live. The scanner never trades on its own.

## Starting a session
```bash
cd ~/trading-bots
source venv/bin/activate
python3 test_bots.py
```
Tests must end with `Ran 38 tests ... OK`. Then start each bot in its own terminal:
```bash
python3 crypto_bot.py
```
```bash
python3 etf_bot.py
```
Check that the first log lines say `PAPER MODE` unless you've deliberately gone live.

## Daily (2 minutes)
- Linux: `sudo systemctl status cryptobot etfbot`
- Mac: `launchctl list | grep bot`
- Check the latest log lines for errors: `tail -n 30 crypto_bot.log`

## Weekly (15 minutes)
Open `trade_journal.csv`. Compare the win rate, and the number of stops versus take profits, with the backtest. If reality differs a lot, pause and investigate. Don't change settings while a bot is running.

## Emergency
- Stop a bot: Ctrl+C, or `sudo systemctl stop cryptobot` (Linux), or `launchctl unload ~/Library/LaunchAgents/com.cryptobot.plist` (Mac).
- Close all ETF positions: `python3 etf_bot.py --kill`
- Crypto in live mode: `python3 crypto_bot.py --kill` cancels open orders. Then check your balances on Kraken and sell manually if needed.

## Going live (only after 90 days of paper trading)
1. Create live keys. Alpaca live keys start with `AK`; for Kraken, see "Getting your API keys" in the README.
2. Put them in `.env` and set `PAPER=false`.
3. Start with a small amount.
4. Restart the bots and confirm the log says `LIVE MODE`.

Golden rule: if you don't understand why the bot did something, stop it first and investigate second.
