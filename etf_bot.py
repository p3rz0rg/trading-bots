#!/usr/bin/env python3
"""
ETF Trading Bot — Alpaca (SPY, QQQ, IWM, XLK, XLV, XLE)
──────────────────────────────────────────────────────
RULES (enforced via rules.py):
  Rule 1 → Take profit at +1%
  Rule 2 → Max 10% of portfolio per position
  Rule 3 → No overtrading: 2-day cooldown per ETF, max 4 open positions
  Rule 4 → Daily loss circuit breaker at -2%
Extra safety: VIX regime filter, Pattern Day Trader guard, trade journal CSV.
"""
import os
import csv
import time
import logging
from datetime import datetime, timedelta
from dotenv import load_dotenv
import pandas as pd

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest
from alpaca.data.timeframe import TimeFrame

import rules

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[logging.FileHandler("etf_bot.log"), logging.StreamHandler()],
)
log = logging.getLogger(__name__)

PAPER    = os.getenv("PAPER", "true").lower() == "true"
UNIVERSE = ["SPY", "QQQ", "IWM", "XLK", "XLV", "XLE"]
JOURNAL  = "trade_journal.csv"

trading = TradingClient(os.getenv("API_KEY"), os.getenv("SECRET_KEY"), paper=PAPER)
data    = StockHistoricalDataClient(os.getenv("API_KEY"), os.getenv("SECRET_KEY"))


# ── Helpers ─────────────────────────────────────────────────
def journal(row: dict):
    """Trade journal for taxes + strategy review. Never skip this."""
    exists = os.path.exists(JOURNAL)
    with open(JOURNAL, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["time","symbol","side","qty","price","reason"])
        if not exists:
            w.writeheader()
        w.writerow(row)


def get_bars(symbol: str, days: int = 120) -> pd.DataFrame:
    req = StockBarsRequest(
        symbol_or_symbols=symbol,
        timeframe=TimeFrame.Day,
        start=datetime.utcnow() - timedelta(days=days * 2),
    )
    bars = data.get_stock_bars(req).df
    df = bars.xs(symbol).reset_index() if symbol in bars.index.get_level_values(0) else bars.reset_index()
    return df.tail(days).reset_index(drop=True)


def indicators(df: pd.DataFrame) -> pd.DataFrame:
    df["ema21"] = df["close"].ewm(span=21, adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    delta = df["close"].diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, float("nan")))
    return df


def get_vix() -> float:
    """Fetch VIX proxy. Fallback: assume elevated (fail-safe = trade less)."""
    try:
        df = get_bars("VIXY", days=5)  # VIX ETF proxy via Alpaca data
        # Rough mapping; replace with a real VIX feed if you have one.
        return float(df.iloc[-1]["close"])
    except Exception:
        log.warning("VIX fetch failed — assuming 26 (no-entry regime, fail-safe)")
        return 26.0


def rel_strength_vs_spy(df: pd.DataFrame, spy: pd.DataFrame, lookback: int = 20) -> float:
    r_sym = df["close"].iloc[-1] / df["close"].iloc[-lookback] - 1
    r_spy = spy["close"].iloc[-1] / spy["close"].iloc[-lookback] - 1
    return r_sym - r_spy


def pdt_guard() -> bool:
    """Pattern Day Trader rule: <$25k equity → limit day trades."""
    acct = trading.get_account()
    if float(acct.equity) < 25_000 and int(acct.daytrade_count) >= 3:
        log.warning("PDT guard: 3 day-trades used this window. No new day trades.")
        return False
    return True


def kill_switch():
    """Flatten everything and stop. Run: python etf_bot.py --kill"""
    log.warning("🔴 KILL SWITCH — closing all positions and cancelling orders")
    trading.cancel_orders()
    trading.close_all_positions(cancel_orders=True)


# ── Main loop ───────────────────────────────────────────────
def run():
    log.info(f"ETF Bot starting | {'PAPER' if PAPER else '⚠️ LIVE'} | Universe: {UNIVERSE}")
    last_trade   = {s: datetime(2000, 1, 1) for s in UNIVERSE}
    entry_price  = {}
    day_start_eq = float(trading.get_account().equity)
    day          = datetime.utcnow().date()

    while True:
        try:
            clock = trading.get_clock()
            if not clock.is_open:
                time.sleep(300)
                continue

            # Daily reset + Rule 4 circuit breaker
            if datetime.utcnow().date() != day:
                day = datetime.utcnow().date()
                day_start_eq = float(trading.get_account().equity)
                log.info("🔄 New trading day.")
            equity = float(trading.get_account().equity)
            if rules.circuit_breaker_tripped(day_start_eq, equity):
                log.error(f"🚨 CIRCUIT BREAKER: -{rules.DAILY_LOSS_LIMIT_PCT*100}% daily loss. Halting until tomorrow.")
                time.sleep(3600)
                continue

            vix    = get_vix()
            action = rules.vix_action(vix)
            if action == "EXIT_ALL":
                kill_switch(); time.sleep(3600); continue
            if action == "REDUCE":
                log.warning("VIX ≥ 30 — reducing all positions by half")
                for p in trading.get_all_positions():
                    trading.close_position(p.symbol, close_options={"percentage": "50"})
                time.sleep(600); continue

            positions = {p.symbol: p for p in trading.get_all_positions()}
            spy = indicators(get_bars("SPY"))

            for symbol in UNIVERSE:
                df  = indicators(get_bars(symbol))
                px  = float(df.iloc[-1]["close"])

                # ── Manage open position ────────────────────
                if symbol in positions:
                    ep = entry_price.get(symbol, float(positions[symbol].avg_entry_price))
                    if rules.should_take_profit(ep, px):
                        trading.close_position(symbol)
                        journal({"time": datetime.utcnow(), "symbol": symbol, "side": "SELL",
                                 "qty": positions[symbol].qty, "price": px, "reason": "TP +1%"})
                        log.info(f"✅ {symbol} TAKE PROFIT +1% @ {px:.2f}")
                        entry_price.pop(symbol, None)
                    elif rules.should_stop_loss(ep, px):
                        trading.close_position(symbol)
                        journal({"time": datetime.utcnow(), "symbol": symbol, "side": "SELL",
                                 "qty": positions[symbol].qty, "price": px, "reason": "SL -0.5%"})
                        log.warning(f"🛑 {symbol} STOP LOSS -0.5% @ {px:.2f}")
                        entry_price.pop(symbol, None)
                    continue

                # ── Look for entry ──────────────────────────
                r  = df.iloc[-1]
                rs = rel_strength_vs_spy(df, spy)
                days_since = (datetime.utcnow() - last_trade[symbol]).days

                if rules.etf_entry_ok(r["ema21"], r["ema50"], r["rsi"], vix, rs,
                                       days_since, len(positions)) and pdt_guard():
                    qty = int(rules.position_size(equity, px))
                    if qty < 1:
                        continue
                    trading.submit_order(LimitOrderRequest(
                        symbol=symbol, qty=qty, side=OrderSide.BUY,
                        time_in_force=TimeInForce.DAY, limit_price=round(px, 2),
                    ))
                    entry_price[symbol] = px
                    last_trade[symbol]  = datetime.utcnow()
                    journal({"time": datetime.utcnow(), "symbol": symbol, "side": "BUY",
                             "qty": qty, "price": px, "reason": "Entry signal (all conditions)"})
                    log.info(f"📈 ENTRY {symbol}: {qty} @ {px:.2f} | TP {px*1.01:.2f} | SL {px*0.995:.2f}")
                else:
                    log.debug(f"⏳ {symbol}: waiting for setup")

        except Exception as e:
            log.error(f"💥 {e}", exc_info=True)

        time.sleep(60)


if __name__ == "__main__":
    import sys
    if "--kill" in sys.argv:
        kill_switch()
    else:
        run()
