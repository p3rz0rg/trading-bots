#!/usr/bin/env python3
"""
scanner.py — Market scanner for both bots.
Sweeps a wider universe, ranks candidates by signal quality,
and returns only the top setups. Rate-limit aware.

Usage as a library:
    from scanner import scan_crypto, scan_stocks

Standalone:
    python3 scanner.py --market crypto   # top Kraken USD pairs
    python3 scanner.py --market stocks   # liquid ETF/stock universe (needs Alpaca keys)
"""
import os
import time
import logging
from dataclasses import dataclass, field

import pandas as pd
import numpy as np

import rules

log = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────
CRYPTO_MAX_PAIRS   = 30     # scan top-N USD pairs by volume (rate-limit friendly)
KRAKEN_CALL_DELAY  = 1.1    # seconds between public calls (Kraken ~1/sec limit)
STOCK_UNIVERSE     = [      # liquid, tight-spread instruments only
    "SPY","QQQ","IWM","DIA","XLK","XLV","XLE","XLF","XLI","XLY",
    "XLP","XLU","XLB","XLRE","SMH","IBB","GDX","EEM","EFA","TLT",
]
MIN_SCORE          = 3      # candidate must pass at least N of 5 conditions to be listed
TOP_N              = 5      # return at most this many candidates


@dataclass
class Candidate:
    symbol: str
    price: float
    score: int              # how many entry conditions passed (0–5)
    entry_ready: bool       # True only if ALL conditions passed
    conditions: dict = field(default_factory=dict)

    def __str__(self):
        flag = "🟢 READY" if self.entry_ready else f"🟡 {self.score}/5"
        return f"{flag}  {self.symbol:<10} ${self.price:,.2f}  {self.conditions}"


# ── Shared indicator math ───────────────────────────────────
def _indicators(df: pd.DataFrame) -> pd.DataFrame:
    df["ema9"]  = df["close"].ewm(span=9,  adjust=False).mean()
    df["ema21"] = df["close"].ewm(span=21, adjust=False).mean()
    df["ema50"] = df["close"].ewm(span=50, adjust=False).mean()
    delta = df["close"].diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    df["rsi"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))
    e12 = df["close"].ewm(span=12, adjust=False).mean()
    e26 = df["close"].ewm(span=26, adjust=False).mean()
    df["macd"]        = e12 - e26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["bb_middle"]   = df["close"].rolling(20).mean()
    df["vol_ratio"]   = df["volume"] / df["volume"].rolling(20).mean().replace(0, np.nan)
    return df


def score_candidate(df: pd.DataFrame) -> tuple[int, bool, dict]:
    """
    Score the latest candle against the 5 SOL-style entry conditions.
    Returns (score 0–5, all_passed, per-condition detail).
    Pure function → unit-testable without any API.
    """
    if len(df) < 55 or df.iloc[-1][["ema50", "rsi", "bb_middle", "vol_ratio"]].isna().any():
        return 0, False, {"insufficient_data": True}
    r = df.iloc[-1]
    conditions = {
        "trend":  bool(r["ema9"] > r["ema21"] > r["ema50"]),
        "rsi":    bool(45 < r["rsi"] < 65),
        "macd":   bool(r["macd"] > r["macd_signal"]),
        "volume": bool(r["vol_ratio"] > 1.5),
        "bb":     bool(r["close"] > r["bb_middle"]),
    }
    score = sum(conditions.values())
    return score, score == 5, conditions


def rank_candidates(cands: list[Candidate], top_n: int = TOP_N,
                    min_score: int = MIN_SCORE) -> list[Candidate]:
    """Filter by minimum score, sort ready-first then by score. Pure function."""
    kept = [c for c in cands if c.score >= min_score]
    return sorted(kept, key=lambda c: (c.entry_ready, c.score), reverse=True)[:top_n]


# ── Crypto scanner (Kraken) ─────────────────────────────────
def scan_crypto(max_pairs: int = CRYPTO_MAX_PAIRS) -> list[Candidate]:
    import krakenex
    api = krakenex.API()  # public endpoints — no keys needed

    # 1. Discover USD pairs
    pairs_resp = api.query_public("AssetPairs")
    usd_pairs = [k for k, v in pairs_resp["result"].items()
                 if v.get("quote") in ("ZUSD", "USD") and ".d" not in k]

    # 2. Rank by 24h volume via Ticker (single batched call)
    tick = api.query_public("Ticker", {"pair": ",".join(usd_pairs[:200])})
    vols = {k: float(v["v"][1]) * float(v["c"][0]) for k, v in tick["result"].items()}
    top = sorted(vols, key=vols.get, reverse=True)[:max_pairs]
    log.info(f"Scanning top {len(top)} Kraken USD pairs by volume…")

    # 3. Score each (throttled — Kraken public limit ~1 call/sec)
    out = []
    for pair in top:
        try:
            ohlc = api.query_public("OHLC", {"pair": pair, "interval": 240})
            raw  = list(ohlc["result"].values())[0]
            df = pd.DataFrame(raw, columns=["time","open","high","low","close","vwap","volume","count"])
            df[["close","volume"]] = df[["close","volume"]].astype(float)
            df = _indicators(df)
            score, ready, cond = score_candidate(df)
            out.append(Candidate(pair, float(df.iloc[-1]["close"]), score, ready, cond))
        except Exception as e:
            log.warning(f"{pair}: skipped ({e})")
        time.sleep(KRAKEN_CALL_DELAY)
    return rank_candidates(out)


# ── Stock scanner (Alpaca) ──────────────────────────────────
def scan_stocks(universe: list[str] = None) -> list[Candidate]:
    from datetime import datetime, timedelta
    from alpaca.data.historical import StockHistoricalDataClient
    from alpaca.data.requests import StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    universe = universe or STOCK_UNIVERSE
    client = StockHistoricalDataClient(os.getenv("API_KEY"), os.getenv("SECRET_KEY"))

    # One batched request for the whole universe — rate-limit friendly
    req = StockBarsRequest(symbol_or_symbols=universe, timeframe=TimeFrame.Day,
                           start=datetime.utcnow() - timedelta(days=200))
    bars = client.get_stock_bars(req).df

    out = []
    for symbol in universe:
        try:
            df = bars.xs(symbol).reset_index()
            df = _indicators(df)
            score, ready, cond = score_candidate(df)
            out.append(Candidate(symbol, float(df.iloc[-1]["close"]), score, ready, cond))
        except Exception as e:
            log.warning(f"{symbol}: skipped ({e})")
    return rank_candidates(out)


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", choices=["crypto", "stocks"], required=True)
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()

    results = scan_crypto() if args.market == "crypto" else scan_stocks()
    print("\n" + "=" * 60)
    print(f" SCANNER RESULTS — top candidates ({args.market})")
    print("=" * 60)
    if not results:
        print("  No candidates meet the minimum score right now. Patience.")
    for c in results:
        print(" ", c)
    print("=" * 60)
    print("  🟢 READY = all 5 conditions met (bot may enter)")
    print("  🟡 n/5   = watchlist only — do NOT trade partial signals\n")
