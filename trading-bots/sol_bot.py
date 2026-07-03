#!/usr/bin/env python3
"""
SOL/USD Trading Bot — Kraken Exchange
Strategy: EMA Crossover + RSI + MACD + Volume
──────────────────────────────────────────────
RULES (Non-negotiable):
  Rule 1 → Take profit at exactly +1%
  Rule 2 → Max 10% of portfolio per position
  Rule 3 → No overtrading: 6-candle cooldown + max 2 trades/day
"""
import os
import time
import logging
import krakenex
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    handlers=[
        logging.FileHandler("sol_bot.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

# ============================================================
# TRADING RULES — Change nothing below without understanding it
# ============================================================
TAKE_PROFIT_PCT    = 0.01    # Rule 1: +1% and we're out
MAX_POSITION_PCT   = 0.10    # Rule 2: max 10% of portfolio
STOP_LOSS_PCT      = 0.005   # 0.5% stop loss → 2:1 risk/reward ratio
COOLDOWN_CANDLES   = 6       # Rule 3: wait 6 × 4h = 24 hours after any trade
MAX_TRADES_PER_DAY = 2       # Rule 3: hard daily trade ceiling

# ============================================================
# STRATEGY PARAMETERS
# ============================================================
PAIR             = "SOLUSD"
CANDLE_INTERVAL  = 240        # 4-hour candles (minutes)
EMA_FAST         = 9
EMA_MED          = 21
EMA_SLOW         = 50
RSI_PERIOD       = 14
RSI_MIN          = 45         # Only enter in this RSI zone
RSI_MAX          = 65
MACD_FAST        = 12
MACD_SLOW        = 26
MACD_SIG         = 9
BB_PERIOD        = 20
BB_STD           = 2
VOLUME_MULT      = 1.5        # Volume must be 1.5× its 20-period average

# ============================================================
# KRAKEN CLIENT
# ============================================================
api = krakenex.API()
api.key    = os.getenv("API_KEY")
api.secret = os.getenv("SECRET_KEY")


def get_balance() -> float:
    """Return total portfolio value in USD."""
    result = api.query_private("Balance")
    if result["error"]:
        raise RuntimeError(f"Balance error: {result['error']}")
    balances = result["result"]
    usd = float(balances.get("ZUSD", 0))
    sol = float(balances.get("SOL", 0))
    sol_price = get_current_price()
    return usd + sol * sol_price


def get_current_price() -> float:
    """Fetch latest SOL/USD mid price."""
    result = api.query_public("Ticker", {"pair": PAIR})
    if result["error"]:
        raise RuntimeError(f"Ticker error: {result['error']}")
    ticker = list(result["result"].values())[0]
    bid = float(ticker["b"][0])
    ask = float(ticker["a"][0])
    return (bid + ask) / 2


def fetch_ohlcv(interval: int = CANDLE_INTERVAL, count: int = 100) -> pd.DataFrame:
    """Fetch OHLCV candles from Kraken."""
    result = api.query_public("OHLC", {"pair": PAIR, "interval": interval})
    if result["error"]:
        raise RuntimeError(f"OHLC error: {result['error']}")
    raw = list(result["result"].values())[0]
    df = pd.DataFrame(raw, columns=["time","open","high","low","close","vwap","volume","count"])
    df[["open","high","low","close","volume"]] = df[["open","high","low","close","volume"]].astype(float)
    df["time"] = pd.to_datetime(df["time"], unit="s")
    return df.tail(count).reset_index(drop=True)


# ============================================================
# INDICATORS
# ============================================================
def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    # EMAs
    df["ema9"]  = df["close"].ewm(span=EMA_FAST,  adjust=False).mean()
    df["ema21"] = df["close"].ewm(span=EMA_MED,   adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=EMA_SLOW,  adjust=False).mean()

    # RSI
    delta   = df["close"].diff()
    gain    = delta.clip(lower=0).rolling(RSI_PERIOD).mean()
    loss    = (-delta.clip(upper=0)).rolling(RSI_PERIOD).mean()
    rs      = gain / loss.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    # MACD
    ema12        = df["close"].ewm(span=MACD_FAST, adjust=False).mean()
    ema26        = df["close"].ewm(span=MACD_SLOW, adjust=False).mean()
    df["macd"]   = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=MACD_SIG, adjust=False).mean()

    # Bollinger Bands
    sma             = df["close"].rolling(BB_PERIOD).mean()
    std             = df["close"].rolling(BB_PERIOD).std()
    df["bb_upper"]  = sma + BB_STD * std
    df["bb_middle"] = sma
    df["bb_lower"]  = sma - BB_STD * std

    # Volume ratio
    df["vol_sma"]   = df["volume"].rolling(20).mean()
    df["vol_ratio"] = df["volume"] / df["vol_sma"].replace(0, np.nan)

    return df


# ============================================================
# RULE ENFORCEMENT
# ============================================================
def calculate_position_size(portfolio_value: float, price: float) -> float:
    """
    Rule 2: Never commit more than 10% of portfolio to one trade.
    Returns qty of SOL to buy.
    """
    max_value = portfolio_value * MAX_POSITION_PCT
    qty = max_value / price
    return round(qty, 4)


def is_cooldown_clear(last_trade_time: datetime, trades_today: int) -> bool:
    """
    Rule 3: Enforce 24-hour cooldown (6 × 4h candles) AND daily trade cap.
    """
    if trades_today >= MAX_TRADES_PER_DAY:
        log.info(f"Rule 3: Daily cap reached ({MAX_TRADES_PER_DAY} trades). Waiting until tomorrow.")
        return False
    hours_elapsed = (datetime.utcnow() - last_trade_time).total_seconds() / 3600
    required_hours = COOLDOWN_CANDLES * 4
    if hours_elapsed < required_hours:
        remaining = required_hours - hours_elapsed
        log.info(f"Rule 3: Cooldown active. {remaining:.1f}h remaining.")
        return False
    return True


def check_entry_signal(df: pd.DataFrame) -> tuple[bool, dict]:
    """
    ALL 5 conditions must be True to enter a trade.
    If even one fails, we wait. No exceptions.
    """
    r = df.iloc[-1]
    conditions = {
        "trend_up":    bool(r["ema9"] > r["ema21"] > r["ema50"]),
        "rsi_ok":      bool(RSI_MIN < r["rsi"] < RSI_MAX),
        "macd_bullish":bool(r["macd"] > r["macd_signal"]),
        "volume_ok":   bool(r["vol_ratio"] > VOLUME_MULT),
        "above_bb_mid":bool(r["close"] > r["bb_middle"]),
    }
    return all(conditions.values()), conditions


def should_take_profit(entry_price: float, current_price: float) -> bool:
    """Rule 1: Exit at exactly +1%. Not 1.1%, not 0.9%. Exactly 1%."""
    gain_pct = (current_price - entry_price) / entry_price
    return gain_pct >= TAKE_PROFIT_PCT


def should_stop_loss(entry_price: float, current_price: float) -> bool:
    """Safety net: exit if price drops 0.5% from entry."""
    loss_pct = (entry_price - current_price) / entry_price
    return loss_pct >= STOP_LOSS_PCT


# ============================================================
# ORDER EXECUTION
# ============================================================
def place_limit_buy(qty: float, price: float) -> str:
    """Use LIMIT orders to qualify for maker fees (0.16% vs 0.26% taker)."""
    result = api.query_private("AddOrder", {
        "pair":      PAIR,
        "type":      "buy",
        "ordertype": "limit",
        "price":     str(round(price, 2)),
        "volume":    str(qty),
    })
    if result["error"]:
        raise RuntimeError(f"Buy order failed: {result['error']}")
    txid = result["result"]["txid"][0]
    log.info(f"📈 BUY placed | {qty} SOL @ ${price:.2f} | txid: {txid}")
    return txid


def place_limit_sell(qty: float, price: float) -> str:
    """Sell at exactly entry + 1% as a limit order."""
    result = api.query_private("AddOrder", {
        "pair":      PAIR,
        "type":      "sell",
        "ordertype": "limit",
        "price":     str(round(price, 2)),
        "volume":    str(qty),
    })
    if result["error"]:
        raise RuntimeError(f"Sell order failed: {result['error']}")
    txid = result["result"]["txid"][0]
    log.info(f"🎯 SELL placed | {qty} SOL @ ${price:.2f} | txid: {txid}")
    return txid


def cancel_open_orders():
    """Cancel all open orders (called on stop loss to cancel TP order)."""
    open_orders = api.query_private("OpenOrders")
    for txid in open_orders.get("result", {}).get("open", {}).keys():
        api.query_private("CancelOrder", {"txid": txid})
        log.info(f"❌ Cancelled order: {txid}")


# ============================================================
# MAIN LOOP
# ============================================================
def run():
    log.info("=" * 60)
    log.info("SOL Bot starting — Paper mode" if os.getenv("PAPER") else "SOL Bot starting — LIVE MODE")
    log.info(f"Rules: TP={TAKE_PROFIT_PCT*100}% | Max pos={MAX_POSITION_PCT*100}% | Cooldown={COOLDOWN_CANDLES} candles")
    log.info("=" * 60)

    last_trade_time = datetime.utcnow() - timedelta(hours=999)
    trades_today    = 0
    last_reset_day  = datetime.utcnow().date()
    entry_price     = None
    position_qty    = 0.0
    tp_order_txid   = None

    while True:
        try:
            # Reset daily trade counter
            today = datetime.utcnow().date()
            if today != last_reset_day:
                trades_today   = 0
                last_reset_day = today
                log.info("🔄 Daily trade counter reset.")

            df = fetch_ohlcv()
            calculate_indicators(df)
            current_price = df.iloc[-1]["close"]

            # ── If in a trade, check exits ──────────────────────
            if entry_price is not None:
                if should_take_profit(entry_price, current_price):
                    log.info(f"✅ TAKE PROFIT: +{TAKE_PROFIT_PCT*100}% | Entry ${entry_price:.2f} → Exit ${current_price:.2f}")
                    cancel_open_orders()
                    place_limit_sell(position_qty, current_price)
                    entry_price  = None
                    position_qty = 0.0

                elif should_stop_loss(entry_price, current_price):
                    log.warning(f"🛑 STOP LOSS: -{STOP_LOSS_PCT*100}% | Entry ${entry_price:.2f} → Exit ${current_price:.2f}")
                    cancel_open_orders()
                    place_limit_sell(position_qty, current_price)
                    entry_price  = None
                    position_qty = 0.0

                else:
                    unrealised = (current_price - entry_price) / entry_price * 100
                    log.info(f"⏸  Holding | Price ${current_price:.2f} | P&L: {unrealised:+.2f}%")

            # ── Not in a trade — look for entry ─────────────────
            else:
                if is_cooldown_clear(last_trade_time, trades_today):
                    signal_ok, conditions = check_entry_signal(df)

                    if signal_ok:
                        portfolio_value = get_balance()
                        qty             = calculate_position_size(portfolio_value, current_price)
                        tp_price        = round(current_price * (1 + TAKE_PROFIT_PCT), 2)

                        place_limit_buy(qty, current_price)
                        # Also pre-place the TP sell order
                        tp_order_txid = place_limit_sell(qty, tp_price)

                        entry_price     = current_price
                        position_qty    = qty
                        last_trade_time = datetime.utcnow()
                        trades_today   += 1

                        log.info(f"📊 Position: {qty} SOL | TP @ ${tp_price:.2f} | SL @ ${current_price*(1-STOP_LOSS_PCT):.2f}")
                    else:
                        failed = [k for k, v in conditions.items() if not v]
                        log.info(f"⏳ No entry. Waiting. Failed: {failed}")
                else:
                    log.info("⏳ Cooldown or daily cap active. Skipping.")

        except Exception as e:
            log.error(f"💥 Error: {e}", exc_info=True)

        time.sleep(60)  # Check every 60 seconds


if __name__ == "__main__":
    run()
