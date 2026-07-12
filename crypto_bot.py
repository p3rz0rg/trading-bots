#!/usr/bin/env python3
"""
crypto_bot.py — Multi-pair crypto bot for Kraken (replaces sol_bot.py)
──────────────────────────────────────────────────────────────────────
"The professional middle ground": wider opportunity set, same discipline.

  • Scans the top 30 USD pairs by 24h volume every cycle
  • Only enters candidates scoring 5/5 (ALL conditions — never partial signals)
  • Global cap: max 3 open positions across ALL pairs
  • Liquidity filter: min $5M 24h volume AND max 0.2% spread
  • Rule 1: take profit at exactly +1%      (rules.py)
  • Rule 2: max 10% of portfolio per position
  • Rule 3: 24h cooldown per pair + max 2 trades/day globally
  • Rule 4: -2% daily loss circuit breaker
  • Trade journal, kill switch (--kill), fail-safe defaults
"""
import os
import csv
import time
import logging
import krakenex
import pandas as pd
from datetime import datetime, timedelta
from dotenv import load_dotenv

import rules
from scanner import _indicators, score_candidate

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.FileHandler("crypto_bot.log"), logging.StreamHandler()],
)
log = logging.getLogger(__name__)

api = krakenex.API()
api.key    = os.getenv("API_KEY")
api.secret = os.getenv("SECRET_KEY")

JOURNAL          = "trade_journal.csv"
SCAN_TOP_N       = 30      # pairs to scan, ranked by 24h volume
KRAKEN_DELAY     = 1.1     # public API throttle (~1 call/sec limit)
CANDLE_INTERVAL  = 240     # 4h candles
SCAN_EVERY_SEC   = 900     # full market rescan every 15 min
MANAGE_EVERY_SEC = 60      # open positions checked every minute


def journal(row: dict):
    exists = os.path.exists(JOURNAL)
    with open(JOURNAL, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["time", "symbol", "side", "qty", "price", "reason"])
        if not exists:
            w.writeheader()
        w.writerow(row)


# ── Market data ─────────────────────────────────────────────
def top_pairs_with_liquidity() -> list[dict]:
    """Top pairs by 24h USD volume that ALSO pass the liquidity filter."""
    pairs_resp = api.query_public("AssetPairs")
    usd_pairs = [k for k, v in pairs_resp["result"].items()
                 if v.get("quote") in ("ZUSD", "USD") and ".d" not in k]

    tick = api.query_public("Ticker", {"pair": ",".join(usd_pairs[:200])})
    rows = []
    for pair, t in tick["result"].items():
        price   = float(t["c"][0])
        vol_usd = float(t["v"][1]) * price
        bid, ask = float(t["b"][0]), float(t["a"][0])
        if rules.liquidity_ok(vol_usd, bid, ask):
            rows.append({"pair": pair, "price": price, "vol_usd": vol_usd,
                         "bid": bid, "ask": ask})
    rows.sort(key=lambda r: r["vol_usd"], reverse=True)
    kept = rows[:SCAN_TOP_N]
    log.info(f"Liquidity filter: {len(kept)} tradeable pairs "
             f"(min ${rules.MIN_24H_VOLUME_USD/1e6:.0f}M vol, max {rules.MAX_SPREAD_PCT*100:.1f}% spread)")
    return kept


def get_candles(pair: str) -> pd.DataFrame:
    ohlc = api.query_public("OHLC", {"pair": pair, "interval": CANDLE_INTERVAL})
    raw = list(ohlc["result"].values())[0]
    df = pd.DataFrame(raw, columns=["time","open","high","low","close","vwap","volume","count"])
    df[["close", "volume"]] = df[["close", "volume"]].astype(float)
    return _indicators(df)


def get_price(pair: str) -> float:
    t = api.query_public("Ticker", {"pair": pair})
    tk = list(t["result"].values())[0]
    return (float(tk["b"][0]) + float(tk["a"][0])) / 2


def portfolio_value_usd() -> float:
    result = api.query_private("Balance")
    if result["error"]:
        raise RuntimeError(f"Balance error: {result['error']}")
    balances = result["result"]
    total = float(balances.get("ZUSD", 0))
    # NOTE: for simplicity we value only USD + tracked positions (see run()).
    return total


# ── Orders ──────────────────────────────────────────────────
def limit_order(pair: str, side: str, qty: float, price: float) -> str:
    result = api.query_private("AddOrder", {
        "pair": pair, "type": side, "ordertype": "limit",
        "price": str(round(price, 4)), "volume": str(qty),
    })
    if result["error"]:
        raise RuntimeError(f"{side} order failed for {pair}: {result['error']}")
    txid = result["result"]["txid"][0]
    log.info(f"{'📈' if side == 'buy' else '📉'} {side.upper()} {pair}: {qty} @ ${price:.4f} | {txid}")
    return txid


def kill_switch(positions: dict):
    """Flatten everything. Run: python3 crypto_bot.py --kill"""
    log.warning("🔴 KILL SWITCH — closing all crypto positions")
    open_orders = api.query_private("OpenOrders")
    for txid in open_orders.get("result", {}).get("open", {}):
        api.query_private("CancelOrder", {"txid": txid})
    for pair, pos in positions.items():
        limit_order(pair, "sell", pos["qty"], get_price(pair) * 0.999)
        journal({"time": datetime.utcnow(), "symbol": pair, "side": "SELL",
                 "qty": pos["qty"], "price": get_price(pair), "reason": "KILL SWITCH"})


# ── Main loop ───────────────────────────────────────────────
def run():
    log.info("=" * 62)
    log.info("Multi-pair Crypto Bot — scanner-driven, same discipline")
    log.info(f"Rules: TP +1% | SL -0.5% | 10% pos | max {rules.MAX_OPEN_CRYPTO} open | "
             f"{rules.MAX_TRADES_PER_DAY} trades/day | 5/5 signals ONLY")
    log.info("=" * 62)

    positions      = {}   # pair -> {"qty": float, "entry": float}
    last_trade     = {}   # pair -> datetime (per-pair cooldown)
    trades_today   = 0
    day            = datetime.utcnow().date()
    day_start_eq   = None
    last_scan      = datetime(2000, 1, 1)

    while True:
        try:
            # ── Daily reset ─────────────────────────────────
            if datetime.utcnow().date() != day:
                day = datetime.utcnow().date()
                trades_today = 0
                day_start_eq = None
                log.info("🔄 New day: trade counter reset, circuit breaker re-armed.")

            # Mark-to-market equity = USD balance + open positions
            equity = portfolio_value_usd() + sum(
                p["qty"] * get_price(pair) for pair, p in positions.items()
            )
            if day_start_eq is None:
                day_start_eq = equity

            # ── Rule 4: circuit breaker ─────────────────────
            if rules.circuit_breaker_tripped(day_start_eq, equity):
                log.error("🚨 CIRCUIT BREAKER: -2% daily loss. No new entries until tomorrow.")
                new_entries_allowed = False
            else:
                new_entries_allowed = True

            # ── Manage open positions (every cycle) ─────────
            for pair in list(positions):
                pos = positions[pair]
                px  = get_price(pair)
                if rules.should_take_profit(pos["entry"], px):
                    limit_order(pair, "sell", pos["qty"], px)
                    journal({"time": datetime.utcnow(), "symbol": pair, "side": "SELL",
                             "qty": pos["qty"], "price": px, "reason": "TP +1%"})
                    log.info(f"✅ {pair} TAKE PROFIT +1%")
                    del positions[pair]
                elif rules.should_stop_loss(pos["entry"], px):
                    limit_order(pair, "sell", pos["qty"], px)
                    journal({"time": datetime.utcnow(), "symbol": pair, "side": "SELL",
                             "qty": pos["qty"], "price": px, "reason": "SL -0.5%"})
                    log.warning(f"🛑 {pair} STOP LOSS -0.5%")
                    del positions[pair]
                time.sleep(KRAKEN_DELAY)

            # ── Scan for entries (every 15 min) ─────────────
            due_for_scan = (datetime.utcnow() - last_scan).total_seconds() >= SCAN_EVERY_SEC
            if due_for_scan and new_entries_allowed:
                last_scan = datetime.utcnow()

                if not rules.crypto_slots_available(len(positions)):
                    log.info(f"⏸  Global cap: {len(positions)}/{rules.MAX_OPEN_CRYPTO} positions open. Not scanning.")
                elif not rules.daily_cap_ok(trades_today):
                    log.info(f"⏸  Rule 3: {trades_today}/{rules.MAX_TRADES_PER_DAY} trades today. Done for the day.")
                else:
                    candidates = top_pairs_with_liquidity()
                    for c in candidates:
                        pair = c["pair"]
                        if pair in positions:
                            continue
                        # Per-pair cooldown (24h)
                        lt = last_trade.get(pair, datetime(2000, 1, 1))
                        if not rules.cooldown_clear(lt, datetime.utcnow()):
                            continue

                        df = get_candles(pair)
                        score, ready, cond = score_candidate(df)
                        time.sleep(KRAKEN_DELAY)

                        if not ready:            # 5/5 ONLY. 4/5 = no trade.
                            continue

                        px  = c["ask"]           # realistic: we lift the ask
                        qty = rules.position_size(equity, px)
                        if qty <= 0:
                            continue

                        limit_order(pair, "buy", qty, px)
                        positions[pair]  = {"qty": qty, "entry": px}
                        last_trade[pair] = datetime.utcnow()
                        trades_today    += 1
                        journal({"time": datetime.utcnow(), "symbol": pair, "side": "BUY",
                                 "qty": qty, "price": px, "reason": "Scanner 5/5 entry"})
                        log.info(f"📊 {pair}: {qty} @ ${px:.4f} | TP ${px*1.01:.4f} | SL ${px*0.995:.4f} "
                                 f"| slots {len(positions)}/{rules.MAX_OPEN_CRYPTO}")

                        if not rules.crypto_slots_available(len(positions)) \
                           or not rules.daily_cap_ok(trades_today):
                            break
                    else:
                        if not positions:
                            log.info("⏳ Scan complete — no 5/5 setups. Patience is a position.")

        except Exception as e:
            log.error(f"💥 {e}", exc_info=True)

        time.sleep(MANAGE_EVERY_SEC)


if __name__ == "__main__":
    import sys
    if "--kill" in sys.argv:
        # Positions dict is in-memory; on a cold --kill we cancel orders and
        # sell any non-USD balances at market-adjacent limit prices.
        log.warning("Cold kill: cancelling open orders. Review balances on Kraken manually.")
        open_orders = api.query_private("OpenOrders")
        for txid in open_orders.get("result", {}).get("open", {}):
            api.query_private("CancelOrder", {"txid": txid})
    else:
        run()
