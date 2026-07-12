import { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart, Bar, Cell, ReferenceLine,
} from "recharts";

// ============================================================
// STRATEGY RULES — enforced in rules.py, mirrored here
// ============================================================
const RULES = [
  { icon: "🎯", title: "Take Profit 1%", desc: "Every position exits at +1%. Automatic, no exceptions." },
  { icon: "🛡️", title: "Max 10% / Position", desc: "One trade can never expose more than 10% of the portfolio." },
  { icon: "⏳", title: "No Overtrading", desc: "Max 2 trades/day globally, 24h cooldown per pair, 2-day per ETF." },
  { icon: "🚨", title: "-2% Circuit Breaker", desc: "Daily loss hits -2% → bot halts new entries until tomorrow." },
  { icon: "💯", title: "5/5 Signals Only", desc: "Crypto entries require ALL five conditions. A 4/5 is not a trade." },
  { icon: "💧", title: "Liquidity Filter", desc: "Min $5M daily volume + max 0.2% spread. Thin markets never qualify." },
];

// ============================================================
// BACKTEST DATA — Jan 2022 to Dec 2024 (illustrative)
// ============================================================
const MONTHS = [
  "Jan'22","Feb'22","Mar'22","Apr'22","May'22","Jun'22","Jul'22","Aug'22","Sep'22","Oct'22","Nov'22","Dec'22",
  "Jan'23","Feb'23","Mar'23","Apr'23","May'23","Jun'23","Jul'23","Aug'23","Sep'23","Oct'23","Nov'23","Dec'23",
  "Jan'24","Feb'24","Mar'24","Apr'24","May'24","Jun'24","Jul'24","Aug'24","Sep'24","Oct'24","Nov'24","Dec'24",
];
const CRYPTO_STRAT = [
  9960,9930,9985,9945,9945,9960,10000,9990,9950,9965,9935,9950,
  10040,10110,10085,10145,10115,10130,10260,10230,10200,10290,10450,10580,
  10710,10820,10935,10855,10945,10915,10885,10855,10945,11035,11205,11165,
];
const BTC_BH = [
  9200,8300,9100,7600,6100,3900,4600,4000,3800,4000,3300,3200,
  4500,4600,5500,5700,5300,5900,5700,5100,5200,6700,7300,8200,
  8300,11900,13800,11700,13100,12200,12500,11400,12300,14000,18700,18200,
];
const CRYPTO_MO = [
  -0.4,-0.3,0.55,-0.4,0,0.15,0.4,-0.1,-0.4,0.15,-0.3,0.15,
  0.9,0.7,-0.25,0.6,-0.3,0.15,1.28,-0.29,-0.29,0.88,1.55,1.24,
  1.23,1.03,1.06,-0.73,0.83,-0.27,-0.27,-0.28,0.83,0.82,1.54,-0.36,
];
const ETF_STRAT = [
  9900,9821,9850,9751,9799,9878,9927,9877,9778,9856,9935,9965,
  10085,10166,10196,10247,10298,10401,10484,10432,10348,10317,10441,10545,
  10629,10735,10842,10788,10896,10983,11038,11005,11060,11027,11137,11193,
];
const SPY_BH = [
  9500,9215,9584,8721,8198,7542,8221,7892,7181,7755,8143,7654,
  8113,7870,8185,8267,8184,8757,9020,8840,8486,8231,8972,9421,
  9609,10090,10393,9977,10476,10790,10898,10680,10894,10785,11432,11203,
];
const ETF_MO = [
  -1.0,-0.8,0.3,-1.0,0.5,0.8,0.5,-0.5,-1.0,0.8,0.8,0.3,
  1.2,0.8,0.3,0.5,0.5,1.0,0.8,-0.5,-0.8,-0.3,1.2,1.0,
  0.8,1.0,1.0,-0.5,1.0,0.8,0.5,-0.3,0.5,-0.3,1.0,0.5,
];

// ============================================================
// LIVE STATE (illustrative — wire to your bot's journal/logs)
// ============================================================
const OPEN_POSITIONS = [
  { pair:"XXBTZUSD", label:"BTC/USD", entry:118420.00, current:119210.35, qty:0.0084, slot:1 },
  { pair:"XETHZUSD", label:"ETH/USD", entry:4212.50,   current:4231.10,   qty:0.2374, slot:2 },
];
const SCANNER_RESULTS = [
  { pair:"BTC/USD",  score:5, ready:true,  vol:"$2.4B", spread:"0.01%", note:"IN POSITION" },
  { pair:"ETH/USD",  score:5, ready:true,  vol:"$1.1B", spread:"0.01%", note:"IN POSITION" },
  { pair:"SOL/USD",  score:4, ready:false, vol:"$310M", spread:"0.03%", note:"volume 1.3× (needs 1.5×)" },
  { pair:"XRP/USD",  score:4, ready:false, vol:"$180M", spread:"0.04%", note:"RSI 67 (needs <65)" },
  { pair:"ADA/USD",  score:3, ready:false, vol:"$62M",  spread:"0.06%", note:"MACD below signal" },
  { pair:"LINK/USD", score:3, ready:false, vol:"$48M",  spread:"0.07%", note:"below BB middle" },
  { pair:"DOGE/USD", score:2, ready:false, vol:"$95M",  spread:"0.05%", note:"trend broken" },
];
const CRYPTO_TRADES = [
  { date:"Jul 11", pair:"BTC/USD",  side:"BUY",  pct:"open",   result:"OPEN", reason:"Scanner 5/5 · slot 1/3" },
  { date:"Jul 11", pair:"ETH/USD",  side:"BUY",  pct:"open",   result:"OPEN", reason:"Scanner 5/5 · slot 2/3" },
  { date:"Jul 09", pair:"SOL/USD",  side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1%" },
  { date:"Jul 08", pair:"BTC/USD",  side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1%" },
  { date:"Jul 06", pair:"XRP/USD",  side:"SELL", pct:"-0.50%", result:"LOSS", reason:"SL -0.5%" },
  { date:"Jul 04", pair:"ETH/USD",  side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1%" },
  { date:"Jul 02", pair:"BTC/USD",  side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1%" },
];
const ETF_TRADES = [
  { date:"Jul 10", pair:"QQQ", side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1% · VIX 15.9" },
  { date:"Jul 08", pair:"SPY", side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1% · VIX 16.2" },
  { date:"Jul 03", pair:"XLK", side:"SELL", pct:"-0.50%", result:"LOSS", reason:"SL — CPI surprise" },
  { date:"Jun 29", pair:"IWM", side:"SELL", pct:"+1.00%", result:"WIN",  reason:"TP +1%" },
];
const ETF_SIGNALS = [
  { name:"SPY EMA 21 > 50",   value:"✅ Bullish",        ok:true },
  { name:"RSI (14)",           value:"54 — OK",           ok:true },
  { name:"VIX Level",          value:"17.4 — calm",       ok:true },
  { name:"Sector RS vs SPY",   value:"QQQ +0.4%",         ok:true },
  { name:"PDT Guard",          value:"✅ Safe",           ok:true },
  { name:"Open positions",     value:"2 / 4 max",         ok:true },
  { name:"Overall",            value:"🟢 WATCHING QQQ",   ok:true },
];

// ============================================================
const C = {
  bg:"#050C16", card:"#0C1523", border:"#162032", text:"#E2E8F0",
  muted:"#4A6080", accent:"#38BDF8", green:"#22C55E", red:"#EF4444",
  yellow:"#F59E0B", crypto:"#F7931A", etf:"#3B82F6",
};
const cryptoChart = MONTHS.map((m,i)=>({ month:m, "Crypto Strategy":CRYPTO_STRAT[i], "BTC Buy & Hold":BTC_BH[i] }));
const etfChart = MONTHS.map((m,i)=>({ month:m, "ETF Strategy":ETF_STRAT[i], "SPY Buy & Hold":SPY_BH[i] }));
const tooltipStyle = {
  contentStyle:{ background:"#0C1523", border:"1px solid #162032", borderRadius:8, color:"#E2E8F0", fontSize:12 },
  labelStyle:{ color:"#4A6080" },
};

function Metric({ label, value, sub, color=C.text }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"13px 15px" }}>
      <div style={{ color:C.muted, fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:0.8, marginBottom:5 }}>{label}</div>
      <div style={{ color, fontSize:19, fontWeight:800 }}>{value}</div>
      {sub && <div style={{ color:C.muted, fontSize:11, marginTop:4 }}>{sub}</div>}
    </div>
  );
}
function SectionTitle({ children }) {
  return <div style={{ color:C.muted, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1, marginBottom:10 }}>{children}</div>;
}
function PerfChart({ data, lines, title }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={data} margin={{ top:4, right:8, left:0, bottom:0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0D1A27" />
          <XAxis dataKey="month" tick={{ fill:C.muted, fontSize:9 }} interval={5} />
          <YAxis tickFormatter={v=>`$${(v/1000).toFixed(1)}k`} tick={{ fill:C.muted, fontSize:9 }} width={46} />
          <Tooltip formatter={(v,n)=>[`$${v.toLocaleString()}`,n]} {...tooltipStyle} />
          <Legend wrapperStyle={{ fontSize:11, paddingTop:8 }} />
          <ReferenceLine y={10000} stroke="#1E3A5F" strokeDasharray="4 4" />
          {lines.map(l=><Line key={l.key} dataKey={l.key} stroke={l.color} dot={false} strokeWidth={2} strokeDasharray={l.dash} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
function MonthlyChart({ data, title }) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top:4, right:8, left:0, bottom:0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#0D1A27" vertical={false} />
          <XAxis dataKey="month" tick={{ fill:C.muted, fontSize:8 }} interval={5} />
          <YAxis tickFormatter={v=>`${v}%`} tick={{ fill:C.muted, fontSize:9 }} width={34} />
          <Tooltip formatter={v=>[`${v}%`,"Return"]} {...tooltipStyle} />
          <ReferenceLine y={0} stroke="#1E3A5F" />
          <Bar dataKey="return" radius={[2,2,0,0]}>
            {data.map((e,i)=><Cell key={i} fill={e.return>=0?C.green:C.red} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function TradeLog({ trades, accent }) {
  return (
    <div>
      <SectionTitle>Trade Journal</SectionTitle>
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {trades.map((t,i)=>(
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"9px 12px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:3 }}>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ color:C.muted, fontSize:11 }}>{t.date}</span>
                <span style={{ color:accent, fontWeight:800, fontSize:13 }}>{t.pair}</span>
                <span style={{ background:t.side==="BUY"?"#052E16":"#1A1005", color:t.side==="BUY"?C.green:C.yellow, fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:20 }}>{t.side}</span>
              </div>
              <span style={{ color:t.result==="WIN"?C.green:t.result==="LOSS"?C.red:C.accent, fontWeight:800, fontSize:13 }}>{t.pct}</span>
            </div>
            <div style={{ display:"flex", justifyContent:"space-between" }}>
              <span style={{ color:C.muted, fontSize:11 }}>{t.reason}</span>
              <span style={{ color:t.result==="WIN"?C.green:t.result==="LOSS"?C.red:C.accent, fontSize:11, fontWeight:700 }}>{t.result}</span>
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
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ background:"#0A1628", border:"1px solid #1E3A5F", borderRadius:14, padding:16 }}>
        <div style={{ color:C.accent, fontWeight:800, fontSize:13, marginBottom:12 }}>📋 Active Rules — Both Bots</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          {RULES.map(r=>(
            <div key={r.title} style={{ display:"flex", gap:9, alignItems:"flex-start" }}>
              <span style={{ fontSize:16, flexShrink:0 }}>{r.icon}</span>
              <div>
                <div style={{ color:"#93C5FD", fontWeight:700, fontSize:12 }}>{r.title}</div>
                <div style={{ color:C.muted, fontSize:11, lineHeight:1.45, marginTop:1 }}>{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="Crypto 3Y Backtest" value="+11.65%" sub="Max DD -1.1% · 5/5 entries only" color={C.green} />
        <Metric label="ETF 3Y Backtest" value="+11.93%" sub="Max DD -2.3% · VIX filtered" color={C.green} />
        <Metric label="Crypto Positions" value="2 / 3" sub="Global cap across all pairs" color={C.crypto} />
        <Metric label="ETF Positions" value="2 / 4" sub="SPY QQQ open" color={C.etf} />
        <Metric label="Trades Today" value="2 / 2" sub="Rule 3: done for the day" color={C.yellow} />
        <Metric label="Circuit Breaker" value="Armed" sub="Day P&L +0.4% (trips at -2%)" color={C.green} />
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart
          title="Both Strategies — 3Y Backtest ($10k start)"
          data={MONTHS.map((m,i)=>({ month:m, "Crypto Strategy":CRYPTO_STRAT[i], "ETF Strategy":ETF_STRAT[i] }))}
          lines={[{ key:"Crypto Strategy", color:C.crypto },{ key:"ETF Strategy", color:C.etf }]}
        />
      </div>
    </div>
  );
}

function CryptoTab() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      {/* Open positions */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SectionTitle>Open Positions — {OPEN_POSITIONS.length} / 3 slots</SectionTitle>
        {OPEN_POSITIONS.map(p=>{
          const pnl = ((p.current-p.entry)/p.entry*100);
          const toTP = (1 - pnl).toFixed(2);
          return (
            <div key={p.pair} style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:"11px 13px", marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ color:C.crypto, fontWeight:800, fontSize:14 }}>{p.label}</span>
                <span style={{ color:pnl>=0?C.green:C.red, fontWeight:800, fontSize:14 }}>{pnl>=0?"+":""}{pnl.toFixed(2)}%</span>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", color:C.muted, fontSize:11 }}>
                <span>Entry ${p.entry.toLocaleString()} → ${p.current.toLocaleString()}</span>
                <span>{toTP}% to TP</span>
              </div>
              {/* progress to TP */}
              <div style={{ background:"#0D1A27", borderRadius:99, height:5, marginTop:8 }}>
                <div style={{ height:"100%", borderRadius:99, background:`linear-gradient(90deg,${C.crypto},${C.green})`, width:`${Math.max(0,Math.min(100,pnl/1*100))}%` }} />
              </div>
            </div>
          );
        })}
        <div style={{ color:C.muted, fontSize:11, marginTop:4 }}>Free slot available — scanner active every 15 min</div>
      </div>

      {/* Scanner */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SectionTitle>Live Scanner — Top pairs by volume (liquidity-filtered)</SectionTitle>
        {SCANNER_RESULTS.map(s=>(
          <div key={s.pair} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 4px", borderBottom:`1px solid ${C.border}` }}>
            <span style={{ fontSize:13, flexShrink:0 }}>{s.ready?"🟢":s.score>=4?"🟡":"⚪"}</span>
            <span style={{ color:C.text, fontWeight:700, fontSize:13, minWidth:82 }}>{s.pair}</span>
            <div style={{ display:"flex", gap:2 }}>
              {[1,2,3,4,5].map(i=>(
                <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:i<=s.score?(s.ready?C.green:C.yellow):"#1A2332" }} />
              ))}
            </div>
            <span style={{ color:C.muted, fontSize:10, marginLeft:"auto", textAlign:"right" }}>{s.note}</span>
          </div>
        ))}
        <div style={{ color:C.muted, fontSize:11, marginTop:10 }}>
          🟢 5/5 = tradeable · 🟡 4/5 = close but NO trade · Filter: $5M+ vol, ≤0.2% spread
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="3Y Backtest" value="+11.65%" sub="vs BTC B&H +82% (but -69% DD!)" color={C.green} />
        <Metric label="Max Drawdown" value="-1.1%" sub="BTC B&H suffered -69%" color={C.yellow} />
        <Metric label="Win Rate" value="64%" sub="Profit factor 3.4" color={C.crypto} />
        <Metric label="Sharpe" value="1.94" sub="Risk-adjusted quality" color={C.crypto} />
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart title="Crypto Strategy vs BTC Buy & Hold" data={cryptoChart}
          lines={[{ key:"Crypto Strategy", color:C.crypto },{ key:"BTC Buy & Hold", color:C.red, dash:"5 5" }]} />
        <div style={{ marginTop:14 }}>
          <MonthlyChart data={MONTHS.map((m,i)=>({ month:m, return:CRYPTO_MO[i] }))} title="Monthly Returns" />
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <TradeLog trades={CRYPTO_TRADES} accent={C.crypto} />
      </div>
    </div>
  );
}

function EtfTab() {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
        <Metric label="3Y Backtest" value="+11.93%" sub="$10,000 → $11,193" color={C.green} />
        <Metric label="Max Drawdown" value="-2.32%" sub="SPY B&H had -28%" color={C.yellow} />
        <Metric label="Win Rate" value="66%" sub="Profit factor 3.85" color={C.etf} />
        <Metric label="Sharpe" value="2.14" sub="Risk-adjusted quality" color={C.etf} />
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SectionTitle>Live Signals</SectionTitle>
        <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden" }}>
          {ETF_SIGNALS.map((s,i)=>(
            <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"9px 14px",
              background:i===ETF_SIGNALS.length-1?"#0D2B0D":"transparent",
              borderBottom:i<ETF_SIGNALS.length-1?`1px solid ${C.border}`:"none" }}>
              <span style={{ color:C.muted, fontSize:12 }}>{s.name}</span>
              <span style={{ color:s.ok?C.green:C.red, fontSize:12, fontWeight:700 }}>{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <PerfChart title="ETF Strategy vs SPY Buy & Hold" data={etfChart}
          lines={[{ key:"ETF Strategy", color:C.etf },{ key:"SPY Buy & Hold", color:C.red, dash:"5 5" }]} />
        <div style={{ marginTop:14 }}>
          <MonthlyChart data={MONTHS.map((m,i)=>({ month:m, return:ETF_MO[i] }))} title="Monthly Returns" />
        </div>
      </div>

      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <TradeLog trades={ETF_TRADES} accent={C.etf} />
      </div>

      <div style={{ background:"#0A1628", border:"1px solid #1E3A5F", borderRadius:12, padding:14 }}>
        <div style={{ color:"#93C5FD", fontWeight:700, fontSize:12, marginBottom:6 }}>Universe: SPY · QQQ · IWM · XLK · XLV · XLE</div>
        <div style={{ color:"#F59E0B", fontSize:12, fontWeight:600 }}>⚠️ VIX rules: ≥25 no entries · ≥30 halve positions · ≥40 exit to cash</div>
      </div>
    </div>
  );
}

function ArchitectureTab() {
  const files = [
    ["rules.py","Single source of truth. Every risk rule as a pure, tested function. Both bots import it — neither can bypass it."],
    ["scanner.py","Scores symbols 0–5 against entry conditions. Standalone tool + the engine inside crypto_bot."],
    ["crypto_bot.py","Kraken. Every 15 min: top 30 USD pairs → liquidity filter → 5/5 entries only → max 3 open positions."],
    ["etf_bot.py","Alpaca. Fixed 6-ETF universe, VIX regime filter, PDT guard, kill switch (--kill)."],
    ["backtest.py","Historical validation with FEES and SLIPPAGE modeled — the honest kind."],
    ["test_bots.py","38 unit tests. Run before every deploy: python3 test_bots.py"],
    ["trade_journal.csv","Every fill from both bots. Weekly review + tax records. Git-ignored (private)."],
  ];
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:18 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:16 }}>
        <SectionTitle>System Architecture</SectionTitle>
        {files.map(([f,d])=>(
          <div key={f} style={{ display:"flex", gap:12, padding:"9px 0", borderBottom:`1px solid ${C.border}` }}>
            <code style={{ color:C.accent, fontSize:12, fontFamily:"monospace", minWidth:130, flexShrink:0 }}>{f}</code>
            <span style={{ color:C.muted, fontSize:12, lineHeight:1.5 }}>{d}</span>
          </div>
        ))}
      </div>

      <div style={{ borderRadius:12, overflow:"hidden", border:`1px solid ${C.border}` }}>
        <div style={{ background:C.card, padding:"7px 14px", borderBottom:`1px solid ${C.border}` }}>
          <span style={{ color:"#4ADE80", fontSize:11, fontWeight:700, fontFamily:"monospace" }}>{"{}"} crypto_bot.py — the decision flow</span>
        </div>
        <pre style={{ margin:0, background:"#050A14", padding:16, color:"#A3E635", fontSize:11.5, lineHeight:1.8, whiteSpace:"pre-wrap", fontFamily:"'Courier New', monospace" }}>
{`every 60s:  manage open positions
            → TP at +1%?  sell, journal, free the slot
            → SL at -0.5%? sell, journal, free the slot

every 15m:  scan for entries — but ONLY if:
            ✓ circuit breaker not tripped (day P&L > -2%)
            ✓ open positions < 3 (global cap)
            ✓ trades today < 2 (Rule 3)

            for each top-30 pair passing liquidity filter:
              ✓ not already held
              ✓ 24h per-pair cooldown clear
              ✓ scanner score == 5/5  ← 4/5 is NOT a trade
              → buy 10% of portfolio at the ask, journal`}
        </pre>
      </div>

      <div style={{ background:"#0D2818", border:"1px solid #1A4D2A", borderRadius:12, padding:14 }}>
        <div style={{ color:"#4ADE80", fontWeight:700, fontSize:12, marginBottom:8 }}>🧪 38 tests — key coverage</div>
        {["TP triggers at exactly 1% · position ≤ 10% always","cooldowns + daily caps block correctly","circuit breaker trips at -2%, not before","scanner: uptrend scores high, downtrend never READY","liquidity: $5M floor, 0.2% spread ceiling, crossed quotes rejected","global cap: no 4th position, ever"].map((t,i)=>(
          <div key={i} style={{ color:"#6EE7B7", fontSize:11, paddingLeft:8, marginBottom:3, fontFamily:"monospace" }}>✓ {t}</div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
const TABS = [
  { id:"overview", label:"Overview" },
  { id:"crypto",   label:"🟠 Crypto Bot" },
  { id:"etf",      label:"🔵 ETF Bot" },
  { id:"arch",     label:"⚙️ System" },
];

export default function App() {
  const [tab, setTab] = useState("overview");
  return (
    <div style={{ fontFamily:"'Segoe UI', system-ui, sans-serif", background:C.bg, minHeight:"100vh", padding:"16px 14px" }}>
      <div style={{ maxWidth:640, margin:"0 auto" }}>
        <div style={{ marginBottom:18 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ color:C.muted, fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:1 }}>Algorithmic Trading System v3.0</div>
              <h1 style={{ color:C.text, fontSize:21, fontWeight:900, margin:"4px 0 0 0" }}>Multi-Pair Trading Dashboard</h1>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ background:"#052E16", color:"#4ADE80", fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:20, marginBottom:4 }}>● PAPER MODE</div>
              <div style={{ color:C.muted, fontSize:10 }}>Jul 2026</div>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            {[["🟠 Crypto / Kraken","top 30 pairs"],["🔵 ETFs / Alpaca","6 instruments"]].map(([n,s])=>(
              <div key={n} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:20, padding:"5px 12px", display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:C.green }} />
                <span style={{ color:C.text, fontSize:12, fontWeight:600 }}>{n}</span>
                <span style={{ color:C.muted, fontSize:11 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display:"flex", gap:4, marginBottom:16, overflowX:"auto" }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              flexShrink:0, padding:"7px 13px", borderRadius:8, border:"none",
              background:tab===t.id?C.accent:C.card, color:tab===t.id?"#0F172A":C.muted,
              fontWeight:tab===t.id?800:600, fontSize:12, cursor:"pointer",
            }}>{t.label}</button>
          ))}
        </div>

        {tab==="overview" && <OverviewTab />}
        {tab==="crypto"   && <CryptoTab />}
        {tab==="etf"      && <EtfTab />}
        {tab==="arch"     && <ArchitectureTab />}

        <div style={{ textAlign:"center", color:"#0D1A27", fontSize:10, padding:"18px 0 8px" }}>
          Illustrative data — wire to trade_journal.csv for live values · Not financial advice
        </div>
      </div>
    </div>
  );
}
