// One-click AI draft for support tickets (any channel).
// Pulls the ticket + its conversation + company/contact context, asks Claude
// for a channel-appropriate reply, and returns the draft for the agent to
// review and send. Drafting only — a human always sends.
// Auth: caller JWT (any authenticated agent).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Channel → drafting guidance + the activity type to pre-select in the composer.
function channelGuidance(channel: string | null): { rule: string; type: string } {
  switch ((channel || "").toLowerCase()) {
    case "sms":
      return { rule: "This is an SMS. Keep it under 320 characters, plain text, no greeting or sign-off.", type: "sms" };
    case "whatsapp":
      return { rule: "This is a WhatsApp message. Conversational and brief, light formatting only.", type: "whatsapp" };
    case "phone":
    case "call":
      return { rule: "This is a phone follow-up. Write concise talking points the agent can say aloud.", type: "call" };
    case "email":
      return { rule: "This is an email. Include a short greeting and a sign-off from the ServOS support team.", type: "email" };
    default:
      return { rule: "This is a web/chat message. Be conversational and direct; a brief greeting is fine.", type: "email" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Authenticate the caller
  const auth = req.headers.get("Authorization")?.replace("Bearer ", "");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { data: { user } } = await supabase.auth.getUser(auth);
  if (!user) return json({ error: "Unauthorized" }, 401);

  try {
    const { ticket_id } = await req.json();
    if (!ticket_id) return json({ error: "Missing ticket_id" }, 422);

    // AI config (key stored server-side)
    const { data: cfg } = await supabase.from("ai_settings").select("*").eq("id", 1).maybeSingle();
    if (!cfg?.enabled) return json({ error: "AI assistant is turned off in Settings." }, 400);
    if (!cfg?.api_key) return json({ error: "Add your Anthropic API key in Settings → AI Assistant." }, 400);

    // Ticket + context
    const { data: ticket } = await supabase.from("tickets").select("*").eq("id", ticket_id).maybeSingle();
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    const [{ data: company }, { data: contact }, { data: activities }] = await Promise.all([
      ticket.company_id ? supabase.from("companies").select("name").eq("id", ticket.company_id).maybeSingle() : Promise.resolve({ data: null }),
      ticket.contact_id ? supabase.from("contacts").select("first_name, last_name").eq("id", ticket.contact_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("crm_activities").select("type, direction, subject, body, occurred_at")
        .eq("subject_type", "ticket").eq("subject_id", ticket_id).order("occurred_at", { ascending: true }).limit(40),
    ]);

    const contactName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : null;
    const { rule, type } = channelGuidance(ticket.channel);

    // Build the conversation transcript
    const lines: string[] = [];
    lines.push(`Ticket subject: ${ticket.subject || "(none)"}`);
    if (ticket.description) lines.push(`Original message: ${ticket.description}`);
    if (company?.name) lines.push(`Company: ${company.name}`);
    if (contactName) lines.push(`Customer: ${contactName}`);
    lines.push(`Channel: ${ticket.channel || "web"}`);
    lines.push("");
    lines.push("Conversation so far (oldest first):");
    if (activities && activities.length) {
      for (const a of activities) {
        const who = a.direction === "inbound" ? "Customer" : a.direction === "outbound" ? "Agent" : "Internal note";
        const text = [a.subject, a.body].filter(Boolean).join(" — ");
        if (text) lines.push(`- [${who}] ${text}`);
      }
    } else {
      lines.push("- (no replies yet)");
    }

    const system = `You are a customer support agent for ServOS, a restaurant point-of-sale (POS) company. ` +
      `Draft the next reply to the customer on this support ticket. ` +
      `Tone: ${cfg.tone || "friendly, concise and professional"}. ${rule} ` +
      `Be genuinely helpful and specific to what they asked. Do not invent facts, prices, or commitments you don't have — if you need information to resolve it, ask a clear question or say a teammate will follow up. ` +
      `Output ONLY the reply text itself, with no preamble, labels, or quotation marks.`;

    // Call Claude (Messages API)
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.model || "claude-opus-4-8",
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: lines.join("\n") }],
      }),
    });

    const ai = await aiRes.json();
    if (!aiRes.ok) {
      return json({ error: ai?.error?.message || "Claude request failed." }, 400);
    }
    const draft = (ai.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!draft) return json({ error: "No draft was generated. Try again." }, 502);

    const suggested_subject = ticket.subject ? `Re: ${ticket.subject}` : null;
    return json({ draft, suggested_type: type, suggested_subject });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
