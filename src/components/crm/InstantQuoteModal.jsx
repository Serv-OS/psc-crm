import { useCallback, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import MapMeasure from './MapMeasure';

// Instant quote for a lead ALREADY in the CRM (Peter, 23 Nov 2026: the website
// tool made a second lead every time). Same measure and picks as the website
// instant quote; the draft quote and deal attach to this lead.
// The rules match psc-website src/components/quote/InstantQuote.tsx.

const WALL_HEIGHT_PER_STORY = 9; // ft: perimeter x this x storeys = wall area
const STOREYS = [1, 1.5, 2, 3];
const COVERAGE = [
  { key: 'whole', label: 'Whole house', factor: 1 },
  { key: 'frontsides', label: 'Front + sides', factor: 0.6 },
  { key: 'front', label: 'Front only', factor: 0.35 },
];
const DEMO = [
  { key: 'siding', label: 'Existing siding' },
  { key: 'stucco', label: 'Stucco' },
  { key: 'trim', label: 'Trim only' },
  { key: 'newbuild', label: 'New build (nothing to remove)' },
];
const PROFILES = [
  { key: 'lap', label: 'Lap Siding' },
  { key: 'panel', label: 'Board & Batten' },
  { key: 'shingle', label: 'Shingle' },
  { key: 'artisan', label: 'Artisan V-Rustic' },
];
const COLORS = ['Arctic White', 'Cobble Stone', 'Navajo Beige', 'Khaki Brown', 'Monterey Taupe', 'Timber Bark', 'Rich Espresso',
  'Mountain Sage', 'Light Mist', 'Pearl Gray', 'Gray Slate', 'Boothbay Blue', 'Evening Blue', 'Deep Ocean', 'Aged Pewter',
  'Night Gray', 'Iron Gray', 'Countrylane Red', 'Midnight Black'];

export default function InstantQuoteModal({ lead, address, onClose, onDone }) {
  const [m, setM] = useState(null);
  const [demoKey, setDemoKey] = useState('siding');
  const [stories, setStories] = useState(1);
  const [coverage, setCoverage] = useState('whole');
  const [profile, setProfile] = useState('lap');
  const [finish, setFinish] = useState('colorplus');
  const [color, setColor] = useState('Arctic White');
  const [typedSqft, setTypedSqft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onMeasure = useCallback((x) => setM(x), []);
  const cov = COVERAGE.find((c) => c.key === coverage);
  const measuredSqft = useMemo(() => (m ? Math.round(m.perimeterFt * WALL_HEIGHT_PER_STORY * stories * cov.factor) : 0), [m, stories, cov]);
  const sqft = Number(typedSqft) > 0 ? Math.round(Number(typedSqft)) : measuredSqft;

  const create = async () => {
    if (!(sqft > 0)) { setError('Draw the building outline first, or type the sq ft.'); return; }
    setBusy(true); setError('');
    const prof = PROFILES.find((p) => p.key === profile);
    const { data, error: e } = await supabase.functions.invoke('instant-quote', {
      body: {
        lead_id: lead.id,
        selection: { profile: prof.label, profileKey: profile, finishKey: finish, color: finish === 'primed' ? 'Primed for paint' : color },
        project: { sqft, stories, demoKey, perimeterFt: m?.perimeterFt || 0, coverage: cov.label, address: m?.address || address || '' },
      },
    });
    setBusy(false);
    if (e || !data?.ok) {
      let msg = data?.error || e?.message || 'Could not make the quote.';
      try { const j = await e?.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep msg */ }
      setError(msg); return;
    }
    onDone?.(data);
  };

  const label = 'block text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1';
  const input = 'w-full px-2.5 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember';
  const pill = (on) => `px-3 py-1.5 rounded-full text-xs font-semibold border ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-paper border-bdr'}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bdr flex items-center gap-3">
          <div className="flex-1">
            <div className="text-lg font-bold text-paper">Instant quote for {lead.name}</div>
            <div className="text-xs text-muted">Trace the house, pick the siding. The draft quote goes on this lead{lead.deal_id ? ' and its deal' : ' with a new deal'}. No new lead is made.</div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-paper text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-3">
            <MapMeasure initialAddress={address || ''} onMeasure={onMeasure} />
          </div>
          <div className="lg:col-span-2 space-y-3">
            <div><span className={label}>Replacing</span>
              <select className={input} value={demoKey} onChange={(e) => setDemoKey(e.target.value)}>
                {DEMO.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></div>
            <div><span className={label}>Storeys</span>
              <div className="flex gap-1.5 flex-wrap">{STOREYS.map((s) => <button key={s} type="button" className={pill(stories === s)} onClick={() => setStories(s)}>{s}</button>)}</div></div>
            <div><span className={label}>Coverage</span>
              <div className="flex gap-1.5 flex-wrap">{COVERAGE.map((c) => <button key={c.key} type="button" className={pill(coverage === c.key)} onClick={() => setCoverage(c.key)}>{c.label}</button>)}</div></div>
            <div className="grid grid-cols-2 gap-2">
              <div><span className={label}>Siding</span>
                <select className={input} value={profile} onChange={(e) => setProfile(e.target.value)}>
                  {PROFILES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
              <div><span className={label}>Finish</span>
                <select className={input} value={finish} onChange={(e) => setFinish(e.target.value)}>
                  <option value="colorplus">ColorPlus</option><option value="primed">Primed</option></select></div>
            </div>
            {finish === 'colorplus' && (
              <div><span className={label}>Colour</span>
                <select className={input} value={color} onChange={(e) => setColor(e.target.value)}>
                  {COLORS.map((c) => <option key={c}>{c}</option>)}</select></div>
            )}
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
              <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-emerald-800">Wall area</div>
              <div className="text-2xl font-bold text-paper">{sqft ? `${sqft.toLocaleString('en-US')} sq ft` : '—'}</div>
              <div className="text-[11px] text-muted">
                {m ? `${m.perimeterFt.toLocaleString('en-US')} ft perimeter × ${WALL_HEIGHT_PER_STORY} ft × ${stories} storey × ${cov.label.toLowerCase()}` : 'Draw the outline to measure.'}
              </div>
              <div className="mt-2"><span className={label}>Or type the sq ft</span>
                <input type="number" min="0" className={input} value={typedSqft} onChange={(e) => setTypedSqft(e.target.value)} placeholder={measuredSqft ? String(measuredSqft) : 'e.g. 2200'} /></div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button type="button" onClick={create} disabled={busy || !sqft} className="w-full btn-glass px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              {busy ? 'Building the quote…' : 'Create draft quote on this lead'}
            </button>
            <div className="text-[11px] text-dim">Priced from the live price list, the same as the website. You can change everything in the quote afterwards.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
