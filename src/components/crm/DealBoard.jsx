import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { handleClosedWon } from '../../lib/dealHelpers';

const STAGES = [
  { key: 'new_lead',       label: 'New Lead',       color: '#3b82f6' },
  { key: 'contacted',      label: 'Contacted',      color: '#6366f1' },
  { key: 'qualified',      label: 'Qualified',      color: '#8b5cf6' },
  { key: 'demo_booked',    label: 'Demo Booked',    color: '#a855f7' },
  { key: 'demo_done',      label: 'Demo Done',      color: '#E8743C' },
  { key: 'proposal_sent',  label: 'Proposal Sent',  color: '#C75A29' },
  { key: 'negotiation',    label: 'Negotiation',    color: '#eab308' },
  { key: 'closed_won',     label: 'Closed Won',     color: '#10b981' },
  { key: 'closed_lost',    label: 'Closed Lost',    color: '#ef4444' },
];

export default function DealBoard({ profile, onSelectDeal, onNavigate }) {
  const [deals, setDeals] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [dragDeal, setDragDeal] = useState(null);
  const [viewMode, setViewMode] = useState('board');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCompany, setNewCompany] = useState('');
  const [newValue, setNewValue] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [d, c, m] = await Promise.all([
      supabase.from('deals').select('*').order('created_at', { ascending: false }),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setDeals(d.data || []);
    setCompanies(c.data || []);
    setMembers(m.data || []);
  };

  const filtered = useMemo(() => {
    if (!search) return deals;
    const q = search.toLowerCase();
    return deals.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (companies.find(c => c.id === d.company_id)?.name || '').toLowerCase().includes(q)
    );
  }, [deals, search, companies]);

  const dealsByStage = useMemo(() => {
    const map = {};
    STAGES.forEach(s => { map[s.key] = []; });
    filtered.forEach(d => { if (map[d.stage]) map[d.stage].push(d); });
    return map;
  }, [filtered]);

  const companyName = (id) => companies.find(c => c.id === id)?.name || '';
  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const moveDeal = async (dealId, fromStage, toStage) => {
    if (fromStage === toStage) return;
    const patch = { stage: toStage };
    if (toStage === 'closed_won' || toStage === 'closed_lost') {
      patch.closed_at = new Date().toISOString();
    } else {
      patch.closed_at = null;
    }
    await supabase.from('deals').update(patch).eq('id', dealId);
    // Write stage history
    await supabase.from('stage_history').insert({
      object_type: 'deal',
      object_id: dealId,
      from_stage: fromStage,
      to_stage: toStage,
      changed_by: profile.id,
    });
    // Auto-create onboarding on closed_won
    if (toStage === 'closed_won') {
      const ob = await handleClosedWon(dealId, profile.id);
      if (ob) alert('Onboarding created automatically for this deal.');
    }
    load();
  };

  const onDragStart = (e, deal) => { setDragDeal(deal); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (e, stageKey) => {
    e.preventDefault();
    if (dragDeal && dragDeal.stage !== stageKey) moveDeal(dragDeal.id, dragDeal.stage, stageKey);
    setDragDeal(null);
  };

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim() || !newCompany) return;
    const { data } = await supabase.from('deals').insert({
      name: newName.trim(),
      company_id: newCompany,
      value: newValue ? parseFloat(newValue) : null,
      owner_id: profile.id,
    }).select().single();
    // Write initial stage history
    if (data) {
      await supabase.from('stage_history').insert({
        object_type: 'deal', object_id: data.id, from_stage: null, to_stage: 'new_lead', changed_by: profile.id,
      });
    }
    setNewName(''); setNewCompany(''); setNewValue(''); setShowCreate(false);
    if (data) onSelectDeal(data.id);
    else load();
  };

  const stageValue = (stageKey) => {
    return dealsByStage[stageKey]?.reduce((sum, d) => sum + (d.value || 0), 0) || 0;
  };

  const formatCurrency = (v) => v ? `£${v.toLocaleString('en-GB', { minimumFractionDigits: 0 })}` : '';

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  const pipelineTotal = deals.filter(d => !['closed_won','closed_lost'].includes(d.stage)).reduce((s, d) => s + (d.value || 0), 0);
  const wonTotal = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + (d.value || 0), 0);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr flex items-center justify-between">
        <div>
          <div className="text-lg font-bold text-paper">Sales Pipeline</div>
          <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
            {deals.length} deals / Pipeline {formatCurrency(pipelineTotal)} / Won {formatCurrency(wonTotal)}
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-card border border-bdr rounded">
            <button onClick={() => setViewMode('board')}
              className={`px-2 py-1 text-xs ${viewMode === 'board' ? 'text-paper bg-ink-soft' : 'text-muted'}`}>Board</button>
            <button onClick={() => setViewMode('list')}
              className={`px-2 py-1 text-xs ${viewMode === 'list' ? 'text-paper bg-ink-soft' : 'text-muted'}`}>List</button>
          </div>
          {canWrite && (
            <button onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 bg-ember text-ink text-sm font-semibold rounded hover:bg-ember-deep transition">
              + New deal
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="px-6 py-3 border-b border-bdr">
          <form onSubmit={create} className="flex gap-2 items-end">
            <div className="flex-1"><input className={input} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Deal name" autoFocus /></div>
            <div className="w-48">
              <select className={input} value={newCompany} onChange={e => setNewCompany(e.target.value)}>
                <option value="">Select company...</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="w-32"><input className={input} value={newValue} onChange={e => setNewValue(e.target.value)} placeholder="Value" type="number" step="0.01" /></div>
            <button type="submit" className="px-4 py-2 bg-ember text-ink text-sm font-semibold rounded">Create</button>
            <button type="button" onClick={() => setShowCreate(false)} className="px-3 py-2 text-sm text-muted border border-bdr rounded">Cancel</button>
          </form>
        </div>
      )}

      <div className="px-6 py-2 border-b border-bdr">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search deals..."
          className="px-3 py-1.5 bg-card border border-bdr rounded text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-64" />
      </div>

      {viewMode === 'board' ? (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="h-full flex gap-2 px-4 py-3 min-w-max">
            {STAGES.map(stage => (
              <div key={stage.key}
                className="w-56 shrink-0 flex flex-col glass-card rounded-2xl overflow-hidden"
                onDragOver={onDragOver} onDrop={e => onDrop(e, stage.key)}>
                <div className="px-3 py-2 border-b border-bdr" style={{ borderLeftColor: stage.color, borderLeftWidth: 3 }}>
                  <div className="text-[10px] font-bold uppercase tracking-wide text-paper">{stage.label}</div>
                  <div className="text-[9px] text-dim font-mono">
                    {dealsByStage[stage.key]?.length || 0} / {formatCurrency(stageValue(stage.key))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {(dealsByStage[stage.key] || []).map(d => (
                    <div key={d.id}
                      draggable={canWrite}
                      onDragStart={e => onDragStart(e, d)}
                      onClick={() => onSelectDeal(d.id)}
                      className="bg-ink-soft border border-bdr rounded-lg p-2.5 cursor-pointer hover:border-dim transition">
                      <div className="text-xs text-paper font-medium leading-snug mb-1">{d.name}</div>
                      <div className="text-[10px] text-dim truncate">{companyName(d.company_id)}</div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {d.value && <span className="text-[10px] text-ember font-mono font-bold">{formatCurrency(d.value)}</span>}
                        {d.owner_id && (
                          <span className="ml-auto w-4 h-4 rounded-full bg-ember text-ink text-[8px] font-bold flex items-center justify-center">
                            {ownerName(d.owner_id)[0]?.toUpperCase() || '?'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-bdr text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
                <th className="px-6 py-2.5 text-left">Deal</th>
                <th className="px-3 py-2.5 text-left">Company</th>
                <th className="px-3 py-2.5 text-left">Stage</th>
                <th className="px-3 py-2.5 text-right">Value</th>
                <th className="px-3 py-2.5 text-left">Owner</th>
                <th className="px-3 py-2.5 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} onClick={() => onSelectDeal(d.id)}
                  className="border-b border-bdr hover:bg-card/50 cursor-pointer transition">
                  <td className="px-6 py-3 text-sm text-paper font-medium">{d.name}</td>
                  <td className="px-3 py-3 text-xs text-muted">{companyName(d.company_id)}</td>
                  <td className="px-3 py-3">
                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase rounded"
                      style={{ backgroundColor: STAGES.find(s => s.key === d.stage)?.color + '30', color: STAGES.find(s => s.key === d.stage)?.color }}>
                      {STAGES.find(s => s.key === d.stage)?.label || d.stage}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-ember font-mono text-right">{formatCurrency(d.value)}</td>
                  <td className="px-3 py-3 text-xs text-muted">{ownerName(d.owner_id)}</td>
                  <td className="px-3 py-3 text-xs text-dim">{new Date(d.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
