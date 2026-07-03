"""
rules.py — Shared strategy rules for both bots.
Pure functions, no exchange dependencies → fully unit-testable.

RULES (Non-negotiable):
  Rule 1 → Take profit at exactly +1%
  Rule 2 → Max 10% of portfolio per position
  Rule 3 → No overtrading: cooldown + daily trade cap
  Rule 4 → Daily loss circuit breaker at -2% (the one you forgot!)
"""
from datetime import datetime

# ── Rule constants ──────────────────────────────────────────
TAKE_PROFIT_PCT      = 0.01    # Rule 1
MAX_POSITION_PCT     = 0.10    # Rule 2
STOP_LOSS_PCT        = 0.005   # 0.5% → 2:1 reward:risk
COOLDOWN_CANDLES     = 6       # Rule 3 (SOL: 6 × 4h = 24h)
MAX_TRADES_PER_DAY   = 2       # Rule 3
DAILY_LOSS_LIMIT_PCT = 0.02    # Rule 4: halt bot at -2% day
VIX_NO_ENTRY         = 25      # ETF bot: no entries above this
VIX_REDUCE           = 30      # ETF bot: halve positions
VIX_EXIT_ALL         = 40      # ETF bot: go to cash


def position_size(portfolio_value: float, price: float) -> float:
    """Rule 2: qty such that position value ≤ 10% of portfolio."""
    if portfolio_value <= 0 or price <= 0:
        return 0.0
    return round((portfolio_value * MAX_POSITION_PCT) / price, 4)


def should_take_profit(entry: float, current: float) -> bool:
    """Rule 1: exit at exactly +1%."""
    return (current - entry) / entry >= TAKE_PROFIT_PCT


def should_stop_loss(entry: float, current: float) -> bool:
    """Exit at -0.5%."""
    return (entry - current) / entry >= STOP_LOSS_PCT


def cooldown_clear(last_trade: datetime, now: datetime,
                   candle_hours: float = 4.0,
                   candles: int = COOLDOWN_CANDLES) -> bool:
    """Rule 3: enough time since last trade?"""
    return (now - last_trade).total_seconds() / 3600 >= candles * candle_hours


def daily_cap_ok(trades_today: int) -> bool:
    """Rule 3: below the daily trade ceiling?"""
    return trades_today < MAX_TRADES_PER_DAY


def circuit_breaker_tripped(day_start_equity: float, current_equity: float) -> bool:
    """Rule 4: True → HALT trading for the rest of the day."""
    if day_start_equity <= 0:
        return False
    return (day_start_equity - current_equity) / day_start_equity >= DAILY_LOSS_LIMIT_PCT


def sol_entry_ok(ema9, ema21, ema50, rsi, macd, macd_sig, vol_ratio, close, bb_mid) -> bool:
    """SOL bot: ALL conditions must be true."""
    return (
        ema9 > ema21 > ema50
        and 45 < rsi < 65
        and macd > macd_sig
        and vol_ratio > 1.5
        and close > bb_mid
    )


def vix_action(vix: float) -> str:
    """ETF bot risk regime from VIX."""
    if vix >= VIX_EXIT_ALL:
        return "EXIT_ALL"
    if vix >= VIX_REDUCE:
        return "REDUCE"
    if vix >= VIX_NO_ENTRY:
        return "NO_ENTRY"
    return "OK"


def etf_entry_ok(ema21, ema50, rsi, vix, rel_strength_vs_spy,
                 days_since_last: int, open_positions: int,
                 max_open: int = 4, cooldown_days: int = 2) -> bool:
    """ETF bot: ALL conditions must be true."""
    return (
        ema21 > ema50
        and 40 < rsi < 60
        and vix_action(vix) == "OK"
        and rel_strength_vs_spy > 0
        and days_since_last >= cooldown_days
        and open_positions < max_open
    )
