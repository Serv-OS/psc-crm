import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';

// CEO-defined targets (see project_sales_targets memory)
const MONTHLY_ARR_QUOTA = 48000;   // $48K new ARR per AE per month
const COMMISSION_RATE = 0.10;      // 10% of ARR
const GOAL_ACTIVITIES_DAY = 40;
const GOAL_ACTIVITIES_WEEK = 200;
const GOAL_DEMOS_SCHEDULED_WEEK = 8;
const GOAL_DEMOS_RUN_WEEK = 8;
const GOAL_ONSITE_WEEK = 50;

function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function startOfWeek() { const d = startOfToday(); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; } // Monday

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
  const [activities, setActivities] = useState([]);
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
      supabase.from('crm_activities').select('actor_id, type, occurred_at').gte('occurred_at', startOfMonth().toISOString()),
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
    setActivities(results[12].data || []);
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

  // Quota, commission & activity goals per AE (this month / this week)
  const quotaMetrics = useMemo(() => {
    const monthStart = startOfMonth().getTime();
    const weekStart = startOfWeek().getTime();
    const todayStart = startOfToday().getTime();
    const dealArr = (d) => (d.saas_arr || 0) + (d.payments_arr || 0);

    // AEs = members who own at least one deal
    const aeIds = [...new Set(deals.map(d => d.owner_id).filter(Boolean))];
    const aes = members.filter(m => aeIds.includes(m.id));
    const list = (aes.length ? aes : members);

    const rows = list.map(m => {
      const wonThisMonth = deals.filter(d =>
        d.owner_id === m.id && d.stage === 'closed_won' && d.closed_at && new Date(d.closed_at).getTime() >= monthStart);
      const arrClosed = wonThisMonth.reduce((s, d) => s + dealArr(d), 0);
      const attainment = MONTHLY_ARR_QUOTA ? arrClosed / MONTHLY_ARR_QUOTA : 0;
      const commission = arrClosed * COMMISSION_RATE;

      const myActs = activities.filter(a => a.actor_id === m.id);
      const actsToday = myActs.filter(a => new Date(a.occurred_at).getTime() >= todayStart).length;
      const actsWeek = myActs.filter(a => new Date(a.occurred_at).getTime() >= weekStart).length;
      const onsiteWeek = myActs.filter(a => a.type === 'meeting' && new Date(a.occurred_at).getTime() >= weekStart).length;

      const myHist = stageHistory.filter(h => h.object_type === 'deal' && h.changed_by === m.id && h.changed_at && new Date(h.changed_at).getTime() >= weekStart);
      const demosScheduled = myHist.filter(h => h.to_stage === 'demo_booked').length;
      const demosRun = myHist.filter(h => h.to_stage === 'demo_done').length;

      return { id: m.id, name: ownerName(m.id), arrClosed, attainment, commission, wonCount: wonThisMonth.length, actsToday, actsWeek, onsiteWeek, demosScheduled, demosRun };
    }).sort((a, b) => b.arrClosed - a.arrClosed);

    const teamArr = rows.reduce((s, r) => s + r.arrClosed, 0);
    const teamCommission = rows.reduce((s, r) => s + r.commission, 0);
    const teamQuota = MONTHLY_ARR_QUOTA * rows.length;
    return { rows, teamArr, teamCommission, teamQuota };
  }, [deals, members, activities, stageHistory]);

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
        {tabBtn('quota', 'Quota & Commission')}
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
                <MetricCard label="Won" value={salesMetrics.won} sub={formatCurrency(salesMetrics.wonValue)} color="text-emerald-600" />
                <MetricCard label="Lost" value={salesMetrics.lost} color="text-red-600" />
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

          {tab === 'quota' && (
            <>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard label="Team ARR (this month)" value={formatCurrency(quotaMetrics.teamArr)} color="text-emerald-600" />
                <MetricCard label="Team Quota" value={formatCurrency(quotaMetrics.teamQuota)} />
                <MetricCard label="Attainment" value={`${quotaMetrics.teamQuota ? Math.round((quotaMetrics.teamArr / quotaMetrics.teamQuota) * 100) : 0}%`} />
                <MetricCard label="Commission (10%)" value={formatCurrency(quotaMetrics.teamCommission)} color="text-ember" />
              </div>

              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                  <div className={label}>Per rep — Quota &amp; Commission (this month)</div>
                  <div className="ml-auto text-[10px] text-dim">Target {formatCurrency(MONTHLY_ARR_QUOTA)} ARR / mo · 10% commission</div>
                </div>
                <div className="p-2">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
                        <th className="px-3 py-2 text-left">Rep</th>
                        <th className="px-3 py-2 text-right">Won</th>
                        <th className="px-3 py-2 text-right">ARR closed</th>
                        <th className="px-3 py-2 text-left">Attainment</th>
                        <th className="px-3 py-2 text-right">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotaMetrics.rows.map(r => (
                        <tr key={r.id} className="border-t border-bdr">
                          <td className="px-3 py-2 text-sm text-paper">{r.name}</td>
                          <td className="px-3 py-2 text-xs text-muted text-right">{r.wonCount}</td>
                          <td className="px-3 py-2 text-sm text-emerald-600 font-mono text-right">{formatCurrency(r.arrClosed)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 bg-ink rounded-full overflow-hidden min-w-[60px]">
                                <div className={`h-full rounded-full ${r.attainment >= 1 ? 'bg-emerald-500' : 'bg-ember'}`} style={{ width: `${Math.min(100, Math.round(r.attainment * 100))}%` }} />
                              </div>
                              <span className={`text-xs font-mono w-10 text-right ${r.attainment >= 1 ? 'text-emerald-600 font-bold' : 'text-muted'}`}>{Math.round(r.attainment * 100)}%</span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-sm text-ember font-mono text-right">{formatCurrency(r.commission)}{r.attainment >= 1 && ' ✓'}</td>
                        </tr>
                      ))}
                      {quotaMetrics.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-dim text-sm">No sales reps with deals yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-bdr flex items-center gap-2">
                  <div className={label}>Activity goals</div>
                  <div className="ml-auto text-[10px] text-dim">{GOAL_ACTIVITIES_DAY}/day · {GOAL_ACTIVITIES_WEEK}/wk · {GOAL_DEMOS_SCHEDULED_WEEK} demos booked · {GOAL_DEMOS_RUN_WEEK} run · {GOAL_ONSITE_WEEK} onsite</div>
                </div>
                <div className="p-2">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-dim">
                        <th className="px-3 py-2 text-left">Rep</th>
                        <th className="px-3 py-2 text-center">Today</th>
                        <th className="px-3 py-2 text-center">This week</th>
                        <th className="px-3 py-2 text-center">Demos booked</th>
                        <th className="px-3 py-2 text-center">Demos run</th>
                        <th className="px-3 py-2 text-center">Onsite</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotaMetrics.rows.map(r => (
                        <tr key={r.id} className="border-t border-bdr">
                          <td className="px-3 py-2 text-sm text-paper">{r.name}</td>
                          <GoalCell value={r.actsToday} goal={GOAL_ACTIVITIES_DAY} />
                          <GoalCell value={r.actsWeek} goal={GOAL_ACTIVITIES_WEEK} />
                          <GoalCell value={r.demosScheduled} goal={GOAL_DEMOS_SCHEDULED_WEEK} />
                          <GoalCell value={r.demosRun} goal={GOAL_DEMOS_RUN_WEEK} />
                          <GoalCell value={r.onsiteWeek} goal={GOAL_ONSITE_WEEK} />
                        </tr>
                      ))}
                      {quotaMetrics.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-dim text-sm">No activity yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <button onClick={() => exportCSV(
                ['Rep','Won','ARR closed','Quota','Attainment %','Commission','Activities (wk)','Demos booked (wk)','Demos run (wk)','Onsite (wk)'],
                quotaMetrics.rows.map(r => [r.name, r.wonCount, r.arrClosed, MONTHLY_ARR_QUOTA, Math.round(r.attainment*100), Math.round(r.commission), r.actsWeek, r.demosScheduled, r.demosRun, r.onsiteWeek]),
                'quota-commission.csv'
              )} className="px-3 py-1.5 text-xs text-muted border border-bdr rounded hover:text-paper">Export quota CSV</button>
            </>
          )}

          {tab === 'onboarding' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Total" value={obMetrics.total} />
                <MetricCard label="Live" value={obMetrics.live} color="text-emerald-600" />
                <MetricCard label="In Progress" value={obMetrics.total - obMetrics.live} color="text-orange-600" />
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
                <MetricCard label="Escalated" value={ticketMetrics.escalated} color="text-red-600" />
                <MetricCard label="Resolved" value={ticketMetrics.resolved} color="text-emerald-600" />
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
                <MetricCard label="Done" value={taskMetrics.done} color="text-emerald-600" />
                <MetricCard label="Overdue" value={taskMetrics.overdue} color="text-red-600" />
                <MetricCard label="Blocked" value={taskMetrics.blocked} color="text-orange-600" />
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
                <MetricCard label="Live" value={locations.filter(l => l.status === 'live').length} color="text-emerald-600" />
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

function GoalCell({ value, goal }) {
  const met = value >= goal;
  return (
    <td className="px-3 py-2 text-center">
      <span className={`text-xs font-mono ${met ? 'text-emerald-600 font-bold' : value > 0 ? 'text-paper' : 'text-dim'}`}>
        {value}<span className="text-dim">/{goal}</span>
      </span>
    </td>
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
