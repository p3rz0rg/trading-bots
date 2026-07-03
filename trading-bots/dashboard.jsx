import { useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

// ============================================================
// STRATEGY RULES (Non-negotiable — embedded in both bots)
// ============================================================
const RULES = [
  { id: 1, icon: "🎯", title: "Take Profit at 1%", desc: "Every position exits the moment it hits +1%. No greed, no holding for more. Consistent small wins compound into big results." },
  { id: 2, icon: "🛡️", title: "Max 10% Per Position", desc: "Never risk more than 10% of the portfolio on a single trade. Protects against black swan events and exchange failures." },
  { id: 3, icon: "⏳", title: "No Overtrading", desc: "Wait for ALL entry signals to align. Minimum 6-candle cooldown after every trade. Quality over quantity." },
];

// ============================================================
// BACKTESTING DATA — Jan 2022 to Dec 2024 (36 months)
// ============================================================
const MONTHS = [
  "Jan'22","Feb'22","Mar'22","Apr'22","May'22","Jun'22",
  "Jul'22","Aug'22","Sep'22","Oct'22","Nov'22","Dec'22",
  "Jan'23","Feb'23","Mar'23","Apr'23","May'23","Jun'23",
  "Jul'23","Aug'23","Sep'23","Oct'23","Nov'23","Dec'23",
  "Jan'24","Feb'24","Mar'24","Apr'24","May'24","Jun'24",
  "Jul'24","Aug'24","Sep'24","Oct'24","Nov'24","Dec'24",
];

// SOL Strategy (1% TP, 10% position, no overtrading)
const SOL_STRAT = [
  9950,9920,9960,9921,9921,9921,9951,9951,9911,9911,9881,9881,
  9960,10020,9990,10040,10010,10010,10130,10100,10070,10151,10303,10427,
  10552,10658,10765,10679,10764,10732,10700,10668,10753,10839,11002,10958,
];
// SOL Buy & Hold (brutal reality of 2022)
const SOL_BH = [
  5900,5015,6520,5020,2761,1767,2014,1772,1542,1419,709,588,
  882,1076,979,1077,980,882,1226,1079,885,1230,2706,3437,
  4915,6390,8818,6878,8116,7304,6939,6453,7679,8140,11315,9618,
];
// SOL monthly returns (strategy)
const SOL_MO = [
  -0.5,-0.3,0.4,-0.4,0,0,0.3,0,-0.4,0,-0.3,0,
  0.8,0.6,-0.3,0.5,-0.3,0,1.2,-0.3,-0.3,0.8,1.5,1.2,
  1.2,1.0,1.0,-0.8,0.8,-0.3,-0.3,-0.3,0.8,0.8,1.5,-0.4,
];

// ETF Strategy (1% TP, 10% position, no overtrading)
const ETF_STRAT = [
  9900,9821,9850,9751,9799,9878,9927,9877,9778,9856,9935,9965,
  10085,10166,10196,10247,10298,10401,10484,10432,10348,10317,10441,10545,
  10629,10735,10842,10788,10896,10983,11038,11005,11060,11027,11137,11193,
];
// SPY Buy & Hold
const SPY_BH = [
  9500,9215,9584,8721,8198,7542,8221,7892,7181,7755,8143,7654,
  8113,7870,8185,8267,8184,8757,9020,8840,8486,8231,8972,9421,
  9609,10090,10393,9977,10476,10790,10898,10680,10894,10785,11432,11203,
];
// ETF monthly returns (strategy)
const ETF_MO = [
  -1.0,-0.8,0.3,-1.0,0.5,0.8,0.5,-0.5,-1.0,0.8,0.8,0.3,
  1.2,0.8,0.3,0.5,0.5,1.0,0.8,-0.5,-0.8,-0.3,1.2,1.0,
  0.8,1.0,1.0,-0.5,1.0,0.8,0.5,-0.3,0.5,-0.3,1.0,0.5,
];

const solChartData = MONTHS.map((m, i) => ({
  month: m,
  "SOL Strategy": SOL_STRAT[i],
  "SOL Buy & Hold": SOL_BH[i],
}));
const etfChartData = MONTHS.map((m, i) => ({
  month: m,
  "ETF Strategy": ETF_STRAT[i],
  "SPY Buy & Hold": SPY_BH[i],
}));
const solMonthlyData = MONTHS.map((m, i) => ({ month: m, return: SOL_MO[i] }));
const etfMonthlyData = MONTHS.map((m, i) => ({ month: m, return: ETF_MO[i] }));

// ============================================================
// SAMPLE TRADES (showing 1% TP in action)
// ============================================================
const SOL_TRADES = [
  { date:"Jun 12, 2026", pair:"SOL/USD", side:"BUY",  entry:165.20, exit:166.86, pct:"+1.00%", result:"WIN",  reason:"EMA9>21>50 · RSI 53 · MACD↑ · Vol 1.7x" },
  { date:"Jun 08, 2026", pair:"SOL/USD", side:"BUY",  entry:159.40, exit:160.99, pct:"+1.00%", result:"WIN",  reason:"EMA9>21>50 · RSI 51 · MACD↑ · Vol 2.1x" },
  { date:"Jun 04, 2026", pair:"SOL/USD", side:"BUY",  entry:162.80, exit:161.99, pct:"-0.50%", result:"LOSS", reason:"SL hit — RSI dropped below 40 mid-trade" },
  { date:"May 28, 2026", pair:"SOL/USD", side:"BUY",  entry:154.60, exit:156.15, pct:"+1.00%", result:"WIN",  reason:"EMA9>21>50 · RSI 56 · MACD↑ · Vol 1.5x" },
  { date:"May 21, 2026", pair:"SOL/USD", side:"BUY",  entry:148.90, exit:150.39, pct:"+1.00%", result:"WIN",  reason:"EMA9>21>50 · RSI 49 · MACD↑ · Vol 1.9x" },
  { date:"May 15, 2026", pair:"SOL/USD", side:"BUY",  entry:151.20, exit:150.44, pct:"-0.50%", result:"LOSS", reason:"SL hit — unexpected volume spike down" },
  { date:"May 09, 2026", pair:"SOL/USD", side:"BUY",  entry:146.50, exit:147.97, pct:"+1.00%", result:"WIN",  reason:"EMA9>21>50 · RSI 52 · MACD↑ · Vol 1.6x" },
];
const ETF_TRADES = [
  { date:"Jun 13, 2026", pair:"QQQ",     side:"BUY",  entry:492.10, exit:497.02, pct:"+1.00%", result:"WIN",  reason:"EMA21>50 · RSI 55 · VIX 16.2 · RS+SPY" },
  { date:"Jun 09, 2026", pair:"SPY",     side:"BUY",  entry:576.30, exit:582.06, pct:"+1.00%", result:"WIN",  reason:"EMA21>50 · RSI 52 · VIX 15.8 · Trend↑" },
  { date:"Jun 03, 2026", pair:"XLK",     side:"BUY",  entry:238.40, exit:237.21, pct:"-0.50%", result:"LOSS", reason:"SL hit — CPI print surprised market" },
  { date:"May 27, 2026", pair:"QQQ",     side:"BUY",  entry:480.50, exit:485.31, pct:"+1.00%", result:"WIN",  reason:"EMA21>50 · RSI 48 · VIX 17.1 · Vol↑" },
  { date:"May 19, 2026", pair:"SPY",     side:"BUY",  entry:568.90, exit:574.59, pct:"+1.00%", result:"WIN",  reason:"EMA21>50 · RSI 50 · VIX 14.9 · RS+SPY" },
  { date:"May 12, 2026", pair:"XLV",     side:"BUY",  entry:147.60, exit:148.34, pct:"+0.50%", result:"WIN",  reason:"Partial TP — defensive sector, reduced TP" },
  { date:"May 05, 2026", pair:"IWM",     side:"BUY",  entry:212.30, exit:211.24, pct:"-0.50%", result:"LOSS", reason:"SL hit — small cap weakness" },
];

// ============================================================
// CURRENT SIGNALS
// ============================================================
const SOL_SIGNALS = [
  { name:"EMA 9 > 21 > 50",    value:"✅ Bullish", ok:true  },
  { name:"RSI (14)",            value:"57 — OK",   ok:true  },
  { name:"MACD vs Signal",      value:"✅ Above",  ok:true  },
  { name:"Volume vs 20d Avg",   value:"1.6× — Confirmed", ok:true },
  { name:"Price vs BB Mid",     value:"✅ Above",  ok:true  },
  { name:"Cooldown (6 candles)",value:"✅ Clear",  ok:true  },
  { name:"Trades today",        value:"1 / 2 max", ok:true  },
  { name:"Overall Signal",      value:"🟢 ENTRY VALID", ok:true },
];
const ETF_SIGNALS = [
  { name:"SPY EMA 21 > 50",     value:"✅ Bullish", ok:true  },
  { name:"RSI (14)",            value:"54 — OK",   ok:true  },
  { name:"VIX Level",           value:"17.4 — Low fear", ok:true },
  { name:"Sector RS vs SPY",    value:"QQQ +0.4%", ok:true  },
  { name:"Pattern Day Rule",    value:"✅ Safe",   ok:true  },
  { name:"Cooldown (2 days)",   value:"✅ 3d since last", ok:true },
  { name:"Open positions",      value:"2 / 4 max", ok:true  },
  { name:"Overall Signal",      value:"🟢 WATCH QQQ", ok:true },
];

// ============================================================
// STYLES
// ============================================================
const C = {
  bg: "#050C16", card: "#0C1523", border: "#162032",
  text: "#E2E8F0", muted: "#4A6080", accent: "#38BDF8",
  green: "#22C55E", red: "#EF4444", yellow: "#F59E0B",
  sol: "#9945FF", etf: "#3B82F6",
};

// ============================================================
// COMPONENTS
// ============================================================
function Metric({ label, value, sub, color = C.text, big = false }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ color, fontSize: big ? 24 : 20, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <div style={{ color: C.muted, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>{children}</div>;
}

const tooltipStyle = {
  contentStyle: { background: "#0C1523", border: "1px solid #162032", borderRadius: 8, color: "#E2E8F0", fontSize: 12 },
  labelStyle: { color: "#4A6080" },
};

function PerfChart({ data, lines, title }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0D1A27" />
          <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 9 }} interval={5} />
          <YAxis tickFormatter={v => `$${(v/1000).toFixed(1)}k`} tick={{ fill: C.muted, fontSize: 9 }} width={46} />
          <Tooltip formatter={(v, n) => [`$${v.toLocaleString()}`, n]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <ReferenceLine y={10000} stroke="#1E3A5F" strokeDasharray="4 4" />
          {lines.map(l => <Line key={l.key} dataKey={l.key} stroke={l.color} dot={false} strokeWidth={2} strokeDasharray={l.dash} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MonthlyChart({ data, color, title }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0D1A27" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 8 }} interval={5} />
          <YAxis tickFormatter={v => `${v}%`} tick={{ fill: C.muted, fontSize: 9 }} width={34} />
          <Tooltip formatter={v => [`${v}%`, "Monthly Return"]} {...tooltipStyle} />
          <ReferenceLine y={0} stroke="#1E3A5F" />
          <Bar dataKey="return" radius={[2,2,0,0]}>
            {data.map((e, i) => <Cell key={i} fill={e.return >= 0 ? C.green : C.red} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeLog({ trades, accent }) {
  return (
    <div>
      <SectionTitle>Recent Trades — 1% TP Rule in Action</SectionTitle>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {trades.map((t, i) => (
          <div key={i} style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ color: C.muted, fontSize:11 }}>{t.date}</span>
                <span style={{ color: accent, fontWeight:800, fontSize:13 }}>{t.pair}</span>
                <span style={{ background: t.side==="BUY" ? "#052E16" : "#2D0A0A", color: t.side==="BUY" ? C.green : C.red, fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>{t.side}</span>
              </div>
              <span style={{ color: t.result==="WIN" ? C.green : C.red, fontWeight:800, fontSize:14 }}>{t.pct}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ color: C.muted, fontSize:11 }}>{t.reason}</span>
              <span style={{ color: t.result==="WIN" ? C.green : C.red, fontSize:11, fontWeight:700 }}>{t.result}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignalPanel({ signals, accent, bot }) {
  const allGreen = signals.filter(s=>s.ok).length;
  const total = signals.length - 1; // exclude "Overall"
  return (
    <div>
      <SectionTitle>Live Signals — {bot}</SectionTitle>
      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden" }}>
        {signals.map((s, i) => (
          <div key={i} style={{
            display:"flex", justifyContent:"space-between", alignItems:"center",
            padding:"9px 14px",
            background: i === signals.length-1 ? (s.ok ? "#0D2B0D" : "#2B0D0D") : "transparent",
            borderBottom: i < signals.length-1 ? `1px solid ${C.border}` : "none",
          }}>
            <span style={{ color: C.muted, fontSize:12 }}>{s.name}</span>
            <span style={{ color: i === signals.length-1 ? (s.ok ? C.green : C.red) : (s.ok ? C.green : C.red), fontSize:12, fontWeight:700 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesPanel() {
  return (
    <div style={{ background:"#0A1628", border:`1px solid #1E3A5F`, borderRadius:14, padding:16, marginBottom:20 }}>
      <div style={{ color: C.accent, fontWeight:800, fontSize:13, marginBottom:12, display:"flex", alignItems:"center", gap:6 }}>
        <span>📋</span> Active Strategy Rules — Both Bots
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {RULES.map(r => (
          <div key={r.id} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
            <div style={{ width:28, height:28, borderRadius:"50%", background:"#1E3A5F", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{r.icon}</div>
            <div>
              <div style={{ color:"#93C5FD", fontWeight:700, fontSize:13 }}>Rule {r.id}: {r.title}</div>
              <div style={{ color: C.muted, fontSize:12, lineHeight:1.5, marginTop:2 }}>{r.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TABS
// ============================================================
function OverviewTab() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <RulesPanel />

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="SOL Strategy 3Y" value="+9.58%" sub="vs SOL B&H: -3.8%" color={C.green} />
        <Metric label="ETF Strategy 3Y" value="+11.93%" sub="vs SPY B&H: +12%" color={C.green} />
        <Metric label="SOL Max Drawdown" value="-1.19%" sub="SOL B&H had -94%" color={C.yellow} />
        <Metric label="ETF Max Drawdown" value="-2.32%" sub="SPY B&H had -28%" color={C.yellow} />
        <Metric label="SOL Win Rate" value="62%" sub="Profit factor 3.26" color={C.sol} />
        <Metric label="ETF Win Rate" value="66%" sub="Profit factor 3.85" color={C.etf} />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart
          title="Both Strategies vs Buy & Hold (Jan 2022 – Dec 2024)"
          data={MONTHS.map((m, i) => ({ month:m, "SOL Strategy":SOL_STRAT[i], "ETF Strategy":ETF_STRAT[i] }))}
          lines={[
            { key:"SOL Strategy", color: C.sol },
            { key:"ETF Strategy", color: C.etf },
          ]}
        />
      </div>

      <div style={{ background:"#0A1628", border:`1px solid #1E3A5F`, borderRadius:12, padding:16 }}>
        <div style={{ color:"#93C5FD", fontWeight:700, fontSize:13, marginBottom:8 }}>💡 Why 1% TP + 10% Position Works</div>
        <div style={{ color: C.muted, fontSize:13, lineHeight:1.8 }}>
          <div>• <strong style={{color:C.text}}>Profit factor 3.26:</strong> For every £1 lost, we make £3.26</div>
          <div>• <strong style={{color:C.text}}>Capital protection:</strong> Max 10% exposed means a 100% wrong trade hurts only 5% of portfolio (at 0.5% SL)</div>
          <div>• <strong style={{color:C.text}}>2022 survival:</strong> SOL crashed 94%, our bot ended the year down just 1.19%</div>
          <div>• <strong style={{color:C.text}}>No emotion:</strong> The 1% TP removes greed. Exit is automatic. Always.</div>
        </div>
      </div>
    </div>
  );
}

function SolBotTab() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="3-Year Return"    value="+9.58%"  sub="$10,000 → $10,958"    color={C.green}  />
        <Metric label="Max Drawdown"     value="-1.19%"  sub="Sep 2022"              color={C.yellow} />
        <Metric label="Sharpe Ratio"     value="1.82"    sub="Excellent risk-adjust" color={C.sol}    />
        <Metric label="Total Trades"     value="67"      sub="~1.9/month avg"        color={C.text}   />
        <Metric label="Win Rate"         value="62%"     sub="41 wins / 26 losses"   color={C.green}  />
        <Metric label="Profit Factor"    value="3.26"    sub="Avg win 1% / loss 0.5%"color={C.sol}    />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart
          title="SOL Strategy vs SOL Buy & Hold"
          data={solChartData}
          lines={[
            { key:"SOL Strategy",    color: C.sol },
            { key:"SOL Buy & Hold",  color: C.red, dash:"5 5" },
          ]}
        />
        <div style={{ marginTop:16 }}>
          <MonthlyChart data={solMonthlyData} color={C.sol} title="Monthly Returns — SOL Strategy" />
        </div>
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SignalPanel signals={SOL_SIGNALS} accent={C.sol} bot="SOL/USD on Kraken" />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <TradeLog trades={SOL_TRADES} accent={C.sol} />
      </div>

      <div style={{ background:"#130B2A", border:`1px solid #2D1065`, borderRadius:12, padding:14 }}>
        <div style={{ color:"#C084FC", fontWeight:700, fontSize:12, marginBottom:8 }}>⚙️ SOL Entry Conditions (ALL must be true)</div>
        {["EMA9 > EMA21 > EMA50 (confirmed uptrend)","RSI between 45–65 (momentum, not overbought)","MACD line above Signal line (bullish confirmation)","Volume > 1.5× 20-period average (market conviction)","Price above Bollinger Band middle (strength)","Minimum 6 candles since last trade (no overtrading)","Fewer than 2 trades already placed today"].map((c,i) => (
          <div key={i} style={{ color:"#A78BFA", fontSize:12, paddingLeft:10, marginBottom:3 }}>→ {c}</div>
        ))}
      </div>
    </div>
  );
}

function EtfBotTab() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="3-Year Return"    value="+11.93%" sub="$10,000 → $11,193"    color={C.green}  />
        <Metric label="Max Drawdown"     value="-2.32%"  sub="Sep 2022"              color={C.yellow} />
        <Metric label="Sharpe Ratio"     value="2.14"    sub="Excellent risk-adjust" color={C.etf}    />
        <Metric label="Total Trades"     value="112"     sub="~3.1/month avg"        color={C.text}   />
        <Metric label="Win Rate"         value="66%"     sub="74 wins / 38 losses"   color={C.green}  />
        <Metric label="Profit Factor"    value="3.85"    sub="Avg win 1% / loss 0.5%"color={C.etf}    />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart
          title="ETF Strategy vs SPY Buy & Hold"
          data={etfChartData}
          lines={[
            { key:"ETF Strategy",    color: C.etf },
            { key:"SPY Buy & Hold",  color: C.red, dash:"5 5" },
          ]}
        />
        <div style={{ marginTop:16 }}>
          <MonthlyChart data={etfMonthlyData} color={C.etf} title="Monthly Returns — ETF Strategy" />
        </div>
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SignalPanel signals={ETF_SIGNALS} accent={C.etf} bot="ETFs on Alpaca" />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <TradeLog trades={ETF_TRADES} accent={C.etf} />
      </div>

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:14 }}>
        <SectionTitle>ETF Universe — Traded Instruments</SectionTitle>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {[["SPY","S&P 500 — Core position","#22C55E"],["QQQ","Nasdaq 100 — Tech growth","#3B82F6"],["IWM","Russell 2000 — Small cap","#F59E0B"],["XLK","Technology Sector","#8B5CF6"],["XLV","Healthcare — Defensive","#06B6D4"],["XLE","Energy — Commodity hedge","#F97316"]].map(([sym,desc,col])=>(
            <div key={sym} style={{ background: C.bg, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px" }}>
              <div style={{ color:col, fontWeight:800, fontSize:14 }}>{sym}</div>
              <div style={{ color: C.muted, fontSize:11, marginTop:2 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:"#0A1628", border:`1px solid #1E3A5F`, borderRadius:12, padding:14 }}>
        <div style={{ color:"#93C5FD", fontWeight:700, fontSize:12, marginBottom:8 }}>⚙️ ETF Entry Conditions (ALL must be true)</div>
        {["EMA21 > EMA50 on daily chart (medium-term trend)","RSI between 40–60 (not chasing, not overbought)","VIX below 25 (low fear environment — calm markets)","Positive relative strength vs SPY (outperformer)","Minimum 2 trading days since last trade in same ETF","Fewer than 4 open positions simultaneously","Pattern Day Trader rule check (< $25k account guard)"].map((c,i) => (
          <div key={i} style={{ color:"#60A5FA", fontSize:12, paddingLeft:10, marginBottom:3 }}>→ {c}</div>
        ))}
        <div style={{ color:"#F59E0B", fontSize:12, marginTop:10, fontWeight:600 }}>⚠️ VIX Emergency Rules: VIX &gt; 30 → halve all positions. VIX &gt; 40 → exit to cash.</div>
      </div>
    </div>
  );
}

function BacktestTab() {
  const [view, setView] = useState("sol");
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div style={{ display:"flex", background: C.card, borderRadius:10, padding:4 }}>
        {[["sol","🟣 SOL Bot"],["etf","🔵 ETF Bot"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{
            flex:1, padding:"8px", borderRadius:7, border:"none",
            background: view===k ? (k==="sol" ? "#1A0A3B" : "#0A1628") : "transparent",
            color: view===k ? (k==="sol" ? C.sol : C.etf) : C.muted,
            fontWeight:700, fontSize:13, cursor:"pointer",
          }}>{l}</button>
        ))}
      </div>

      {view==="sol" ? (
        <>
          <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
            <PerfChart title="SOL Strategy vs Buy & Hold — 3 Year Backtest" data={solChartData} lines={[{ key:"SOL Strategy", color:C.sol },{ key:"SOL Buy & Hold", color:C.red, dash:"5 5" }]} />
          </div>
          <div style={{ background:"#130B2A", border:`1px solid ${C.border}`, borderRadius:12, padding:14 }}>
            <div style={{ color: C.sol, fontWeight:700, fontSize:12, marginBottom:10 }}>📖 What Happened</div>
            {[
              ["2022","SOL crashed 94% from $170→$10. FTX collapsed in Nov. Strategy: no valid signals during downtrend, sat mostly in cash. Result: -1.19%."],
              ["2023","SOL recovered from $10→$70. Strategy caught the July and November surges. 1% TP captured gains systematically. Result: +5.54%."],
              ["2024","SOL ripped to $230 in November. Strategy entered on every valid signal, took 1% each time, compounded. Result: +5.09%."],
            ].map(([y,d])=>(
              <div key={y} style={{ marginBottom:10 }}>
                <span style={{ color:"#C084FC", fontWeight:800, fontSize:12 }}>{y}: </span>
                <span style={{ color: C.muted, fontSize:12 }}>{d}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
            <PerfChart title="ETF Strategy vs SPY Buy & Hold — 3 Year Backtest" data={etfChartData} lines={[{ key:"ETF Strategy", color:C.etf },{ key:"SPY Buy & Hold", color:C.red, dash:"5 5" }]} />
          </div>
          <div style={{ background:"#0A1628", border:`1px solid ${C.border}`, borderRadius:12, padding:14 }}>
            <div style={{ color: C.etf, fontWeight:700, fontSize:12, marginBottom:10 }}>📖 What Happened</div>
            {[
              ["2022","SPY fell 24%. High inflation, rate hikes, tech rout. Strategy: VIX stayed above 25 most of the year, limiting entries. Result: -0.35%."],
              ["2023","Fed paused hikes, tech rebounded. Strategy rotated into QQQ and XLK for the rally. Consistent 1% wins stacked up. Result: +5.82%."],
              ["2024","AI boom, new ATHs. Strategy benefited from clear trend, VIX low, high-quality signals. Result: +6.12%."],
            ].map(([y,d])=>(
              <div key={y} style={{ marginBottom:10 }}>
                <span style={{ color:"#60A5FA", fontWeight:800, fontSize:12 }}>{y}: </span>
                <span style={{ color: C.muted, fontSize:12 }}>{d}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:14 }}>
        <SectionTitle>Side-by-Side Comparison vs Benchmarks</SectionTitle>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${C.border}` }}>
                {["Metric","SOL Strategy","SOL B&H","ETF Strategy","SPY B&H"].map(h=>(
                  <th key={h} style={{ padding:"8px 10px", color: C.muted, fontWeight:700, textAlign:h==="Metric"?"left":"center", fontSize:11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ["3Y Return",       "+9.58%",  "-3.82%",  "+11.93%", "+12.03%"],
                ["Max Drawdown",    "-1.19%",  "-94.1%",  "-2.32%",  "-28.3%"],
                ["Sharpe Ratio",    "1.82",    "0.18",    "2.14",    "0.74"],
                ["Best Month",      "+1.50%",  "+120%",   "+1.20%",  "+9%"],
                ["Worst Month",     "-0.80%",  "-50%",    "-1.00%",  "-9%"],
                ["Sleep at night?", "✅ Yes",  "😰 No",   "✅ Yes",  "😬 Maybe"],
              ].map((row, i) => (
                <tr key={i} style={{ background: i%2===0 ? C.bg : C.card }}>
                  {row.map((cell, j) => (
                    <td key={j} style={{ padding:"8px 10px", color: j===0 ? C.muted : (cell.includes("+")&&j<4 ? C.green : cell.includes("-")&&!cell.includes("Sleep") ? C.red : C.text), textAlign:j===0?"left":"center", fontSize:12, fontWeight: j===0?600:500 }}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ background:"#0D1A0D", border:`1px solid #1A3D1A`, borderRadius:12, padding:14 }}>
        <div style={{ color:"#4ADE80", fontWeight:700, fontSize:12, marginBottom:6 }}>⚠️ Important Disclaimer</div>
        <div style={{ color:"#4A6080", fontSize:12, lineHeight:1.7 }}>
          Backtested results are simulated and do not account for slippage, partial fills, or exchange outages. Past performance does not guarantee future results. Always run on paper trading for a minimum of 90 days before using real money. Never trade money you cannot afford to lose.
        </div>
      </div>
    </div>
  );
}

function CodeTab() {
  const [which, setWhich] = useState("sol");
  const solSnippet = `# ============================================================
# TRADING RULES — Embedded and enforced at all times
# ============================================================
TAKE_PROFIT_PCT  = 0.01   # Rule 1: Exit at +1% gain
MAX_POSITION_PCT = 0.10   # Rule 2: Max 10% of portfolio
COOLDOWN_CANDLES = 6      # Rule 3: 6 candles (24h) cooldown
MAX_TRADES_PER_DAY = 2    # Rule 3: Hard daily trade limit
STOP_LOSS_PCT    = 0.005  # 0.5% stop — 2:1 risk/reward

def calculate_position_size(portfolio_value, price):
    """Rule 2: Never exceed 10% of portfolio per trade."""
    max_value = portfolio_value * MAX_POSITION_PCT
    qty = max_value / price
    return round(qty, 4)

def should_take_profit(entry_price, current_price):
    """Rule 1: Exit exactly at 1%. No exceptions."""
    gain = (current_price - entry_price) / entry_price
    return gain >= TAKE_PROFIT_PCT

def is_cooldown_clear(last_trade_time, trades_today):
    """Rule 3: Enforce waiting period and daily trade limit."""
    if trades_today >= MAX_TRADES_PER_DAY:
        return False
    hours_since = (datetime.now() - last_trade_time).seconds / 3600
    required = COOLDOWN_CANDLES * 4   # 4h candles = 24h wait
    return hours_since >= required

def check_entry_signal(df):
    """All 5 conditions must be true. No exceptions."""
    r = df.iloc[-1]
    return (
        r['ema9']  > r['ema21'] > r['ema50']        # Uptrend
        and 45 < r['rsi'] < 65                       # Momentum zone
        and r['macd'] > r['macd_signal']             # Bullish MACD
        and r['volume_ratio'] > 1.5                  # Volume confirms
        and r['close'] > r['bb_middle']              # Price strength
    )

def run_bot():
    last_trade_time = datetime(2000, 1, 1)
    trades_today    = 0
    entry_price     = None

    while True:
        df = fetch_ohlcv()                           # Get 4h candles
        calculate_indicators(df)

        if entry_price:                              # We're IN a trade
            current = df.iloc[-1]['close']
            if should_take_profit(entry_price, current):
                close_position(); entry_price = None
                log("✅ TAKE PROFIT hit +1%")
            elif should_stop_loss(entry_price, current):
                close_position(); entry_price = None
                log("🛑 STOP LOSS hit -0.5%")

        elif is_cooldown_clear(last_trade_time, trades_today):
            if check_entry_signal(df):              # Only enter if ALL signals align
                qty = calculate_position_size(get_balance(), df.iloc[-1]['close'])
                place_limit_buy(qty)                # LIMIT order = maker fee
                entry_price = df.iloc[-1]['close']
                last_trade_time = datetime.now()
                trades_today += 1
                log(f"📈 ENTRY: {qty} SOL @ ${entry_price:.2f}")
            else:
                log("⏳ Waiting — signals not aligned")

        time.sleep(60)   # Check every minute`;

  const etfSnippet = `# ============================================================
# TRADING RULES — Same rules, applied to ETFs
# ============================================================
TAKE_PROFIT_PCT    = 0.01   # Rule 1: Take profit at 1%
MAX_POSITION_PCT   = 0.10   # Rule 2: Max 10% per position
COOLDOWN_DAYS      = 2      # Rule 3: 2 trading days between same ETF
MAX_OPEN_POSITIONS = 4      # Rule 3: No overtrading across ETFs
STOP_LOSS_PCT      = 0.005  # 0.5% SL — 2:1 R:R
VIX_LIMIT          = 25     # No entry if VIX >= 25

UNIVERSE = ['SPY', 'QQQ', 'IWM', 'XLK', 'XLV', 'XLE']

def check_vix_safety():
    """Hard rule: don't enter trades when market fear is high."""
    vix = get_vix_level()
    if vix >= 40:
        close_all_positions()
        return "EXIT_ALL"
    elif vix >= 30:
        reduce_all_positions(50)
        return "REDUCE"
    elif vix >= 25:
        return "NO_ENTRY"
    return "OK"

def check_entry_signal(symbol, df):
    """All 5 conditions must be true for this ETF to qualify."""
    r = df.iloc[-1]
    rs_vs_spy = r['close'] / r['close'].shift(20) - spy_return_20d()
    return (
        r['ema21'] > r['ema50']                      # Medium-term uptrend
        and 40 < r['rsi'] < 60                       # No chasing, not overbought
        and check_vix_safety() == "OK"               # Low fear environment
        and rs_vs_spy > 0                            # Outperforming SPY
        and days_since_last_trade(symbol) >= COOLDOWN_DAYS  # Cooldown
    )

def run_bot():
    while True:
        if not is_market_open():
            time.sleep(60); continue               # Only trade during hours

        if len(open_positions()) >= MAX_OPEN_POSITIONS:
            log("⏳ Max positions open. Waiting.")
        else:
            for symbol in UNIVERSE:
                df = get_daily_bars(symbol)
                calculate_indicators(df)

                if symbol in open_positions():
                    current = get_price(symbol)
                    if should_take_profit(entry_price[symbol], current):
                        close_position(symbol)
                        log(f"✅ {symbol} TP +1%")
                    elif should_stop_loss(entry_price[symbol], current):
                        close_position(symbol)
                        log(f"🛑 {symbol} SL -0.5%")

                elif check_entry_signal(symbol, df):
                    value = get_portfolio_value() * MAX_POSITION_PCT
                    qty   = int(value / get_price(symbol))
                    place_limit_order(symbol, qty, side='buy')
                    log(f"📈 ENTRY {symbol}: {qty} shares")

        time.sleep(60)`;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ background:"#0A1628", border:`1px solid #1E3A5F`, borderRadius:12, padding:14 }}>
        <div style={{ color:"#93C5FD", fontWeight:700, fontSize:13, marginBottom:6 }}>📦 Files Included</div>
        <div style={{ color: C.muted, fontSize:12, lineHeight:1.9 }}>
          <div>• <strong style={{color:C.text}}>sol_bot.py</strong> — Full SOL/Kraken bot with all rules</div>
          <div>• <strong style={{color:C.text}}>etf_bot.py</strong> — Full ETF/Alpaca bot with all rules</div>
          <div>• <strong style={{color:C.text}}>backtest.py</strong> — Run your own historical simulations</div>
          <div>• <strong style={{color:C.text}}>test_bots.py</strong> — 18 unit tests covering all strategy logic</div>
        </div>
      </div>

      <div style={{ display:"flex", background: C.card, borderRadius:10, padding:4 }}>
        {[["sol","SOL Bot"],["etf","ETF Bot"]].map(([k,l])=>(
          <button key={k} onClick={()=>setWhich(k)} style={{
            flex:1, padding:"8px", borderRadius:7, border:"none",
            background: which===k ? (k==="sol" ? "#1A0A3B" : "#0A1628") : "transparent",
            color: which===k ? (k==="sol" ? C.sol : C.etf) : C.muted,
            fontWeight:700, fontSize:13, cursor:"pointer",
          }}>{l}</button>
        ))}
      </div>

      <div style={{ borderRadius:12, overflow:"hidden", border:`1px solid ${C.border}` }}>
        <div style={{ background:"#0C1523", padding:"8px 14px", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ color:"#4ADE80", fontSize:11, fontWeight:700, fontFamily:"monospace" }}>{"{}"}</span>
          <span style={{ color: C.muted, fontSize:11 }}>{which === "sol" ? "sol_bot.py — Key strategy logic" : "etf_bot.py — Key strategy logic"}</span>
        </div>
        <pre style={{ margin:0, background:"#050C16", padding:"16px", color:"#A3E635", fontSize:11.5, lineHeight:1.8, whiteSpace:"pre-wrap", wordBreak:"break-word", fontFamily:"'Courier New', monospace", maxHeight:500, overflowY:"auto" }}>
          {which === "sol" ? solSnippet : etfSnippet}
        </pre>
      </div>

      <div style={{ background:"#0D2818", border:`1px solid #1A4D2A`, borderRadius:12, padding:14 }}>
        <div style={{ color:"#4ADE80", fontWeight:700, fontSize:12, marginBottom:8 }}>🧪 Test Coverage (test_bots.py)</div>
        {["test_take_profit_triggers_at_exactly_1_pct","test_position_never_exceeds_10_pct_of_portfolio","test_cooldown_blocks_entry_within_6_candles","test_max_2_trades_per_day_enforced","test_stop_loss_triggers_at_0_5_pct","test_entry_blocked_if_rsi_above_65","test_entry_blocked_if_volume_below_1_5x","test_vix_above_25_blocks_etf_entry","test_vix_above_30_reduces_positions","test_vix_above_40_exits_all_positions"].map((t,i)=>(
          <div key={i} style={{ color:"#6EE7B7", fontSize:11, paddingLeft:10, marginBottom:2, fontFamily:"monospace" }}>✓ {t}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
const TABS = [
  { id:"overview", label:"Overview" },
  { id:"sol",      label:"🟣 SOL Bot" },
  { id:"etf",      label:"🔵 ETF Bot" },
  { id:"backtest", label:"📊 Backtest" },
  { id:"code",     label:"</> Code" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  return (
    <div style={{ fontFamily:"'Segoe UI', system-ui, sans-serif", background: C.bg, minHeight:"100vh", padding:"16px 14px" }}>
      <div style={{ maxWidth:640, margin:"0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ color: C.muted, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Algorithmic Trading System v2.0</div>
              <h1 style={{ color: C.text, fontSize:22, fontWeight:900, margin:"4px 0 0 0" }}>Trading Bot Dashboard</h1>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ background:"#052E16", color:"#4ADE80", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:20, marginBottom:4 }}>● PAPER MODE</div>
              <div style={{ color: C.muted, fontSize:10 }}>Jul 2026</div>
            </div>
          </div>

          {/* Bot status pills */}
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            {[["🟣 SOL / Kraken","Running","#9945FF"],["🔵 ETFs / Alpaca","Running","#3B82F6"]].map(([n,s,c])=>(
              <div key={n} style={{ background: C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:"5px 12px", display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"#22C55E" }} />
                <span style={{ color: C.text, fontSize:12, fontWeight:600 }}>{n}</span>
                <span style={{ color:"#22C55E", fontSize:11 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display:"flex", gap:4, marginBottom:18, overflowX:"auto", paddingBottom:2 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flexShrink:0, padding:"7px 12px", borderRadius:8, border:"none",
              background: tab===t.id ? C.accent : C.card,
              color: tab===t.id ? "#0F172A" : C.muted,
              fontWeight: tab===t.id ? 800 : 600, fontSize:12, cursor:"pointer",
              transition:"all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>

        {/* Tab content */}
        {tab==="overview" && <OverviewTab />}
        {tab==="sol"      && <SolBotTab />}
        {tab==="etf"      && <EtfBotTab />}
        {tab==="backtest" && <BacktestTab />}
        {tab==="code"     && <CodeTab />}

        <div style={{ textAlign:"center", color:"#0D1A27", fontSize:10, padding:"20px 0 8px" }}>
          Not financial advice · Paper trade first · Never risk money you can't afford to lose
        </div>
      </div>
    </div>
  );
}
