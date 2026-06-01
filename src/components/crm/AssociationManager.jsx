import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export default function AssociationManager({ subjectType, subjectId, targetType, profile, onNavigate }) {
  const [associations, setAssociations] = useState([]);
  const [targets, setTargets] = useState([]);
  const [roles, setRoles] = useState([]);
  const [adding, setAdding] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState('');
  const [selectedRole, setSelectedRole] = useState('');

  const canWrite = profile.role === 'owner' || profile.role === 'editor';

  useEffect(() => { load(); }, [subjectType, subjectId, targetType]);

  const load = async () => {
    // Get associations where this subject links to targetType
    const [fwd, rev] = await Promise.all([
      supabase.from('associations').select('*')
        .eq('from_type', subjectType).eq('from_id', subjectId).eq('to_type', targetType),
      supabase.from('associations').select('*')
        .eq('to_type', subjectType).eq('to_id', subjectId).eq('from_type', targetType),
    ]);

    // Merge both directions
    const all = [
      ...(fwd.data || []).map(a => ({ ...a, linked_id: a.to_id, direction: 'fwd' })),
      ...(rev.data || []).map(a => ({ ...a, linked_id: a.from_id, direction: 'rev' })),
    ];
    setAssociations(all);

    // Load available targets and roles
    const [t, r] = await Promise.all([
      supabase.from(targetType === 'contact' ? 'contacts' : targetType === 'company' ? 'companies' : 'locations')
        .select('*').order(targetType === 'contact' ? 'last_name' : 'name').limit(200),
      supabase.from('association_roles').select('*').order('sort'),
    ]);
    setTargets(t.data || []);
    setRoles(r.data || []);
    if (r.data?.length && !selectedRole) setSelectedRole(r.data[0].role);
  };

  const addAssociation = async () => {
    if (!selectedTarget || !selectedRole) return;
    await supabase.from('associations').insert({
      from_type: subjectType,
      from_id: subjectId,
      to_type: targetType,
      to_id: selectedTarget,
      label: selectedRole,
    });
    setSelectedTarget(''); setAdding(false);
    load();
  };

  const removeAssociation = async (assoc) => {
    await supabase.from('associations').delete().eq('id', assoc.id);
    load();
  };

  const getTargetName = (id) => {
    const t = targets.find(x => x.id === id);
    if (!t) return id.slice(0, 8);
    if (targetType === 'contact') return [t.first_name, t.last_name].filter(Boolean).join(' ') || t.email || 'Unknown';
    return t.name || 'Unknown';
  };

  const getTargetSub = (id) => {
    const t = targets.find(x => x.id === id);
    if (!t) return '';
    if (targetType === 'contact') return t.email || t.phone || '';
    if (targetType === 'location') return t.city || '';
    return t.domain || '';
  };

  const getRoleLabel = (role) => {
    const r = roles.find(x => x.role === role);
    return r ? r.label : role;
  };

  // Group associations by linked entity
  const grouped = {};
  associations.forEach(a => {
    if (!grouped[a.linked_id]) grouped[a.linked_id] = { id: a.linked_id, roles: [] };
    grouped[a.linked_id].roles.push(a);
  });

  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim";
  const input = "w-full px-3 py-2 bg-card border border-bdr rounded text-sm text-paper focus:outline-none focus:border-ember";

  const typeLabel = targetType === 'contact' ? 'Contacts' : targetType === 'company' ? 'Companies' : 'Locations';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className={label}>{typeLabel} ({Object.keys(grouped).length})</div>
        {canWrite && !adding && (
          <button onClick={() => setAdding(true)}
            className="px-2 py-1 text-xs text-ember hover:text-ember-deep">+ Link {targetType}</button>
        )}
      </div>

      {adding && (
        <div className="bg-card border border-bdr rounded-lg p-3 mb-3 space-y-2">
          <select className={input} value={selectedTarget} onChange={e => setSelectedTarget(e.target.value)}>
            <option value="">Select {targetType}...</option>
            {targets
              .filter(t => !grouped[t.id])
              .map(t => (
                <option key={t.id} value={t.id}>
                  {targetType === 'contact'
                    ? [t.first_name, t.last_name].filter(Boolean).join(' ') || t.email
                    : t.name}
                </option>
              ))}
          </select>
          <select className={input} value={selectedRole} onChange={e => setSelectedRole(e.target.value)}>
            {roles.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={addAssociation} disabled={!selectedTarget}
              className="px-3 py-1.5 bg-ember text-ink text-xs font-semibold rounded disabled:opacity-50">Link</button>
            <button onClick={() => setAdding(false)}
              className="px-3 py-1.5 text-xs text-muted border border-bdr rounded">Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {Object.values(grouped).map(g => (
          <div key={g.id} className="flex items-center gap-2 py-2 px-3 bg-card/50 border border-bdr rounded-lg group">
            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onNavigate?.(targetType, g.id)}>
              <div className="text-sm text-paper truncate hover:text-ember transition">{getTargetName(g.id)}</div>
              <div className="text-xs text-dim truncate">{getTargetSub(g.id)}</div>
            </div>
            <div className="flex gap-1 flex-wrap shrink-0">
              {g.roles.map(r => (
                <span key={r.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-ember/10 text-ember border border-ember/20 rounded">
                  {getRoleLabel(r.label)}
                  {canWrite && (
                    <button onClick={() => removeAssociation(r)}
                      className="text-ember/50 hover:text-red-400 ml-0.5">&times;</button>
                  )}
                </span>
              ))}
            </div>
            {canWrite && (
              <button
                onClick={() => {
                  setSelectedTarget(g.id);
                  setAdding(true);
                }}
                className="text-dim hover:text-paper text-xs opacity-0 group-hover:opacity-100 shrink-0"
                title="Add role">+</button>
            )}
          </div>
        ))}
        {Object.keys(grouped).length === 0 && !adding && (
          <div className="text-xs text-dim italic py-3 text-center">No {typeLabel.toLowerCase()} linked.</div>
        )}
      </div>
    </div>
  );
}
