#!/usr/bin/env python3
"""
backtest.py — Historical simulation with FEES and SLIPPAGE.
Most retail backtests lie by ignoring costs. This one doesn't.

Usage:
  python3 backtest.py --csv sol_4h.csv --fee 0.0016 --slippage 0.0005
  python3 backtest.py --demo          # synthetic data demo (no CSV needed)

CSV format: time,open,high,low,close,volume  (Kraken/Alpaca exports work)
"""
import argparse
import numpy as np
import pandas as pd
import rules


def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    df["ema9"]  = df["close"].ewm(span=9,  adjust=False).mean()
    df["ema21"] = df["close"].ewm(span=21, adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    delta = df["close"].diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"]  = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    e12 = df["close"].ewm(span=12, adjust=False).mean()
    e26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"]        = e12 - e26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    sma = df["close"].rolling(20).mean()
    df["bb_middle"]   = sma
    df["vol_ratio"]   = df["volume"] / df["volume"].rolling(20).mean().replace(0, np.nan)
    return df.dropna().reset_index(drop=True)


def run_backtest(df: pd.DataFrame, start_equity: float = 10_000,
                 fee: float = 0.0016, slippage: float = 0.0005) -> dict:
    """
    Simulates the SOL strategy candle-by-candle with realistic costs.
    fee: per-side (0.0016 = Kraken maker). slippage: per-side price impact.
    """
    equity, position, entry = start_equity, 0.0, 0.0
    last_trade_idx = -999
    trades, wins, equity_curve = [], 0, []
    day_start_eq, current_day = equity, None
    halted_day = None

    for i in range(len(df)):
        row = df.iloc[i]
        px  = row["close"]
        day = pd.Timestamp(row["time"]).date() if "time" in df.columns else i // 6

        if day != current_day:
            current_day, day_start_eq = day, equity + position * px
            halted_day = None

        mark = equity + position * px
        equity_curve.append(mark)

        # Rule 4: circuit breaker
        if rules.circuit_breaker_tripped(day_start_eq, mark):
            halted_day = day

        if position > 0:
            if rules.should_take_profit(entry, px):
                exit_px = px * (1 - slippage)
                equity += position * exit_px * (1 - fee)
                trades.append({"entry": entry, "exit": exit_px, "result": "TP"})
                wins += 1
                position = 0.0
            elif rules.should_stop_loss(entry, px):
                exit_px = px * (1 - slippage)
                equity += position * exit_px * (1 - fee)
                trades.append({"entry": entry, "exit": exit_px, "result": "SL"})
                position = 0.0

        elif halted_day != day and i - last_trade_idx >= rules.COOLDOWN_CANDLES:
            if rules.sol_entry_ok(row["ema9"], row["ema21"], row["ema50"],
                                  row["rsi"], row["macd"], row["macd_signal"],
                                  row["vol_ratio"], row["close"], row["bb_middle"]):
                entry_px = px * (1 + slippage)
                qty = rules.position_size(mark, entry_px)
                cost = qty * entry_px * (1 + fee)
                if cost <= equity:
                    equity  -= cost
                    position = qty
                    entry    = entry_px
                    last_trade_idx = i

    # Close any open position at the end
    if position > 0:
        equity += position * df.iloc[-1]["close"] * (1 - fee)

    curve = np.array(equity_curve)
    peak  = np.maximum.accumulate(curve)
    max_dd = float(((curve - peak) / peak).min()) * 100 if len(curve) else 0.0
    total  = len(trades)

    return {
        "final_equity":  round(equity, 2),
        "total_return_pct": round((equity / start_equity - 1) * 100, 2),
        "trades":        total,
        "win_rate_pct":  round(wins / total * 100, 1) if total else 0.0,
        "max_drawdown_pct": round(max_dd, 2),
        "fees_modeled":  fee,
        "slippage_modeled": slippage,
    }


def make_demo_data(n: int = 2000, seed: int = 42) -> pd.DataFrame:
    """Synthetic price series with trend + noise for demo runs."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(0.0004, 0.02, n)
    price = 100 * np.exp(np.cumsum(rets))
    vol   = rng.lognormal(10, 0.6, n)
    t = pd.date_range("2024-01-01", periods=n, freq="4h")
    return pd.DataFrame({"time": t, "open": price, "high": price * 1.005,
                         "low": price * 0.995, "close": price, "volume": vol})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--fee", type=float, default=0.0016)
    ap.add_argument("--slippage", type=float, default=0.0005)
    ap.add_argument("--demo", action="store_true")
    args = ap.parse_args()

    df = make_demo_data() if args.demo or not args.csv else pd.read_csv(args.csv)
    df = add_indicators(df)
    result = run_backtest(df, fee=args.fee, slippage=args.slippage)

    print("\n" + "=" * 46)
    print(" BACKTEST RESULTS (with fees & slippage)")
    print("=" * 46)
    for k, v in result.items():
        print(f"  {k:<22} {v}")
    print("=" * 46)
    print("  ⚠️  Past performance ≠ future results.")
    print("  ⚠️  Paper trade 90 days before going live.\n")
