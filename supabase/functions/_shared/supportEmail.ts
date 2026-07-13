// Send a plain notification/support email from the connected support mailbox,
// auto-detecting the provider so alerts work on the Microsoft CRMs too.
//   • Microsoft 365 — if a mailbox is connected (microsoft_connections), send
//     via Graph /me/sendMail.
//   • Gmail — otherwise fall back to the Gmail path (gmail_connections).
// notify-dispatch previously called sendInvoiceEmail directly, which is
// Gmail-only, so email alerts silently failed on the Microsoft instances.

import { sendInvoiceEmail } from "./invoiceEmail.ts";
import { graph, msTokenFromRefresh } from "./microsoft.ts";

export async function sendSupportEmail(supabase: any, to: string, subject: string, html: string): Promise<void> {
  // Prefer a connected Microsoft mailbox. Guard the lookup so a missing
  // microsoft_connections table (Gmail-only instances) just falls through.
  let msConn: { id: string; refresh_token: string } | null = null;
  try {
    const { data } = await supabase.from("microsoft_connections")
      .select("id, refresh_token").eq("is_active", true)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data?.refresh_token) msConn = data;
  } catch (_) { /* no microsoft_connections table -> Gmail instance */ }

  if (msConn) {
    const tok = await msTokenFromRefresh(msConn.refresh_token);
    await supabase.from("microsoft_connections").update({
      access_token: tok.access_token,
      token_expires_at: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      ...(tok.refresh_token ? { refresh_token: tok.refresh_token } : {}),
    }).eq("id", msConn.id);
    await graph(tok.access_token, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
    return;
  }

  // Gmail fallback (also used by every Gmail-only instance).
  await sendInvoiceEmail(supabase, to, subject, html);
}
