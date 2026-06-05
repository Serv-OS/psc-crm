import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const LEAD_DEFAULT_FIELDS = [
  { key: 'company', label: 'Restaurant / Company', type: 'text', required: false, maps_to: 'company_name' },
  { key: 'first_name', label: 'First name', type: 'text', required: true, maps_to: 'first_name' },
  { key: 'last_name', label: 'Last name', type: 'text', required: false, maps_to: 'last_name' },
  { key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel', required: false, maps_to: 'phone' },
  { key: 'message', label: 'How can we help?', type: 'textarea', required: false, maps_to: 'message' },
];
const SUPPORT_DEFAULT_FIELDS = [
  { key: 'name', label: 'Your name', type: 'text', required: true, maps_to: 'first_name' },
  { key: 'email', label: 'Email', type: 'email', required: true, maps_to: 'email' },
  { key: 'subject', label: 'Subject', type: 'text', required: true, maps_to: 'subject' },
  { key: 'message', label: 'Describe your issue', type: 'textarea', required: true, maps_to: 'message' },
];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export default function FormsList({ profile, onSelect }) {
  const [forms, setForms] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('lead');
  const [sourceTag, setSourceTag] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const [f, s] = await Promise.all([
      supabase.from('forms').select('*').order('created_at', { ascending: false }),
      supabase.from('form_submissions').select('form_id'),
    ]);
    setForms(f.data || []);
    setSubs(s.data || []);
    setLoading(false);
  };

  const subCount = (formId) => subs.filter(s => s.form_id === formId).length;

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 6);
    const { data } = await supabase.from('forms').insert({
      name: name.trim(),
      slug,
      destination,
      source_tag: sourceTag.trim() || (destination === 'support' ? 'web_form' : 'website'),
      fields: destination === 'support' ? SUPPORT_DEFAULT_FIELDS : LEAD_DEFAULT_FIELDS,
      settings: { submit_label: destination === 'support' ? 'Send request' : 'Get in touch', success_message: "Thanks — we'll be in touch shortly." },
      owner_id: profile.id,
    }).select().single();
    setName(''); setDestination('lead'); setSourceTag(''); setShowCreate(false);
    if (data) onSelect(data.id); else load();
  };

  const toggleEnabled = async (form) => {
    await supabase.from('forms').update({ enabled: !form.enabled }).eq('id', form.id);
    load();
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Forms</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {forms.length} forms / {subs.length} submissions
          </div>
        </div>
        {canWrite && (
          <button onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-ember text-white text-sm font-semibold rounded-xl hover:bg-ember-deep transition">+ New form</button>
        )}
      </div>

      {showCreate && (
        <div className="px-6 py-4 border-b border-bdr max-h-[70vh] overflow-y-auto">
          <form onSubmit={create} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Form name</label>
              <input className="w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember"
                value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Homepage enquiry" autoFocus />
            </div>
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Submissions go to</label>
              <select className="px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper focus:outline-none focus:border-ember"
                value={destination} onChange={e => setDestination(e.target.value)}>
                <option value="lead">Leads pipeline</option>
                <option value="support">Support inbox</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim mb-1 block">Source tag</label>
              <input className="px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-44"
                value={sourceTag} onChange={e => setSourceTag(e.target.value)} placeholder="e.g. homepage" />
            </div>
            <button type="submit" className="px-4 py-2 bg-ember text-white text-sm font-semibold rounded-xl">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-muted border border-bdr rounded-xl">Cancel</button>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-2">
          {loading && <div className="py-8 text-center text-dim text-sm">Loading…</div>}
          {!loading && forms.length === 0 && (
            <div className="py-12 text-center text-dim text-sm">No forms yet. Create one to embed on your website.</div>
          )}
          {!loading && forms.map(f => (
            <div key={f.id} onClick={() => onSelect(f.id)}
              className="glass-card rounded-2xl p-4 cursor-pointer hover:border-dim transition flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-ember/15 border border-ember/25 flex items-center justify-center text-lg shrink-0">
                {f.destination === 'support' ? '\u{1F3AB}' : '\u{1F3AF}'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-bold text-paper truncate">{f.name}</div>
                  <span className={`px-1.5 py-0.5 text-[9px] font-bold uppercase rounded ${f.destination === 'support' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-orange-100 text-orange-700 border border-orange-200'}`}>
                    {f.destination === 'support' ? 'Support' : 'Lead'}
                  </span>
                  {!f.enabled && <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded bg-slate-100 text-slate-500 border border-slate-200">Disabled</span>}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {f.source_tag && <span>source: {f.source_tag} / </span>}
                  {(f.fields || []).length} fields / {subCount(f.id)} submissions
                </div>
              </div>
              {canWrite && (
                <button onClick={(e) => { e.stopPropagation(); toggleEnabled(f); }}
                  className={`px-2 py-1 text-[10px] font-semibold rounded-lg border transition ${f.enabled ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-card text-dim border-bdr'}`}>
                  {f.enabled ? 'Live' : 'Off'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
