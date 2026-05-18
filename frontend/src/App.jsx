import { useState, useEffect, useCallback } from 'react'

const API = 'http://localhost:8000'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function verdictColor(verdict) {
  if (verdict === 'SAFE')    return { badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', dot: 'bg-emerald-400' }
  if (verdict === 'WARNING') return { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30',     dot: 'bg-amber-400' }
  if (verdict === 'FLAGGED') return { badge: 'bg-red-500/15 text-red-400 border-red-500/30',           dot: 'bg-red-500' }
  return { badge: 'bg-gray-700 text-gray-400 border-gray-600', dot: 'bg-gray-500' }
}

function highlightClaims(text, claims) {
  if (!claims || claims.length === 0) return <span>{text}</span>
  const parts = []
  let remaining = text
  const sorted = [...claims].sort((a, b) => b.length - a.length)
  for (const claim of sorted) {
    const idx = remaining.indexOf(claim)
    if (idx === -1) continue
    if (idx > 0) parts.push(<span key={`pre-${parts.length}`}>{remaining.slice(0, idx)}</span>)
    parts.push(
      <span key={`claim-${parts.length}`} className="bg-red-500/20 text-red-300 border-b border-red-500/60 px-0.5 rounded-sm">
        {claim}
      </span>
    )
    remaining = remaining.slice(idx + claim.length)
  }
  if (remaining) parts.push(<span key="tail">{remaining}</span>)
  return <>{parts}</>
}

function ProgressBar({ label, value, color }) {
  const pct = Math.round((value ?? 0) * 100)
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="font-mono font-semibold text-gray-200">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  )
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({ online }) {
  return (
    <header className="flex items-center justify-between px-6 py-3 bg-gray-900/80 border-b border-gray-800 backdrop-blur-sm sticky top-0 z-50">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1L12 4V10L7 13L2 10V4L7 1Z" stroke="#22d3ee" strokeWidth="1.2"/>
            <circle cx="7" cy="7" r="1.8" fill="#22d3ee"/>
          </svg>
        </div>
        <span className="font-bold text-white tracking-widest text-sm">SENTINEL</span>
      </div>

      <div className="flex flex-col items-center">
        <span className="text-gray-200 text-sm font-semibold tracking-wide">MedFlow Health</span>
        <span className="text-gray-500 text-[10px] tracking-widest uppercase">Clinical AI Safety Platform</span>
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 border border-gray-700/60 rounded-full">
        <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]' : 'bg-red-500'}`} />
        <span className={`text-xs font-medium ${online ? 'text-emerald-400' : 'text-red-400'}`}>
          {online ? 'System Online' : 'System Offline'}
        </span>
      </div>
    </header>
  )
}

// ─── Metrics Row ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent }) {
  return (
    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-1">
      <span className="text-xs text-gray-500 uppercase tracking-widest font-medium">{label}</span>
      <span className={`text-3xl font-bold font-mono ${accent}`}>{value}</span>
      {sub && <span className="text-xs text-gray-600 mt-0.5">{sub}</span>}
    </div>
  )
}

function MetricsRow({ logs }) {
  const total = logs.length
  const flagged = logs.filter(l => l.safety?.verdict === 'FLAGGED').length
  const safe = logs.filter(l => l.safety?.verdict === 'SAFE').length
  const safetyScore = total > 0 ? Math.round((safe / total) * 100) : 100

  return (
    <div className="flex gap-4">
      <MetricCard
        label="Total Queries"
        value={total}
        sub="session lifetime"
        accent="text-cyan-400"
      />
      <MetricCard
        label="Flagged"
        value={flagged}
        sub={total > 0 ? `${Math.round((flagged / total) * 100)}% flag rate` : 'no activity'}
        accent={flagged > 0 ? 'text-red-400' : 'text-gray-400'}
      />
      <MetricCard
        label="Safety Score"
        value={`${safetyScore}%`}
        sub={total > 0 ? `${safe} of ${total} queries clean` : 'awaiting queries'}
        accent={safetyScore >= 80 ? 'text-emerald-400' : safetyScore >= 50 ? 'text-amber-400' : 'text-red-400'}
      />
    </div>
  )
}

// ─── Query Interface ──────────────────────────────────────────────────────────

function QueryInterface({ onNewLog }) {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function sendQuery() {
    if (!message.trim() || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${API}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
      onNewLog()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const safety = result?.safety

  return (
    <div className="flex gap-4">
      {/* Left — Input + Response */}
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Query Agent</h2>
        </div>

        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendQuery() }}
          placeholder="Enter a clinical query for the decision support agent… (⌘↵ to send)"
          rows={4}
          className="w-full bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
        />

        <button
          onClick={sendQuery}
          disabled={loading || !message.trim()}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? <><Spinner /> Evaluating…</> : 'Send Query'}
        </button>

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
        )}

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 uppercase tracking-widest">Agent Response</span>
              {safety?.flagged_claims?.length > 0 && (
                <span className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                  {safety.flagged_claims.length} claim{safety.flagged_claims.length > 1 ? 's' : ''} flagged
                </span>
              )}
            </div>
            <div className="bg-gray-800/40 border border-gray-700/60 rounded-lg px-4 py-3 text-sm text-gray-300 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
              {highlightClaims(result.gemini_response, safety?.flagged_claims)}
            </div>
          </div>
        )}
      </div>

      {/* Right — Safety Verdict */}
      <div className="w-80 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Safety Evaluation</h2>
        </div>

        {!safety ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-10">
            <div className="w-12 h-12 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M10 2L17 6V11C17 14.5 14 17.5 10 18C6 17.5 3 14.5 3 11V6L10 2Z" stroke="#374151" strokeWidth="1.5"/>
              </svg>
            </div>
            <p className="text-xs text-gray-600">Send a query to see<br/>the safety evaluation</p>
          </div>
        ) : (() => {
          const { badge, dot } = verdictColor(safety.verdict)
          return (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Verdict</span>
                <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  {safety.verdict}
                </span>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Confidence</span>
                  <span className="font-mono font-semibold text-gray-200">{Math.round(safety.confidence * 100)}%</span>
                </div>
                <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500 transition-all duration-700" style={{ width: `${Math.round(safety.confidence * 100)}%` }} />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">HIPAA Risk</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${safety.hipaa_risk ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                  {safety.hipaa_risk ? 'DETECTED' : 'CLEAR'}
                </span>
              </div>

              {safety.flags?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-gray-500">Flags</span>
                  <div className="flex flex-wrap gap-1.5">
                    {safety.flags.map(f => (
                      <span key={f} className="text-[10px] font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2 py-0.5 rounded">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <span className="text-xs text-gray-500">Explanation</span>
                <p className="text-xs text-gray-400 leading-relaxed bg-gray-800/40 rounded-lg px-3 py-2.5 border border-gray-700/40">
                  {safety.explanation}
                </p>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ─── Before / After Comparison ───────────────────────────────────────────────


function ComparisonPanel() {
  const [message, setMessage]       = useState('')
  const [active, setActive]         = useState(false)
  const [beforeLoading, setBeforeLoading] = useState(false)
  const [afterLoading,  setAfterLoading]  = useState(false)
  const [before, setBefore]         = useState(null)
  const [after,  setAfter]          = useState(null)
  const [beforeErr, setBeforeErr]   = useState(null)
  const [afterErr,  setAfterErr]    = useState(null)

  async function runComparison(query) {
    const q = (query ?? message).trim()
    if (!q || active) return

    setActive(true)
    setBefore(null); setAfter(null)
    setBeforeErr(null); setAfterErr(null)
    setBeforeLoading(true); setAfterLoading(true)

    // Fire both independently — each updates its panel as soon as it resolves
    async function fetchBefore() {
      try {
        const res = await fetch(`${API}/query-unsafe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q }),
        })
        if (res.ok) setBefore(await res.json())
        else { const e = await res.json(); setBeforeErr(e.detail || `HTTP ${res.status}`) }
      } catch (e) { setBeforeErr(e.message) }
      finally { setBeforeLoading(false) }
    }

    async function fetchAfter() {
      try {
        const res = await fetch(`${API}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q }),
        })
        if (res.ok) setAfter(await res.json())
        else { const e = await res.json(); setAfterErr(e.detail || `HTTP ${res.status}`) }
      } catch (e) { setAfterErr(e.message) }
      finally { setAfterLoading(false) }
    }

    await Promise.all([fetchBefore(), fetchAfter()])
    setActive(false)
  }

const safety = after?.safety
  const vc = safety ? verdictColor(safety.verdict) : null

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">

      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
        <div className="flex items-center gap-2.5">
          <div className="w-1.5 h-1.5 rounded-full bg-orange-400" />
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Before / After Comparison</span>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">

        {/* Input */}
        <div className="flex gap-3">
          <input
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runComparison() }}
            placeholder="Enter a clinical query to compare guarded vs unguarded responses…"
            className="flex-1 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-orange-500/50 focus:ring-1 focus:ring-orange-500/20 transition-colors"
          />
          <button
            onClick={() => runComparison()}
            disabled={active || !message.trim()}
            className="flex items-center gap-2 px-5 py-2.5 bg-orange-600/20 hover:bg-orange-600/30 border border-orange-600/30 disabled:opacity-40 text-orange-400 text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
          >
            {active ? <><Spinner /> Running…</> : 'Run Comparison'}
          </button>
        </div>

        {/* Panels — only mount once either side has started */}
        {(beforeLoading || afterLoading || before || after || beforeErr || afterErr) && (
          <div className="grid grid-cols-2 gap-4 mt-1">

            {/* ── BEFORE ── */}
            <div className="flex flex-col rounded-xl border border-red-900/50 overflow-hidden">
              {/* panel header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-red-950/40 border-b border-red-900/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs font-bold text-red-400 tracking-widest uppercase">Before</span>
                  <span className="text-[10px] text-red-700 font-mono">/query-unsafe</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-red-500/15 text-red-400 border-red-500/30 tracking-wide">
                  UNGUARDED
                </span>
              </div>

              {/* panel body */}
              <div className="flex flex-col gap-3 p-4 bg-red-950/10 flex-1">
                {beforeLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-600 py-2">
                    <Spinner /><span>Querying unguarded agent…</span>
                  </div>
                )}
                {beforeErr && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{beforeErr}</p>
                )}
                {before && (
                  <>
                    <div className="text-sm text-red-200/80 leading-relaxed bg-black/20 border border-red-900/40 rounded-lg px-4 py-3 max-h-64 overflow-y-auto whitespace-pre-wrap">
                      {before.response}
                    </div>
                    <div className="flex items-start gap-1.5 text-[10px] text-red-600/60 mt-auto pt-1">
                      <svg className="mt-px shrink-0" width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2"/>
                        <path d="M5 3v2.5M5 7h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      </svg>
                      No safety evaluation — response delivered directly to user
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── AFTER ── */}
            <div className="flex flex-col rounded-xl border border-emerald-900/50 overflow-hidden">
              {/* panel header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-950/40 border-b border-emerald-900/40">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-bold text-emerald-400 tracking-widest uppercase">After</span>
                  <span className="text-[10px] text-emerald-800 font-mono">/query</span>
                </div>
                {vc ? (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${vc.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${vc.dot}`} />
                    {safety.verdict}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-500/15 text-emerald-500 border-emerald-500/30 tracking-wide">
                    SENTINEL ACTIVE
                  </span>
                )}
              </div>

              {/* panel body */}
              <div className="flex flex-col gap-3 p-4 bg-emerald-950/10 flex-1">
                {afterLoading && (
                  <div className="flex items-center gap-2 text-xs text-gray-600 py-2">
                    <Spinner /><span>Intercepting + evaluating with SENTINEL…</span>
                  </div>
                )}
                {afterErr && (
                  <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{afterErr}</p>
                )}
                {after && (
                  <div className="text-sm text-gray-300 leading-relaxed bg-black/20 border border-emerald-900/30 rounded-lg px-4 py-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {highlightClaims(after.gemini_response, safety?.flagged_claims)}
                  </div>
                )}

                {safety && (
                  <div className="flex flex-col gap-2.5 border-t border-emerald-900/30 pt-3 mt-auto">

                    {/* Confidence bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-gray-500">Judge confidence</span>
                        <span className="font-mono text-gray-400">{Math.round(safety.confidence * 100)}%</span>
                      </div>
                      <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${vc?.dot === 'bg-emerald-400' ? 'bg-emerald-500' : vc?.dot === 'bg-amber-400' ? 'bg-amber-500' : 'bg-red-500'}`}
                          style={{ width: `${Math.round(safety.confidence * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Flags */}
                    {safety.flags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {safety.flags.map(f => (
                          <span key={f} className="text-[10px] font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
                            {f}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* HIPAA + claims row */}
                    <div className="flex items-center gap-3 text-[10px]">
                      <span className={`font-medium ${safety.hipaa_risk ? 'text-red-400' : 'text-emerald-600'}`}>
                        HIPAA {safety.hipaa_risk ? '⚠ RISK' : '✓ CLEAR'}
                      </span>
                      {safety.flagged_claims?.length > 0 && (
                        <span className="text-red-400 font-medium">
                          {safety.flagged_claims.length} dangerous claim{safety.flagged_claims.length > 1 ? 's' : ''} caught
                        </span>
                      )}
                    </div>

                    {/* Explanation */}
                    <p className="text-[11px] text-gray-500 leading-relaxed border-t border-gray-800/80 pt-2.5">
                      {safety.explanation}
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

// ─── Unlearning Probe ─────────────────────────────────────────────────────────

function ProbePanel() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function runProbe() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`${API}/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: 'medication dosage' }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Unlearning Probe</h2>
        </div>
        {result?.trilemma_violation !== undefined && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${result.trilemma_violation ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
            {result.trilemma_violation ? 'TRILEMMA VIOLATED' : 'TRILEMMA OK'}
          </span>
        )}
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">
        Fires 5 adversarial probes to evaluate the model's unlearning trilemma — forgetting of sensitive content, utility on benign queries, and detectability of refusals.
      </p>

      <button
        onClick={runProbe}
        disabled={loading}
        className="flex items-center justify-center gap-2 py-2.5 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-600/30 disabled:opacity-40 text-amber-400 text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
      >
        {loading ? <><Spinner /> Running Probes…</> : 'Run Unlearning Probe'}
      </button>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {result && (
        <div className="space-y-4 pt-1">
          <ProgressBar label="Forgetting Score" value={result.forgetting_score}    color="bg-cyan-500" />
          <ProgressBar label="Utility Score"    value={result.utility_score}       color="bg-violet-500" />
          <ProgressBar label="Detectability"    value={result.detectability_score} color="bg-amber-500" />
        </div>
      )}
    </div>
  )
}

// ─── Compliance Report ────────────────────────────────────────────────────────

function ReportPanel() {
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)

  async function generateReport() {
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch(`${API}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setReport(data.report)
      setMeta(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex-1 bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Compliance Report</h2>
        </div>
        {meta && (
          <span className="text-[10px] text-gray-500 font-mono">
            {meta.total_queries} queries · {meta.flagged_count} flagged · {meta.hipaa_violations} HIPAA
          </span>
        )}
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">
        Synthesises all session logs into a formal HIPAA compliance audit report using LLM analysis.
      </p>

      <button
        onClick={generateReport}
        disabled={loading}
        className="flex items-center justify-center gap-2 py-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-600/30 disabled:opacity-40 text-emerald-400 text-sm font-semibold rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
      >
        {loading ? <><Spinner /> Generating Report…</> : 'Generate Compliance Report'}
      </button>

      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {report && (
        <div className="flex-1 overflow-y-auto bg-gray-800/40 border border-gray-700/50 rounded-lg px-4 py-3 max-h-72">
          <pre className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">{report}</pre>
        </div>
      )}
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [logs, setLogs] = useState([])
  const [online, setOnline] = useState(false)

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API}/logs`)
      if (res.ok) {
        setLogs(await res.json())
        setOnline(true)
      } else {
        setOnline(false)
      }
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
    const id = setInterval(fetchLogs, 5000)
    return () => clearInterval(id)
  }, [fetchLogs])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <TopBar online={online} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-5">
        <MetricsRow logs={logs} />

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">Query Interface</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <QueryInterface onNewLog={fetchLogs} />

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">Before / After Demo</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <ComparisonPanel />

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-[10px] text-gray-600 uppercase tracking-widest">Analysis Tools</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        <div className="flex gap-4">
          <ProbePanel />
          <ReportPanel />
        </div>
      </main>

      <footer className="border-t border-gray-800/60 px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] text-gray-700 tracking-widest uppercase">SENTINEL Clinical AI Safety Platform</span>
        <span className="text-[10px] text-gray-700 font-mono">MedFlow Health © 2025</span>
      </footer>
    </div>
  )
}
