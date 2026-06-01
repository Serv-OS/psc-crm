import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

export default function ReportingDashboard({ profile }) {
  const [deals, setDeals] = useState([]);
  const [onboardings, setOnboardings] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [locations, setLocations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [locationModules, setLocationModules] = useState([]);
  const [modules, setModules] = useState([]);
  const [featureRequests, setFeatureRequests] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('sales');

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const results = await Promise.all([
      supabase.from('deals').select('*'),
      supabase.from('onboardings').select('*'),
      supabase.from('tickets').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('companies').select('*'),
      supabase.from('locations').select('*'),
      supabase.from('contacts').select('*'),
      supabase.from('location_modules').select('*'),
      supabase.from('modules').select('*').order('sort_order'),
      supabase.from('feature_requests').select('*'),
      supabase.from('stage_history').select('*').order('changed_at', { ascending: false }).limit(500),
      supabase.from('profiles').select('id, email, display_name'),
    ]);
    setDeals(results[0].data || []);
    setOnboardings(results[1].data || []);
    setTickets(results[2].data || []);
    setTasks(results[3].data || []);
    setCompanies(results[4].data || []);
    setLocations(results[5].data || []);
    setContacts(results[6].data || []);
    setLocationModules(results[7].data || []);
    setModules(results[8].data || []);
    setFeatureRequests(results[9].data || []);
    setStageHistory(results[10].data || []);
    setMembers(results[11].data || []);
    setLoading(false);
  };

  const ownerName = (id) => { const m = members.find(u => u.id === id); return m ? (m.display_name || m.email.split('@')[0]) : ''; };

  const exportCSV = (headers, rows, filename) => {
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  };

  // Sales metrics
  const salesMetrics = useMemo(() => {
    const pipeline = deals.filter(d => !['closed_won','closed_lost'].includes(d.stage));
    const won = deals.filter(d => d.stage === 'closed_won');
    const lost = deals.filter(d => d.stage === 'closed_lost');
    const pipelineValue = pipeline.reduce((s, d) => s + (d.value || 0), 0);
    const wonValue = won.reduce((s, d) => s + (d.value || 0), 0);
    const winRate = (won.length + lost.length) > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : 0;

    // By stage
    const byStage = {};
    deals.forEach(d => { byStage[d.stage] = (byStage[d.stage] || 0) + 1; });

    // By owner
    const byOwner = {};
    deals.forEach(d => { const n = ownerName(d.owner_id) || 'Unassigned'; byOwner[n] = (byOwner[n] || 0) + 1; });

    return { total: deals.length, pipeline: pipeline.length, pipelineValue, won: won.length, wonValue, lost: lost.length, winRate, byStage, byOwner };
  }, [deals]);

  // Onboarding metrics
  const obMetrics = useMemo(() => {
    const byStage = {};
    onboardings.forEach(o => { byStage[o.stage] = (byStage[o.stage] || 0) + 1; });
    return { total: onboardings.length, live: onboardings.filter(o => o.stage === 'live').length, byStage };
  }, [onboardings]);

  // Support metrics
  const ticketMetrics = useMemo(() => {
    const open = tickets.filter(t => !['resolved','closed'].includes(t.stage));
    const escalated = tickets.filter(t => t.stage === 'escalated');
    const byType = {};
    tickets.forEach(t => { byType[t.ticket_type || 'other'] = (byType[t.ticket_type || 'other'] || 0) + 1; });
    return { total: tickets.length, open: open.length, escalated: escalated.length, resolved: tickets.filter(t => t.stage === 'resolved').length, byType };
  }, [tickets]);

  // Task metrics
  const taskMetrics = useMemo(() => {
    const overdue = tasks.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date());
    const blocked = tasks.filter(t => t.status === 'blocked');
    return { total: tasks.length, done: tasks.filter(t => t.status === 'done').length, overdue: overdue.length, blocked: blocked.length };
  }, [tasks]);

  // Module metrics
  const moduleMetrics = useMemo(() => {
    return modules.map(m => ({
      name: m.name,
      total: locationModules.filter(lm => lm.module_id === m.id).length,
      live: locationModules.filter(lm => lm.module_id === m.id && lm.status === 'live').length,
    }));
  }, [modules, locationModules]);

  const formatCurrency = (v) => `£${v.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`;

  const label = "text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim";
  const tabBtn = (t, lbl) => (
    <button onClick={() => setTab(t)}
      className={`px-3 py-1.5 text-xs font-medium rounded transition ${tab === t ? 'bg-card text-paper' : 'text-muted hover:text-paper'}`}>{lbl}</button>
  );

  if (loading) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading reports...</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-bdr">
        <div className="text-lg font-bold text-paper">Reporting</div>
        <div className="text-[10px] text-dim font-mono uppercase tracking-[0.18em]">Cross-system dashboards</div>
      </div>

      <div className="px-6 py-2 border-b border-bdr flex gap-1 overflow-x-auto">
        {tabBtn('sales', 'Sales')}
        {tabBtn('onboarding', 'Onboarding')}
        {tabBtn('support', 'Support')}
        {tabBtn('tasks', 'Tasks')}
        {tabBtn('modules', 'Modules')}
        {tabBtn('customers', 'Customers')}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl space-y-6">

          {tab === 'sales' && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Pipeline" value={salesMetrics.pipeline} sub={formatCurrency(salesMetrics.pipelineValue)} />
                <MetricCard label="Won" value={salesMetrics.won} sub={formatCurrency(salesMetrics.wonValue)} color="text-green-400" />
                <MetricCard label="Lost" value={salesMetrics.lost} color="text-red-400" />
                <MetricCard label="Win Rate" value={`${salesMetrics.winRate}%`} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card rounded-2xl p-4">
                  <div className={label + ' mb-3'}>By Stage</div>
                  {Object.entries(salesMetrics.byStage).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs"><span className="text-paper">{k.replace(/_/g,' ')}</span><span className="text-ember font-mono">{v}</span></div>
                  ))}
                </div>
                <div className="glass-card rounded-2xl p-4">
                  <div className={label + ' mb-3'}>By Owner</div>
                  {Object.entries(salesMetrics.byOwner).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 text-xs"><span className="text-paper">{k}</span><span className="text-ember font-mono">{v}</span></div>
                  ))}
                </div>
              </div>
              <button onClick={() => exportCSV(
                ['Name','Company','Stage','Value','Owner','Source','Created'],
                deals.map(d => [d.name, companies.find(c=>c.id===d.company_id)?.name, d.stage, d.value, ownerName(d.owner_id), d.source, d.created_at]),
                'deals-export.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export deals CSV</button>
            </>
          )}

          {tab === 'onboarding' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Total" value={obMetrics.total} />
                <MetricCard label="Live" value={obMetrics.live} color="text-green-400" />
                <MetricCard label="In Progress" value={obMetrics.total - obMetrics.live} color="text-orange-400" />
              </div>
              <div className="glass-card rounded-2xl p-4">
                <div className={label + ' mb-3'}>By Stage</div>
                {Object.entries(obMetrics.byStage).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 text-xs"><span className="text-paper">{k.replace(/_/g,' ')}</span><span className="text-ember font-mono">{v}</span></div>
                ))}
              </div>
              <button onClick={() => exportCSV(
                ['Company','Stage','Owner','Created'],
                onboardings.map(o => [companies.find(c=>c.id===o.company_id)?.name, o.stage, ownerName(o.owner_id), o.created_at]),
                'onboardings-export.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export onboardings CSV</button>
            </>
          )}

          {tab === 'support' && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Open" value={ticketMetrics.open} />
                <MetricCard label="Escalated" value={ticketMetrics.escalated} color="text-red-400" />
                <MetricCard label="Resolved" value={ticketMetrics.resolved} color="text-green-400" />
                <MetricCard label="Total" value={ticketMetrics.total} />
              </div>
              <div className="glass-card rounded-2xl p-4">
                <div className={label + ' mb-3'}>By Type</div>
                {Object.entries(ticketMetrics.byType).map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 text-xs"><span className="text-paper">{k}</span><span className="text-ember font-mono">{v}</span></div>
                ))}
              </div>
              <button onClick={() => exportCSV(
                ['Subject','Company','Priority','Type','Stage','Owner','Created'],
                tickets.map(t => [t.subject, companies.find(c=>c.id===t.company_id)?.name, t.priority, t.ticket_type, t.stage, ownerName(t.owner_id), t.created_at]),
                'tickets-export.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export tickets CSV</button>
            </>
          )}

          {tab === 'tasks' && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Total" value={taskMetrics.total} />
                <MetricCard label="Done" value={taskMetrics.done} color="text-green-400" />
                <MetricCard label="Overdue" value={taskMetrics.overdue} color="text-red-400" />
                <MetricCard label="Blocked" value={taskMetrics.blocked} color="text-orange-400" />
              </div>
              <button onClick={() => exportCSV(
                ['Title','Status','Priority','Assignee','Due Date','Project','Created'],
                tasks.map(t => [t.title, t.status, t.priority, ownerName(t.owner_id), t.due_date, t.project_id, t.created_at]),
                'tasks-export.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export tasks CSV</button>
            </>
          )}

          {tab === 'modules' && (
            <>
              <div className="glass-card rounded-2xl p-4">
                <div className={label + ' mb-3'}>Module Attach Rate</div>
                {moduleMetrics.map(m => (
                  <div key={m.name} className="flex items-center gap-3 py-1.5">
                    <span className="text-xs text-paper w-48 truncate">{m.name}</span>
                    <div className="flex-1 h-2 bg-ink rounded-full overflow-hidden">
                      <div className="h-full bg-ember rounded-full" style={{ width: `${locations.length ? (m.live / locations.length) * 100 : 0}%` }} />
                    </div>
                    <span className="text-xs text-ember font-mono w-16 text-right">{m.live}/{locations.length}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => exportCSV(
                ['Module','Total Enabled','Live','Attach Rate'],
                moduleMetrics.map(m => [m.name, m.total, m.live, locations.length ? `${Math.round((m.live/locations.length)*100)}%` : '0%']),
                'modules-export.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export modules CSV</button>
            </>
          )}

          {tab === 'customers' && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Companies" value={companies.length} />
                <MetricCard label="Locations" value={locations.length} />
                <MetricCard label="Live" value={locations.filter(l => l.status === 'live').length} color="text-green-400" />
                <MetricCard label="Contacts" value={contacts.length} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="glass-card rounded-2xl p-4">
                  <div className={label + ' mb-3'}>Locations by Status</div>
                  {['prospect','onboarding','live','churned'].map(s => (
                    <div key={s} className="flex justify-between py-1 text-xs">
                      <span className="text-paper">{s}</span>
                      <span className="text-ember font-mono">{locations.filter(l => l.status === s).length}</span>
                    </div>
                  ))}
                </div>
                <div className="glass-card rounded-2xl p-4">
                  <div className={label + ' mb-3'}>Feature Requests</div>
                  {['new','under_review','planned','in_progress','shipped','declined'].map(s => {
                    const count = featureRequests.filter(f => f.status === s).length;
                    return count > 0 ? (
                      <div key={s} className="flex justify-between py-1 text-xs">
                        <span className="text-paper">{s.replace(/_/g,' ')}</span>
                        <span className="text-ember font-mono">{count}</span>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => exportCSV(
                  ['Name','Domain','City','Industry','Locations','Owner','Created'],
                  companies.map(c => [c.name, c.domain, c.city, c.industry, locations.filter(l=>l.company_id===c.id).length, ownerName(c.owner_id), c.created_at]),
                  'companies-export.csv'
                )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export companies CSV</button>
                <button onClick={() => exportCSV(
                  ['Name','Email','Phone','Job Title','Source','Created'],
                  contacts.map(c => [[c.first_name,c.last_name].filter(Boolean).join(' '), c.email, c.phone, c.job_title, c.source, c.created_at]),
                  'contacts-export.csv'
                )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export contacts CSV</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, color = 'text-paper' }) {
  return (
    <div className="glass-card rounded-2xl p-5 text-center">
      <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-dim mt-1.5">{label}</div>
      {sub && <div className="text-xs text-ember mt-1">{sub}</div>}
    </div>
  );
}
