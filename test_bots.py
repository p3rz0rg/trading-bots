#!/usr/bin/env python3
"""
test_bots.py — Unit tests for all trading rules.
Run: python3 -m pytest test_bots.py -v   (or: python3 test_bots.py)
"""
import unittest
from datetime import datetime, timedelta
import rules


class TestRule1_TakeProfit(unittest.TestCase):
    def test_tp_triggers_at_exactly_1_pct(self):
        self.assertTrue(rules.should_take_profit(100.0, 101.0))

    def test_tp_triggers_above_1_pct(self):
        self.assertTrue(rules.should_take_profit(100.0, 101.5))

    def test_tp_does_not_trigger_below_1_pct(self):
        self.assertFalse(rules.should_take_profit(100.0, 100.99))

    def test_tp_does_not_trigger_on_loss(self):
        self.assertFalse(rules.should_take_profit(100.0, 99.0))


class TestRule2_PositionSize(unittest.TestCase):
    def test_position_is_exactly_10_pct(self):
        qty = rules.position_size(10_000, 100.0)
        self.assertAlmostEqual(qty * 100.0, 1_000.0, places=1)

    def test_position_never_exceeds_10_pct(self):
        for pv in [1_000, 10_000, 250_000]:
            for px in [0.5, 10, 150, 5000]:
                qty = rules.position_size(pv, px)
                self.assertLessEqual(qty * px, pv * rules.MAX_POSITION_PCT + 0.01)

    def test_zero_portfolio_returns_zero(self):
        self.assertEqual(rules.position_size(0, 100), 0.0)

    def test_invalid_price_returns_zero(self):
        self.assertEqual(rules.position_size(10_000, 0), 0.0)


class TestRule3_NoOvertrading(unittest.TestCase):
    def test_cooldown_blocks_within_24h(self):
        now = datetime(2026, 7, 1, 12, 0)
        last = now - timedelta(hours=23)
        self.assertFalse(rules.cooldown_clear(last, now))

    def test_cooldown_clears_after_24h(self):
        now = datetime(2026, 7, 1, 12, 0)
        last = now - timedelta(hours=25)
        self.assertTrue(rules.cooldown_clear(last, now))

    def test_daily_cap_blocks_third_trade(self):
        self.assertTrue(rules.daily_cap_ok(0))
        self.assertTrue(rules.daily_cap_ok(1))
        self.assertFalse(rules.daily_cap_ok(2))


class TestRule4_CircuitBreaker(unittest.TestCase):
    def test_trips_at_2_pct_daily_loss(self):
        self.assertTrue(rules.circuit_breaker_tripped(10_000, 9_800))

    def test_does_not_trip_at_1_pct(self):
        self.assertFalse(rules.circuit_breaker_tripped(10_000, 9_900))

    def test_does_not_trip_on_gain(self):
        self.assertFalse(rules.circuit_breaker_tripped(10_000, 10_500))


class TestStopLoss(unittest.TestCase):
    def test_sl_triggers_at_0_5_pct(self):
        self.assertTrue(rules.should_stop_loss(100.0, 99.5))

    def test_sl_does_not_trigger_at_0_4_pct(self):
        self.assertFalse(rules.should_stop_loss(100.0, 99.61))


class TestSolEntry(unittest.TestCase):
    GOOD = dict(ema9=103, ema21=102, ema50=100, rsi=55,
                macd=1.2, macd_sig=0.8, vol_ratio=1.8, close=104, bb_mid=101)

    def test_all_conditions_pass(self):
        self.assertTrue(rules.sol_entry_ok(**self.GOOD))

    def test_blocked_if_rsi_overbought(self):
        bad = {**self.GOOD, "rsi": 70}
        self.assertFalse(rules.sol_entry_ok(**bad))

    def test_blocked_if_volume_weak(self):
        bad = {**self.GOOD, "vol_ratio": 1.2}
        self.assertFalse(rules.sol_entry_ok(**bad))

    def test_blocked_if_trend_broken(self):
        bad = {**self.GOOD, "ema9": 99}
        self.assertFalse(rules.sol_entry_ok(**bad))


class TestEtfEntryAndVix(unittest.TestCase):
    GOOD = dict(ema21=102, ema50=100, rsi=50, vix=16,
                rel_strength_vs_spy=0.004, days_since_last=3, open_positions=1)

    def test_all_conditions_pass(self):
        self.assertTrue(rules.etf_entry_ok(**self.GOOD))

    def test_vix_25_blocks_entry(self):
        bad = {**self.GOOD, "vix": 25}
        self.assertFalse(rules.etf_entry_ok(**bad))

    def test_max_positions_blocks_entry(self):
        bad = {**self.GOOD, "open_positions": 4}
        self.assertFalse(rules.etf_entry_ok(**bad))

    def test_cooldown_blocks_entry(self):
        bad = {**self.GOOD, "days_since_last": 1}
        self.assertFalse(rules.etf_entry_ok(**bad))

    def test_vix_regimes(self):
        self.assertEqual(rules.vix_action(15), "OK")
        self.assertEqual(rules.vix_action(27), "NO_ENTRY")
        self.assertEqual(rules.vix_action(33), "REDUCE")
        self.assertEqual(rules.vix_action(45), "EXIT_ALL")




# ── Scanner tests (added with scanner.py) ───────────────────
import pandas as pd
import numpy as np
from scanner import score_candidate, rank_candidates, Candidate


def _make_df(trend_up=True, rsi_zone=True, vol_high=True, n=80):
    """Synthetic candles engineered to pass/fail specific conditions."""
    base = np.linspace(100, 130, n) if trend_up else np.linspace(130, 100, n)
    # Zigzag noise ensures both up AND down moves exist → RSI is computable
    rng = np.random.default_rng(7)
    noise = np.cumsum(rng.normal(0, 0.8 if rsi_zone else 5.0, n))
    noise -= np.linspace(0, noise[-1], n)  # detrend noise so 'base' sets the trend
    close = base + noise
    vol = np.full(n, 1000.0)
    if vol_high:
        vol[-1] = 2500.0
    df = pd.DataFrame({"close": close, "volume": vol})
    from scanner import _indicators
    return _indicators(df)


class TestScanner(unittest.TestCase):
    def test_uptrend_scores_high(self):
        score, ready, cond = score_candidate(_make_df())
        self.assertGreaterEqual(score, 3)
        self.assertTrue(cond["trend"])

    def test_downtrend_not_ready(self):
        score, ready, cond = score_candidate(_make_df(trend_up=False))
        self.assertFalse(ready)
        self.assertFalse(cond["trend"])

    def test_low_volume_fails_volume_condition(self):
        score, ready, cond = score_candidate(_make_df(vol_high=False))
        self.assertFalse(cond["volume"])
        self.assertFalse(ready)

    def test_insufficient_data_scores_zero(self):
        df = _make_df(n=20)
        score, ready, cond = score_candidate(df.head(20))
        self.assertEqual(score, 0)
        self.assertFalse(ready)

    def test_rank_filters_below_min_score(self):
        cands = [Candidate("A", 1, 2, False), Candidate("B", 1, 4, False),
                 Candidate("C", 1, 5, True)]
        ranked = rank_candidates(cands, top_n=5, min_score=3)
        self.assertEqual([c.symbol for c in ranked], ["C", "B"])

    def test_rank_puts_ready_first_and_caps_top_n(self):
        cands = [Candidate(f"S{i}", 1, 4, False) for i in range(6)]
        cands.append(Candidate("READY", 1, 5, True))
        ranked = rank_candidates(cands, top_n=3, min_score=3)
        self.assertEqual(ranked[0].symbol, "READY")
        self.assertEqual(len(ranked), 3)




class TestLiquidityFilter(unittest.TestCase):
    def test_good_liquidity_passes(self):
        self.assertTrue(rules.liquidity_ok(10_000_000, 100.00, 100.10))

    def test_low_volume_fails(self):
        self.assertFalse(rules.liquidity_ok(1_000_000, 100.00, 100.10))

    def test_wide_spread_fails(self):
        # 0.5% spread > 0.2% max
        self.assertFalse(rules.liquidity_ok(10_000_000, 100.00, 100.50))

    def test_spread_at_exactly_limit_passes(self):
        bid, ask = 100.00, 100.20  # ~0.1998% of mid
        self.assertTrue(rules.liquidity_ok(10_000_000, bid, ask))

    def test_invalid_quotes_fail(self):
        self.assertFalse(rules.liquidity_ok(10_000_000, 0, 100))
        self.assertFalse(rules.liquidity_ok(10_000_000, 100.5, 100.0))  # crossed


class TestGlobalCryptoCap(unittest.TestCase):
    def test_slots_available_below_cap(self):
        self.assertTrue(rules.crypto_slots_available(0))
        self.assertTrue(rules.crypto_slots_available(2))

    def test_no_slot_at_cap(self):
        self.assertFalse(rules.crypto_slots_available(3))
        self.assertFalse(rules.crypto_slots_available(5))


if __name__ == "__main__":
    unittest.main(verbosity=2)
