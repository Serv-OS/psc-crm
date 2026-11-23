// Research the house (Peter, 19 Nov 2026): everything we can find about a
// property that matters for re-siding it, on one button.
//
//   POST { location_id }  (staff JWT)  -> { id }   starts a run, returns at once
//
// The run carries on in the background and writes to house_research:
//   1. Google: geocode, Street View (front + two angles), satellite, and the
//      Solar API building outline and roof (footprint, pitch, height).
//   2. Claude looks at the photos and searches public listings and city/county
//      records, then answers the siding questions as JSON.
// The CRM page watches the row (realtime) and shows it when status = done.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const M_TO_FT = 3.28084;
const r1 = (n: number) => Math.round(n * 10) / 10;

function b64(buf: ArrayBuffer) {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Compass bearing from a to b, so Street View looks AT the house, not down the road.
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const t = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(t(b.lng - a.lng)) * Math.cos(t(b.lat));
  const x = Math.cos(t(a.lat)) * Math.sin(t(b.lat)) - Math.sin(t(a.lat)) * Math.cos(t(b.lat)) * Math.cos(t(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

async function google(key: string, address: string) {
  const facts: Record<string, unknown> = {};
  const geo = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`).then((r) => r.json());
  const hit = geo.results?.[0];
  if (!hit) {
    if (geo.status === "REQUEST_DENIED") throw new Error(`Google refused the CRM's key: ${geo.error_message || "no reason given"}`);
    throw new Error(`Google could not find "${address}" (${geo.status}).`);
  }
  // Only research a HOUSE. If Google could only place the town or the street
  // (a misspelt street name does this), stop rather than research whatever
  // building sits in the middle of town (SEA, 23 Nov 2026: a typo'd street
  // returned "Redwood City" and the library got researched).
  const types: string[] = hit.types || [];
  if (!types.some((t) => ["street_address", "premise", "subpremise"].includes(t))) {
    throw new Error(`Google could only find "${hit.formatted_address}" for "${address}", not the house itself. Check the house number and the spelling of the street on the property, then research again.`);
  }
  const pos = hit.geometry.location as { lat: number; lng: number };
  facts.position = pos;
  facts.formatted_address = hit.formatted_address;
  facts.location_type = hit.geometry.location_type; // ROOFTOP = exact house

  // Street View: where the camera stands, and the date of the photos.
  const meta = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${pos.lat},${pos.lng}&source=outdoor&key=${key}`).then((r) => r.json());
  const shots: { kind: string; label: string; url: string }[] = [];
  if (meta.status === "OK") {
    const cam = meta.location;
    const h = bearing(cam, pos);
    facts.street_view = { date: meta.date, heading: h };
    for (const [label, d] of [["Front", 0], ["Front left", -35], ["Front right", 35]] as const) {
      shots.push({ kind: "street", label, url: `https://maps.googleapis.com/maps/api/streetview?size=640x480&pano=${meta.pano_id}&heading=${(h + d + 360) % 360}&fov=70&pitch=8&key=${key}` });
    }
  } else {
    facts.street_view = { missing: meta.status };
  }
  shots.push({ kind: "satellite", label: "From above", url: `https://maps.googleapis.com/maps/api/staticmap?center=${pos.lat},${pos.lng}&zoom=20&size=640x480&maptype=satellite&format=jpg&key=${key}` });

  // Solar API: the building outline and the roof.
  const solar = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${pos.lat}&location.longitude=${pos.lng}&requiredQuality=LOW&key=${key}`).then((r) => r.json()).catch(() => null);
  if (solar && !solar.error) {
    const sp = solar.solarPotential || {};
    const segs = (sp.roofSegmentStats || []) as any[];
    const bb = solar.boundingBox;
    let outline: Record<string, number> | null = null;
    if (bb?.sw && bb?.ne) {
      const latFt = (bb.ne.latitude - bb.sw.latitude) * 364000;
      const lngFt = (bb.ne.longitude - bb.sw.longitude) * 364000 * Math.cos((pos.lat * Math.PI) / 180);
      outline = { length_ft: Math.round(Math.max(latFt, lngFt)), width_ft: Math.round(Math.min(latFt, lngFt)), box_perimeter_ft: Math.round(2 * (latFt + lngFt)) };
    }
    // Plane heights are above SEA LEVEL: take the ground away to get height above the yard.
    const elev = await fetch(`https://maps.googleapis.com/maps/api/elevation/json?locations=${pos.lat},${pos.lng}&key=${key}`).then((r) => r.json()).catch(() => null);
    const ground = Number(elev?.results?.[0]?.elevation);
    const heights = Number.isFinite(ground)
      ? segs.map((s) => (Number(s.planeHeightAtCenterMeters) || 0) - ground).filter((n) => n > 0 && n < 40)
      : [];
    // Small planes (dormers, bits of porch) give wild pitches: use the main ones, weighted by area.
    const main = segs.filter((s) => (Number(s.stats?.areaMeters2) || 0) >= 5);
    const pitches = main.map((s) => Number(s.pitchDegrees) || 0);
    const wsum = main.reduce((a, s) => a + (Number(s.stats?.areaMeters2) || 0), 0);
    const mainPitch = wsum ? main.reduce((a, s) => a + (Number(s.pitchDegrees) || 0) * (Number(s.stats?.areaMeters2) || 0), 0) / wsum : null;
    const roofM2 = Number(sp.wholeRoofStats?.areaMeters2) || 0;
    const groundM2 = Number(sp.wholeRoofStats?.groundAreaMeters2) || 0;
    facts.building = {
      footprint_sqft: groundM2 ? Math.round(groundM2 * 10.7639) : null,
      roof_area_sqft: roofM2 ? Math.round(roofM2 * 10.7639) : null,
      roof_planes: segs.length || null,
      roof_pitch_degrees: pitches.length ? { main: mainPitch == null ? null : r1(mainPitch), min: r1(Math.min(...pitches)), max: r1(Math.max(...pitches)) } : null,
      roof_mid_height_ft: heights.length ? r1(Math.max(...heights) * M_TO_FT) : null, // middle of the highest roof plane, above the ground
      outline,
      imagery_date: solar.imageryDate ? `${solar.imageryDate.year}-${String(solar.imageryDate.month).padStart(2, "0")}` : null,
    };
  } else {
    facts.building = { missing: solar?.error?.message || "No building data" };
  }
  return { facts, shots };
}

const SYSTEM = `You research houses for Peninsula Siding, a James Hardie siding contractor in the San Francisco Bay Area (mostly San Mateo County). A homeowner has asked for a siding quote. Before anyone visits, the estimator wants to know everything public about this house that affects the siding job.

Find EVERYTHING public about this house: its age, every sale and price, the owner of record, assessed value and tax, past building permits (especially re-siding, roofing, windows, additions), old listing descriptions and photos, renovations, and the rules that apply to it. Use the photos you are given and search the web (Zillow, Redfin, Realtor.com, Trulia, county assessor and recorder, city permit portals, CAL FIRE hazard maps, FEMA flood maps, historic district and HOA lists). Search more than once with different wording. Prefer facts you found over guesses. When you are inferring from a photo, say so. Never invent a number: use null and say what to check on site.

Reply with ONE fenced \`\`\`json block and nothing after it, shaped exactly like this:
{
  "summary": "2 or 3 plain sentences: the house and what the job looks like",
  "property": { "year_built": n|null, "age_years": n|null, "living_sqft": n|null, "lot_sqft": n|null, "beds": n|null, "baths": n|null, "stories": n|null, "property_type": "", "apn": "", "zoning": "" },
  "ownership": {
    "owner_of_record": "",
    "owner_matches_enquirer": true|false|null,
    "owned_since": "",
    "sales": [{ "date": "", "price": n|null, "event": "Sold | Listed | Listing removed | Transfer" }],
    "assessed_value": n|null,
    "estimated_value": n|null,
    "annual_property_tax": n|null,
    "occupancy": "owner occupied | rented | unknown"
  },
  "permits": [{ "date": "", "description": "", "source": "" }],
  "history": "renovations, additions and changes found in old listings or records",
  "exterior": { "current_material": "", "condition": "", "trim": "", "colours": "", "style": "", "windows_visible": n|null, "doors_visible": n|null, "garage": "", "soffits_eaves": "", "gutters": "", "other": "" },
  "job": {
    "demo_type": "Demo Siding and Trim | Demo Trim | Demo Stucco | None",
    "stories_for_quote": n|null,
    "estimated_wall_sqft": n|null,
    "wall_sqft_reasoning": "how you got it",
    "suggested_product": "",
    "access": "slope, side yards, fences, landscaping, power lines, neighbours close",
    "needs_pump_jack": true|false|null,
    "lead_test_needed": true|false|null,
    "asbestos_risk": "",
    "dry_rot_risk": ""
  },
  "rules": { "city_or_county": "", "permit_notes": "", "fire_hazard_zone": "", "historic_or_hoa": "", "coastal_exposure": "" },
  "crm_answers": { "<key from the list below>": { "answer": "", "basis": "found | from photo | inferred" } },
  "check_on_site": ["short items"],
  "selling_points": ["short items to mention to this homeowner"]
}

crm_answers: our own sales questions. Answer every one you can from the record or the photos, keyed exactly as written, and leave out the ones you cannot:
  prequal.home_age            Roughly what year was the home built?
  prequal.is_owner            Is the enquirer the homeowner? (compare with the owner of record)
  prequal.in_service_area     Is the property in our service area? (San Mateo County and nearby)
  prequal.current_material    What siding is on the house now?
  prequal.damage_signs        Visible leaks, rot, cracked or warped siding?
  prequal.part_of_renovation  Any other renovation going on (recent permits)?
  scope.current_type          What type of siding is currently installed?
  scope.resided_before        Has the home been re-sided before? (permits, old listing photos)
  scope.problem_areas         Known problem areas or previous repairs
  scope.attention_areas       Areas around windows, doors, decks, corners or rooflines needing attention
  scope.trim                  Exterior trim
  scope.items                 Exterior items involved (decks, railings, gutters, lights, vents, hose bibs)
  scope.existing_material     Existing material to remove (and any asbestos or lead concern)
  scope.access                Special access or staging concerns
  scope.protection            Landscaping, decks, patios or walkways to protect
  scope.hoa                   HOA approval required?
  scope.historic              Historic or architectural restrictions?

Rules of thumb: lead_test_needed is true for homes built before 1978. Fibre cement or cement asbestos shingles from about 1920 to 1980 may contain asbestos. Wall sq ft is roughly the outline perimeter x 9 ft per storey, less nothing for windows (the estimator removes them). Hardie is non combustible, which matters in a fire hazard zone, and ColorPlus suits salt air near the coast.`;

async function claude(apiKey: string, model: string, address: string, enquirer: string, facts: unknown, images: { label: string; data: string; type?: string }[]) {
  const content: any[] = [];
  for (const img of images) {
    content.push({ type: "text", text: img.label });
    content.push({ type: "image", source: { type: "base64", media_type: img.type || "image/jpeg", data: img.data } });
  }
  content.push({ type: "text", text: `Address: ${address}\nEnquirer (the person who contacted us): ${enquirer || "unknown"}\n\nWhat Google knows about the building:\n${JSON.stringify(facts, null, 2)}\n\nResearch this house for the siding quote.` });
  const messages: any[] = [{ role: "user", content }];

  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "medium" },
        fallbacks: "default",
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 15, user_location: { type: "approximate", country: "US", region: "California" } }],
        messages,
      }),
    });
    const ai = await res.json();
    if (!res.ok) throw new Error(ai?.error?.message || `Claude request failed (${res.status}).`);
    if (ai.stop_reason === "refusal") throw new Error("Claude declined this research.");
    if (ai.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: ai.content });
      continue;
    }
    const blocks = ai.content || [];
    const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const sources: { title: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const b of blocks) {
      for (const c of b.citations || []) {
        if (c.url && !seen.has(c.url)) { seen.add(c.url); sources.push({ title: c.title || c.url, url: c.url }); }
      }
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url && !seen.has(r.url) && sources.length < 25) { seen.add(r.url); sources.push({ title: r.title || r.url, url: r.url }); }
      }
    }
    const m = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})\s*$/);
    if (!m) throw new Error("Claude did not return the report.");
    return { findings: JSON.parse(m[1]), sources };
  }
  throw new Error("The research took too long. Try again.");
}

async function run(supabase: any, id: string, loc: any, apiKey: string, model: string, gkey: string) {
  try {
    const address = [loc.address, loc.city, loc.postcode].filter(Boolean).join(", ");
    const { facts, shots } = await google(gkey, address);

    // Keep the photos (private bucket) and hand them to Claude.
    const images: { kind: string; path: string; label: string }[] = [];
    const forClaude: { label: string; data: string }[] = [];
    for (const s of shots) {
      const r = await fetch(s.url);
      if (!r.ok || !(r.headers.get("content-type") || "").startsWith("image/")) continue;
      const buf = await r.arrayBuffer();
      const type = (r.headers.get("content-type") || "image/jpeg").split(";")[0];
      const ext = type === "image/png" ? "png" : "jpg";
      const path = `house-research/${loc.id}/${id}/${s.label.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
      await supabase.storage.from("attachments").upload(path, new Uint8Array(buf), { contentType: type, upsert: true });
      images.push({ kind: s.kind, path, label: s.label });
      forClaude.push({ label: `${s.label} (${s.kind === "street" ? "Street View" : "satellite"})`, data: b64(buf), type });
    }
    await supabase.from("house_research").update({ facts, images }).eq("id", id);

    // Who contacted us, to check against the owner of record.
    const { data: links } = await supabase.from("associations").select("from_type, from_id, to_type, to_id")
      .or(`and(from_type.eq.location,from_id.eq.${loc.id},to_type.eq.contact),and(to_type.eq.location,to_id.eq.${loc.id},from_type.eq.contact)`);
    const ids = (links || []).map((l: any) => (l.from_type === "contact" ? l.from_id : l.to_id));
    const { data: people } = ids.length ? await supabase.from("contacts").select("first_name, last_name").in("id", ids) : { data: [] };
    const enquirer = (people || []).map((p: any) => [p.first_name, p.last_name].filter(Boolean).join(" ")).filter(Boolean).join(", ");

    const { findings, sources } = await claude(apiKey, model, (facts.formatted_address as string) || address, enquirer, facts, forClaude);
    await supabase.from("house_research").update({ status: "done", findings, sources, finished_at: new Date().toISOString() }).eq("id", id);
  } catch (e) {
    await supabase.from("house_research").update({ status: "failed", error: (e as Error).message, finished_at: new Date().toISOString() }).eq("id", id);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await supabase.auth.getUser(jwt);
  if (!u?.user) return json({ error: "Sign in first." }, 401);
  const { data: prof } = await supabase.from("profiles").select("id, role").eq("id", u.user.id).maybeSingle();
  if (!prof) return json({ error: "Sign in first." }, 401);

  try {
    const { location_id } = await req.json().catch(() => ({}));
    if (!location_id) return json({ error: "Missing location_id" }, 422);
    const { data: loc } = await supabase.from("locations").select("id, address, city, postcode").eq("id", location_id).maybeSingle();
    if (!loc) return json({ error: "Property not found" }, 404);
    if (!String(loc.address || "").trim()) return json({ error: "Add the property's address first." }, 422);

    // Pasted keys can carry spaces or quote marks.
    const gkey = (Deno.env.get("GOOGLE_MAPS_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
    if (!gkey) return json({ error: "Google Maps is not set up for the CRM yet." }, 503);
    const { data: cfg } = await supabase.from("ai_settings").select("api_key, enabled").eq("id", 1).maybeSingle();
    if (!cfg?.api_key) return json({ error: "Add your Anthropic API key in Settings, AI Assistant." }, 400);

    // One run at a time per house.
    const { data: busy } = await supabase.from("house_research").select("id").eq("location_id", loc.id).eq("status", "running")
      .gte("created_at", new Date(Date.now() - 10 * 60000).toISOString()).limit(1);
    if (busy?.length) return json({ id: busy[0].id, already: true });

    const address = [loc.address, loc.city, loc.postcode].filter(Boolean).join(", ");
    const { data: row, error } = await supabase.from("house_research").insert({ location_id: loc.id, address, created_by: prof.id }).select("id").single();
    if (error) return json({ error: error.message }, 500);

    const work = run(supabase, row.id, loc, cfg.api_key, "claude-opus-5-5", gkey);
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
    return json({ id: row.id });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
