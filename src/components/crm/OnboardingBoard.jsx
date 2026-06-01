import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

const STAGES = [
  { key: 'kickoff',              label: 'Kickoff',           color: '#3b82f6' },
  { key: 'hardware_ordered',     label: 'HW Ordered',        color: '#6366f1' },
  { key: 'hardware_shipped',     label: 'HW Shipped',        color: '#8b5cf6' },
  { key: 'account_menu_config',  label: 'Config',            color: '#a855f7' },
  { key: 'staff_training',       label: 'Training',          color: '#E8743C' },
  { key: 'go_live_scheduled',    label: 'Go-Live Sched.',    color: '#C75A29' },
  { key: 'live',                 label: 'Live',              color: '#10b981' },
  { key: 'handover_to_support',  label: 'Handover',          color: '#948A7A' },
];

export default function OnboardingBoard({ profile, onSelectOnboarding, onNavigate }) {
  const [onboardings, setOnboardings] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [members, setMembers] = useState([]);
  const [dragItem, setDragItem] = useState(null);

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [o, c, m] = await Promise.all([
      supabase.from('onboardings').select('*').order('created_at'),
      supabase.from('companies').select('id, name').order('name'),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setOnboardings(o.data || []);
    setCompanies(c.data || []);
    setMembers(m.data || []);
  };

  const byStage = useMemo(() => {
    const map = {};
    STAGES.forEach(s => { map[s.key] = []; });
    onboardings.forEach(o => { if (map[o.stage]) map[o.stage].push(o); });
    return map;
  }, [onboardings]);

  const companyName = (id) => companies.find(c => c.id === id)?.name || '';
  const ownerName = (id) => {
    const m = members.find(u => u.id === id);
    return m ? (m.display_name || m.email.split('@')[0]) : '';
  };

  const moveOnboarding = async (id, fromStage, toStage) => {
    if (fromStage === toStage) return;
    await supabase.from('onboardings').update({ stage: toStage }).eq('id', id);
    await supabase.from('stage_history').insert({
      object_type: 'onboarding', object_id: id,
      from_stage: fromStage, to_stage: toStage, changed_by: profile.id,
    });
    load();
  };

  const onDragStart = (e, item) => { setDragItem(item); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (e, stageKey) => {
    e.preventDefault();
    if (dragItem && dragItem.stage !== stageKey) moveOnboarding(dragItem.id, dragItem.stage, stageKey);
    setDragItem(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr">
        <div className="text-lg font-bold text-paper">Onboarding Pipeline</div>
        <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">
          {onboardings.length} onboardings / {onboardings.filter(o => o.stage === 'live').length} live
        </div>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full flex gap-2 px-4 py-3 min-w-max">
          {STAGES.map(stage => (
            <div key={stage.key}
              className="w-52 shrink-0 flex flex-col bg-card/30 border border-bdr rounded-xl overflow-hidden"
              onDragOver={onDragOver} onDrop={e => onDrop(e, stage.key)}>
              <div className="px-3 py-2 border-b border-bdr" style={{ borderLeftColor: stage.color, borderLeftWidth: 3 }}>
                <div className="text-[10px] font-bold uppercase tracking-wide text-paper">{stage.label}</div>
                <div className="text-[9px] text-dim font-mono">{byStage[stage.key]?.length || 0}</div>
              </div>
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                {(byStage[stage.key] || []).map(o => (
                  <div key={o.id}
                    draggable={canWrite}
                    onDragStart={e => onDragStart(e, o)}
                    onClick={() => onSelectOnboarding(o.id)}
                    className="bg-ink-soft border border-bdr rounded-lg p-2.5 cursor-pointer hover:border-dim transition">
                    <div className="text-xs text-paper font-medium">{companyName(o.company_id)}</div>
                    {o.owner_id && <div className="text-[10px] text-dim mt-1">{ownerName(o.owner_id)}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
