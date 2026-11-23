// House research (Peter, 19 Nov 2026): one button gathers everything public
// about the property that matters for the siding job. The house-research edge
// function does the work in the background; this card watches the row.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { SECTIONS as PREQUAL } from '../../lib/preQualification';
import { SECTIONS as SCOPE } from '../../lib/scopeQuestionnaire';

const QUESTION = {};
for (const [prefix, sections] of [['prequal', PREQUAL], ['scope', SCOPE]]) {
  for (const s of sections) for (const f of s.fields || []) QUESTION[`${prefix}.${f.key}`] = f.label;
}

const money = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
const num = (v, unit = '') => (v == null || v === '' ? null : `${Number(v).toLocaleString('en-US')}${unit}`);
const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);
const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// readOnly (on a lead): shows the property's research, never starts one; the
// address lives on the property, so research is run from there (Peter, 23 Nov).
export default function HouseResearchCard({ locationId, address, profile, readOnly = false, onOpenProperty }) {
  const [row, setRow] = useState(null);
  const [urls, setUrls] = useState({});
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(true);
  const chan = useRef(null);
  const canRun = !readOnly && (profile?.role === 'owner' || profile?.role === 'editor');

  const load = async () => {
    if (!locationId) return;
    const { data } = await supabase.from('house_research').select('*').eq('location_id', locationId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    setRow(data || null);
  };
  useEffect(() => { load(); }, [locationId]);

  // Watch a running row: realtime, with a slow poll in case realtime is off.
  useEffect(() => {
    if (!row?.id || row.status !== 'running') return;
    chan.current = supabase.channel(`house_research_${row.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'house_research', filter: `id=eq.${row.id}` }, (p) => setRow(p.new))
      .subscribe();
    const t = setInterval(load, 6000);
    return () => { clearInterval(t); if (chan.current) supabase.removeChannel(chan.current); };
  }, [row?.id, row?.status]);

  // Photos live in the private attachments bucket.
  useEffect(() => {
    const imgs = row?.images || [];
    if (!imgs.length) { setUrls({}); return; }
    supabase.storage.from('attachments').createSignedUrls(imgs.map(i => i.path), 3600).then(({ data }) => {
      const m = {};
      (data || []).forEach((d, i) => { if (d.signedUrl) m[imgs[i].path] = d.signedUrl; });
      setUrls(m);
    });
  }, [row?.id, (row?.images || []).length]);

  const start = async () => {
    setErr(''); setStarting(true);
    const { data, error } = await supabase.functions.invoke('house-research', { body: { location_id: locationId } });
    setStarting(false);
    const msg = data?.error || (error && (await error.context?.json?.().catch(() => null))?.error) || error?.message;
    if (msg) { setErr(msg); return; }
    setOpen(true);
    await load();
  };

  const f = row?.findings || {};
  const p = f.property || {}, o = f.ownership || {}, ex = f.exterior || {}, job = f.job || {}, rules = f.rules || {};
  const b = row?.facts?.building || {};
  const running = row?.status === 'running';
  const answers = Object.entries(f.crm_answers || {}).filter(([, v]) => v && (v.answer ?? '') !== '');

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
        <h3 className="text-sm font-bold text-paper">House research</h3>
        {row && !running && <button onClick={() => setOpen(!open)} className="text-[10px] text-dim hover:text-paper">{open ? 'Hide' : 'Show'}</button>}
        {canRun && (
          <button onClick={start} disabled={starting || running || !String(address || '').trim()}
            className="ml-auto btn-glass px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50">
            {starting ? 'Starting…' : running ? 'Researching…' : row ? 'Research again' : 'Research this house'}
          </button>
        )}
      </div>

      <div className="p-4 space-y-4 text-sm">
        {err && <div className="text-xs text-red-600">{err}</div>}
        {!readOnly && !String(address || '').trim() && <div className="text-xs text-dim">Add the property address to research it.</div>}
        {readOnly && !row && (
          <div className="text-xs text-dim">Not researched yet. Run it from the property{onOpenProperty ? <> (<button onClick={onOpenProperty} className="text-ember hover:underline">open the property</button>)</> : ''}.</div>
        )}
        {!readOnly && !row && String(address || '').trim() && !err && (
          <div className="text-xs text-dim">Looks up the house's age, sales and owner, permits, the siding on it now, access, lead and fire zone rules, and answers our pre-qualification and scope questions. Takes about 2 minutes.</div>
        )}
        {running && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-ember border-t-transparent animate-spin" />
            Researching {row.address}. About 2 minutes, you can leave this page.
          </div>
        )}
        {row?.status === 'failed' && <div className="text-xs text-red-600">The research did not finish: {row.error}</div>}

        {row && open && (row.images || []).length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {row.images.map(i => urls[i.path] && (
              <a key={i.path} href={urls[i.path]} target="_blank" rel="noreferrer" className="block relative rounded-lg overflow-hidden border border-bdr">
                <img src={urls[i.path]} alt={i.label} className="w-full aspect-[4/3] object-cover" />
                <span className="absolute bottom-1 left-1 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">{i.label}</span>
              </a>
            ))}
          </div>
        )}

        {row?.status === 'done' && open && (
          <>
            {f.summary && <p className="text-paper leading-relaxed">{f.summary}</p>}

            <Section title="The property">
              <Row k="Year built" v={p.year_built ? `${p.year_built}${p.age_years ? ` (${p.age_years} years old)` : ''}` : null} />
              <Row k="Living area" v={num(p.living_sqft, ' sq ft')} />
              <Row k="Lot" v={num(p.lot_sqft, ' sq ft')} />
              <Row k="Beds / baths" v={p.beds || p.baths ? `${p.beds ?? '?'} / ${p.baths ?? '?'}` : null} />
              <Row k="Storeys" v={p.stories} />
              <Row k="Type" v={p.property_type} />
              <Row k="Parcel (APN)" v={p.apn} />
              <Row k="Zoning" v={p.zoning} />
            </Section>

            <Section title="Owner and sales">
              <Row k="Owner of record" v={o.owner_of_record} />
              <Row k="Matches who called" v={yesNo(o.owner_matches_enquirer)} warn={o.owner_matches_enquirer === false} />
              <Row k="Owned since" v={o.owned_since} />
              <Row k="Occupancy" v={o.occupancy} />
              <Row k="Assessed value" v={money(o.assessed_value)} />
              <Row k="Estimated value" v={money(o.estimated_value)} />
              <Row k="Property tax / yr" v={money(o.annual_property_tax)} />
              {(o.sales || []).length > 0 && (
                <table className="w-full text-xs mt-1"><tbody>
                  {o.sales.map((s, i) => (
                    <tr key={i} className="border-t border-bdr/50"><td className="py-1 text-muted">{s.date}</td><td className="py-1 text-paper">{s.event}</td><td className="py-1 text-right font-mono text-paper">{money(s.price) || ''}</td></tr>
                  ))}
                </tbody></table>
              )}
            </Section>

            {((f.permits || []).length > 0 || f.history) && (
              <Section title="Permits and history">
                {(f.permits || []).map((x, i) => <div key={i} className="text-xs"><span className="text-muted">{x.date}</span> <span className="text-paper">{x.description}</span></div>)}
                {f.history && <div className="text-xs text-paper">{f.history}</div>}
              </Section>
            )}

            <Section title="Outside now">
              <Row k="Siding" v={ex.current_material} />
              <Row k="Condition" v={ex.condition} />
              <Row k="Trim" v={ex.trim} />
              <Row k="Colours" v={ex.colours} />
              <Row k="Style" v={ex.style} />
              <Row k="Windows / doors seen" v={ex.windows_visible != null || ex.doors_visible != null ? `${ex.windows_visible ?? '?'} / ${ex.doors_visible ?? '?'}` : null} />
              <Row k="Garage" v={ex.garage} />
              <Row k="Soffits and eaves" v={ex.soffits_eaves} />
              <Row k="Gutters" v={ex.gutters} />
              <Row k="Other" v={ex.other} />
            </Section>

            <Section title="The job">
              <Row k="Demo" v={job.demo_type} />
              <Row k="Storeys to quote" v={job.stories_for_quote} />
              <Row k="Wall area (rough)" v={num(job.estimated_wall_sqft, ' sq ft')} />
              {job.wall_sqft_reasoning && <div className="text-[11px] text-dim">{job.wall_sqft_reasoning}</div>}
              <Row k="Suggested product" v={job.suggested_product} />
              <Row k="Access" v={job.access} />
              <Row k="Pump jack" v={yesNo(job.needs_pump_jack)} />
              <Row k="Lead test" v={yesNo(job.lead_test_needed)} warn={job.lead_test_needed === true} />
              <Row k="Asbestos" v={job.asbestos_risk} />
              <Row k="Dry rot" v={job.dry_rot_risk} />
            </Section>

            <Section title="Rules for this address">
              <Row k="City / county" v={rules.city_or_county} />
              <Row k="Permits" v={rules.permit_notes} />
              <Row k="Fire zone" v={rules.fire_hazard_zone} />
              <Row k="Historic / HOA" v={rules.historic_or_hoa} />
              <Row k="Coast" v={rules.coastal_exposure} />
            </Section>

            <Section title="From Google">
              <Row k="Footprint" v={num(b.footprint_sqft, ' sq ft')} />
              <Row k="Outline" v={b.outline ? `${b.outline.length_ft} x ${b.outline.width_ft} ft, ${b.outline.box_perimeter_ft} ft around` : null} />
              <Row k="Roof area" v={num(b.roof_area_sqft, ' sq ft')} />
              <Row k="Roof height" v={b.roof_mid_height_ft ? `about ${b.roof_mid_height_ft} ft to the middle of the roof` : null} />
              <Row k="Roof pitch" v={b.roof_pitch_degrees ? `${b.roof_pitch_degrees.main ?? b.roof_pitch_degrees.min} degrees (${b.roof_pitch_degrees.min} to ${b.roof_pitch_degrees.max})` : null} />
              <Row k="Street View taken" v={row.facts?.street_view?.date} />
            </Section>

            {answers.length > 0 && (
              <Section title="Our questions, answered">
                {answers.map(([k, v]) => (
                  <div key={k} className="text-xs">
                    <div className="text-dim">{QUESTION[k] || k}</div>
                    <div className="text-paper">{String(v.answer)} <span className="text-[10px] text-dim">({v.basis || 'found'})</span></div>
                  </div>
                ))}
              </Section>
            )}

            {(f.check_on_site || []).length > 0 && <List title="Check on site" items={f.check_on_site} />}
            {(f.selling_points || []).length > 0 && <List title="Worth mentioning to them" items={f.selling_points} />}

            {(row.sources || []).length > 0 && (
              <Section title="Where this came from">
                {row.sources.slice(0, 15).map((s) => (
                  <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="block text-[11px] text-ember hover:underline truncate">{s.title}</a>
                ))}
              </Section>
            )}
            <div className="text-[10px] text-dim">Researched {fmtDate(row.finished_at || row.created_at)}. Public records and photos can be out of date: check on site.</div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">{title}</div>
      {children}
    </div>
  );
}
function Row({ k, v, warn }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="flex gap-3 text-xs">
      <span className="text-muted w-32 shrink-0">{k}</span>
      <span className={warn ? 'text-amber-600 font-semibold' : 'text-paper'}>{String(v)}</span>
    </div>
  );
}
function List({ title, items }) {
  return (
    <Section title={title}>
      <ul className="list-disc pl-4 space-y-0.5">{items.map((x, i) => <li key={i} className="text-xs text-paper">{x}</li>)}</ul>
    </Section>
  );
}
