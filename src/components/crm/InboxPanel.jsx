import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Mail, RefreshCw, Archive, Reply, Search, Link2, Plus, ExternalLink } from 'lucide-react';

const FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gmail-personal`;

// Parse "Display Name <email@host>" -> { name, email }
function parseAddr(raw = '') {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  return { name: raw.trim(), email: raw.trim().toLowerCase() };
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  const today = new Date();
  const sameDay = dt.toDateString() === today.toDateString();
  return sameDay
    ? dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function InboxPanel({ profile, onNavigate }) {
  const [connected, setConnected] = useState(null); // null=loading, false=not connected, obj=connected
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [activeQ, setActiveQ] = useState('in:inbox');
  const [selected, setSelected] = useState(null); // full message
  const [selLoading, setSelLoading] = useState(false);

  const callFn = useCallback(async (payload) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Request failed');
    return d;
  }, []);

  useEffect(() => {
    supabase.from('user_integrations').select('email, provider').eq('profile_id', profile.id).maybeSingle()
      .then(r => setConnected(r.data || false));
  }, [profile.id]);

  const loadList = useCallback(async (q) => {
    setLoading(true); setError('');
    try {
      const d = await callFn({ action: 'list', q });
      setMessages(d.messages || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [callFn]);

  useEffect(() => { if (connected) loadList(activeQ); }, [connected, activeQ, loadList]);

  const openMessage = async (m) => {
    setSelLoading(true); setSelected({ id: m.id, _loading: true });
    try {
      const d = await callFn({ action: 'get', id: m.id });
      setSelected(d);
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, unread: false } : x));
    } catch (e) { setError(e.message); setSelected(null); }
    setSelLoading(false);
  };

  const archive = async (id) => {
    try {
      await callFn({ action: 'modify', id, archive: true });
      setMessages(prev => prev.filter(m => m.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch (e) { setError(e.message); }
  };

  const runSearch = (e) => {
    e?.preventDefault();
    setActiveQ(query.trim() ? `${query.trim()}` : 'in:inbox');
    setSelected(null);
  };

  if (connected === null) return <div className="h-full flex items-center justify-center text-dim text-sm">Loading inbox…</div>;

  if (connected === false) return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-14 h-14 rounded-2xl glass-inner flex items-center justify-center mb-4"><Mail size={26} className="text-ember" /></div>
      <div className="text-lg font-bold text-paper mb-1">Connect your inbox</div>
      <div className="text-sm text-muted max-w-sm mb-4">Link your Google account to read, reply to and triage your email here — and turn messages into CRM records.</div>
      <button onClick={() => onNavigate?.('account')} className="btn-glass px-5 py-2.5 rounded-xl text-sm font-semibold">Go to My Account → Connect Google</button>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-bdr flex items-center gap-3 shrink-0">
        <Mail size={20} className="text-ember" />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-paper leading-tight">Inbox</div>
          <div className="text-[11px] text-muted truncate">{connected.email}</div>
        </div>
        <form onSubmit={runSearch} className="hidden sm:flex items-center gap-1.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search mail…"
              className="pl-8 pr-3 py-1.5 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember w-48" />
          </div>
        </form>
        <button onClick={() => loadList(activeQ)} title="Refresh" className="btn-ghost p-2 rounded-xl"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {error && <div className="mx-6 mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</div>}

      {/* Two-pane */}
      <div className="flex-1 min-h-0 flex">
        {/* List */}
        <div className={`${selected ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[360px] md:border-r border-bdr overflow-y-auto`}>
          {loading && !messages.length ? (
            <div className="p-6 text-center text-dim text-sm">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-dim text-sm">No messages.</div>
          ) : messages.map(m => {
            const from = parseAddr(m.from);
            const active = selected?.id === m.id;
            return (
              <button key={m.id} onClick={() => openMessage(m)}
                className={`text-left px-4 py-3 border-b border-bdr/60 transition ${active ? 'bg-ember/10' : 'hover:bg-card'} ${m.unread ? '' : 'opacity-75'}`}>
                <div className="flex items-center gap-2">
                  {m.unread && <span className="w-2 h-2 rounded-full bg-ember shrink-0" />}
                  <span className={`text-sm truncate flex-1 ${m.unread ? 'font-bold text-paper' : 'font-medium text-muted'}`}>{from.name}</span>
                  <span className="text-[10px] text-dim shrink-0">{fmtDate(m.date)}</span>
                </div>
                <div className={`text-sm truncate ${m.unread ? 'text-paper' : 'text-muted'}`}>{m.subject || '(no subject)'}</div>
                <div className="text-xs text-dim truncate mt-0.5">{m.snippet}</div>
              </button>
            );
          })}
        </div>

        {/* Reading pane */}
        <div className={`${selected ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 overflow-y-auto`}>
          {!selected ? (
            <div className="h-full flex items-center justify-center text-dim text-sm">Select a message to read</div>
          ) : selLoading || selected._loading ? (
            <div className="h-full flex items-center justify-center text-dim text-sm">Loading message…</div>
          ) : (
            <MessageView msg={selected} profile={profile} onNavigate={onNavigate}
              onBack={() => setSelected(null)} onArchive={() => archive(selected.id)}
              callFn={callFn} />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageView({ msg, profile, onNavigate, onBack, onArchive, callFn }) {
  const from = parseAddr(msg.from);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');

  // CRM link state
  const [contact, setContact] = useState(undefined); // undefined=loading, null=none, obj=found
  const [linkMsg, setLinkMsg] = useState('');
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    setReplyOpen(false); setReplyBody(''); setSent(false); setErr(''); setLinkMsg('');
    setContact(undefined);
    supabase.from('contacts').select('id, first_name, last_name, email').ilike('email', from.email).limit(1)
      .then(r => setContact(r.data?.[0] || null));
  }, [msg.id]);

  const send = async () => {
    if (!replyBody.trim()) return;
    setSending(true); setErr('');
    try {
      await callFn({
        action: 'send', to: from.email,
        subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`,
        body: replyBody, threadId: msg.threadId,
        inReplyTo: msg.messageId, references: msg.references,
      });
      setSent(true); setReplyOpen(false); setReplyBody('');
      // also log the reply to CRM if linked
      if (contact?.id) {
        await supabase.from('crm_activities').insert({
          type: 'email', subject: `Re: ${msg.subject || ''}`, body: replyBody,
          subject_type: 'contact', subject_id: contact.id, contact_id: contact.id,
          actor_id: profile.id, direction: 'outbound', is_internal: false,
          occurred_at: new Date().toISOString(),
        });
      }
      setTimeout(() => setSent(false), 2500);
    } catch (e) { setErr(e.message); }
    setSending(false);
  };

  const logToCrm = async () => {
    if (!contact?.id) return;
    setLinking(true);
    await supabase.from('crm_activities').insert({
      type: 'email', subject: msg.subject || '(no subject)', body: msg.text || '',
      subject_type: 'contact', subject_id: contact.id, contact_id: contact.id,
      actor_id: profile.id, direction: 'inbound', is_internal: false,
      occurred_at: msg.date ? new Date(msg.date).toISOString() : new Date().toISOString(),
      channel_metadata: { gmail_message_id: msg.id, from: msg.from },
    });
    setLinking(false);
    setLinkMsg('Logged to contact ✓');
    setTimeout(() => setLinkMsg(''), 2500);
  };

  const createContact = async () => {
    setLinking(true);
    const nameParts = from.name.split(' ');
    const { data: c } = await supabase.from('contacts').insert({
      first_name: nameParts[0] || from.email, last_name: nameParts.slice(1).join(' ') || null,
      email: from.email, source: 'inbox', owner_id: profile.id,
    }).select('id, first_name, last_name, email').single();
    setContact(c || null);
    setLinking(false);
    setLinkMsg('Contact created ✓');
    setTimeout(() => setLinkMsg(''), 2500);
  };

  const input = "w-full px-3 py-2 bg-card border border-bdr rounded-xl text-sm text-paper placeholder-dim focus:outline-none focus:border-ember";

  return (
    <div className="flex flex-col h-full">
      {/* Subject + actions */}
      <div className="px-6 py-4 border-b border-bdr shrink-0">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="md:hidden text-muted hover:text-paper text-lg mt-0.5">&larr;</button>
          <div className="flex-1 min-w-0">
            <div className="text-lg font-bold text-paper break-words">{msg.subject || '(no subject)'}</div>
            <div className="text-sm text-muted mt-1">
              <span className="font-medium text-paper">{from.name}</span>
              <span className="text-dim"> · {from.email}</span>
            </div>
            <div className="text-[11px] text-dim mt-0.5">{msg.date ? new Date(msg.date).toLocaleString('en-GB') : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <button onClick={() => setReplyOpen(o => !o)} className="btn-glass px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Reply size={14} /> Reply</button>
          <button onClick={onArchive} className="btn-ghost px-3 py-1.5 rounded-xl text-sm flex items-center gap-1.5"><Archive size={14} /> Archive</button>

          {/* CRM link */}
          {contact === undefined ? null : contact ? (
            <>
              <button onClick={() => onNavigate?.('contact', contact.id)} className="px-3 py-1.5 rounded-xl text-sm bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 flex items-center gap-1.5">
                <ExternalLink size={14} /> {[contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email}
              </button>
              <button onClick={logToCrm} disabled={linking} className="btn-ghost px-3 py-1.5 rounded-xl text-sm flex items-center gap-1.5"><Link2 size={14} /> Log to CRM</button>
            </>
          ) : (
            <button onClick={createContact} disabled={linking} className="px-3 py-1.5 rounded-xl text-sm bg-ember/15 text-ember-deep border border-ember/25 hover:bg-ember/25 flex items-center gap-1.5"><Plus size={14} /> Create contact</button>
          )}
          {linkMsg && <span className="text-sm text-emerald-600 font-medium">{linkMsg}</span>}
          {sent && <span className="text-sm text-emerald-600 font-medium">Reply sent ✓</span>}
        </div>
      </div>

      {/* Reply composer */}
      {replyOpen && (
        <div className="px-6 py-3 border-b border-bdr bg-card/50 shrink-0">
          <div className="text-[11px] text-dim mb-1">Replying to {from.email}</div>
          <textarea className={input + ' resize-none'} rows={4} autoFocus value={replyBody}
            onChange={e => setReplyBody(e.target.value)} placeholder="Write your reply…" />
          {err && <div className="text-xs text-red-600 mt-1">{err}</div>}
          <div className="flex gap-2 mt-2">
            <button onClick={send} disabled={sending} className="btn-glass px-4 py-1.5 rounded-xl text-sm font-semibold disabled:opacity-50">{sending ? 'Sending…' : 'Send reply'}</button>
            <button onClick={() => setReplyOpen(false)} className="px-4 py-1.5 text-sm text-muted border border-bdr rounded-xl">Cancel</button>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {msg.text ? (
          <div className="text-sm text-paper whitespace-pre-wrap break-words leading-relaxed max-w-3xl">{msg.text}</div>
        ) : msg.html ? (
          <div className="prose-email text-sm text-paper max-w-3xl break-words" dangerouslySetInnerHTML={{ __html: sanitize(msg.html) }} />
        ) : (
          <div className="text-sm text-dim italic">No readable content.</div>
        )}
      </div>
    </div>
  );
}

// Light sanitiser: strip scripts/styles/event handlers before rendering HTML email.
function sanitize(html) {
  return (html || '')
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}
