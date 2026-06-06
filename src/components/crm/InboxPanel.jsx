import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { useGoogleConnection } from '../../lib/useGoogle';
import { Mail, RefreshCw, Archive, Reply, Search, Link2, Plus, ExternalLink, Ticket, CheckSquare } from 'lucide-react';

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
  const { connected, connect } = useGoogleConnection(profile.id);
  const [messages, setMessages] = useState([]);
  const [signature, setSignature] = useState('');
  const [signatureLogo, setSignatureLogo] = useState(false);
  const [brandingLogo, setBrandingLogo] = useState(null);
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

  const loadList = useCallback(async (q) => {
    setLoading(true); setError('');
    try {
      const d = await callFn({ action: 'list', q });
      setMessages(d.messages || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [callFn]);

  useEffect(() => { if (connected) loadList(activeQ); }, [connected, activeQ, loadList]);

  useEffect(() => {
    supabase.from('profiles').select('email_signature, email_signature_logo').eq('id', profile.id).maybeSingle()
      .then(r => { setSignature(r.data?.email_signature || ''); setSignatureLogo(!!r.data?.email_signature_logo); }).catch(() => {});
    supabase.from('support_settings').select('logo_url').eq('id', 1).maybeSingle()
      .then(r => setBrandingLogo(r.data?.logo_url || null));
  }, [profile.id]);

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
      <button onClick={connect} className="btn-glass px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2">
        <Mail size={16} /> Connect Google
      </button>
      <div className="text-[11px] text-dim mt-2">Opens a Google sign-in window. Takes a few seconds.</div>
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
              callFn={callFn} signature={signature} signatureLogo={signatureLogo} brandingLogo={brandingLogo} />
          )}
        </div>
      </div>
    </div>
  );
}

function MessageView({ msg, profile, onNavigate, onBack, onArchive, callFn, signature, signatureLogo, brandingLogo }) {
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
  const [created, setCreated] = useState(null); // { type, id, label } after triage

  const useLogo = signatureLogo && brandingLogo;

  useEffect(() => {
    setReplyOpen(false); setReplyBody(''); setSent(false); setErr(''); setLinkMsg(''); setCreated(null);
    setContact(undefined);
    supabase.from('contacts').select('id, first_name, last_name, email').ilike('email', from.email).limit(1)
      .then(r => setContact(r.data?.[0] || null));
  }, [msg.id]);

  const openReply = () => setReplyOpen(o => !o);

  // Find a company linked to the matched contact (for ticket routing).
  const findCompanyId = async () => {
    if (!contact?.id) return null;
    const { data } = await supabase.from('associations').select('from_id, to_id, from_type, to_type')
      .or(`and(from_type.eq.contact,from_id.eq.${contact.id},to_type.eq.company),and(to_type.eq.contact,to_id.eq.${contact.id},from_type.eq.company)`).limit(1);
    return data && data.length ? (data[0].from_type === 'company' ? data[0].from_id : data[0].to_id) : null;
  };

  const createTicket = async () => {
    setLinking(true); setErr('');
    try {
      const companyId = await findCompanyId();
      const { data: t, error } = await supabase.from('tickets').insert({
        subject: msg.subject || `Email from ${from.name}`,
        description: msg.text || '',
        channel: 'email', source: 'inbox',
        customer_email: from.email,
        contact_id: contact?.id || null,
        company_id: companyId,
        priority: 'P2', ticket_type: 'support', owner_id: profile.id,
      }).select('id, ticket_number').single();
      if (error) throw error;
      await supabase.from('stage_history').insert({ object_type: 'ticket', object_id: t.id, from_stage: null, to_stage: 'new', changed_by: profile.id });
      if (contact?.id) await supabase.from('associations').insert({ from_type: 'ticket', from_id: t.id, to_type: 'contact', to_id: contact.id, label: 'primary_contact' });
      setCreated({ type: 'ticket', id: t.id, label: t.ticket_number ? `Ticket #${t.ticket_number}` : 'Ticket' });
    } catch (e) { setErr('Could not create ticket: ' + e.message); }
    setLinking(false);
  };

  const createTask = async () => {
    setLinking(true); setErr('');
    try {
      const { data: t, error } = await supabase.from('tasks').insert({
        title: msg.subject || `Follow up: ${from.name}`,
        description: (msg.text || '') + `\n\n(From email: ${from.email})`,
        priority: 'P2', owner_id: profile.id,
      }).select('id').single();
      if (error) throw error;
      if (contact?.id) await supabase.from('associations').insert({ from_type: 'task', from_id: t.id, to_type: 'contact', to_id: contact.id, label: 'related' });
      setCreated({ type: 'task', id: t.id, label: 'Task' });
    } catch (e) { setErr('Could not create task: ' + e.message); }
    setLinking(false);
  };

  const send = async () => {
    if (!replyBody.trim()) return;
    setSending(true); setErr('');
    try {
      // Plain-text body = message + text signature. HTML body adds the logo footer.
      const sigText = signature ? `\n\n--\n${signature}` : '';
      const plain = replyBody + sigText;
      let html;
      if (useLogo || signature) {
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const nl2br = (s) => esc(s).replace(/\n/g, '<br>');
        const sigHtml = (signature || useLogo)
          ? `<br><br><div style="color:#6b7280">--</div>` +
            (useLogo ? `<img src="${brandingLogo}" alt="" height="44" style="margin:6px 0;display:block">` : '') +
            (signature ? `<div>${nl2br(signature)}</div>` : '')
          : '';
        html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">${nl2br(replyBody)}${sigHtml}</div>`;
      }
      await callFn({
        action: 'send', to: from.email,
        subject: msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || ''}`,
        body: plain, html, threadId: msg.threadId,
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
          <button onClick={openReply} className="btn-glass px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1.5"><Reply size={14} /> Reply</button>
          <button onClick={onArchive} className="btn-ghost px-3 py-1.5 rounded-xl text-sm flex items-center gap-1.5"><Archive size={14} /> Archive</button>

          {/* Triage: turn the email into work */}
          <span className="w-px h-5 bg-bdr mx-0.5" />
          <button onClick={createTicket} disabled={linking} className="px-3 py-1.5 rounded-xl text-sm bg-blue-100 text-blue-700 border border-blue-200 hover:bg-blue-200 flex items-center gap-1.5"><Ticket size={14} /> Ticket</button>
          <button onClick={createTask} disabled={linking} className="px-3 py-1.5 rounded-xl text-sm bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 flex items-center gap-1.5"><CheckSquare size={14} /> Task</button>

          {/* CRM link */}
          <span className="w-px h-5 bg-bdr mx-0.5" />
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
          {created && (
            <button onClick={() => onNavigate?.(created.type, created.id)} className="text-sm text-emerald-600 font-medium underline flex items-center gap-1">
              {created.label} created — open <ExternalLink size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Reply composer */}
      {replyOpen && (
        <div className="px-6 py-3 border-b border-bdr bg-card/50 shrink-0">
          <div className="text-[11px] text-dim mb-1">Replying to {from.email}{(signature || useLogo) && ' · your signature will be added'}</div>
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
