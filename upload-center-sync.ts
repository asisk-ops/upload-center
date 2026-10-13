// CallSource Data Upload Center — HubSpot sync
// Finds every HubSpot ticket in the "Upload Needed" stage and makes sure it has
// a row in the uploads tracker. Runs every 15 minutes (pg_cron) and from the
// "Sync now" button in the app.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   HUBSPOT_TOKEN     required  HubSpot private app token (tickets + companies read)
//   HUBSPOT_STAGE     optional  stage name to watch, default "Upload Needed"
//   HUBSPOT_PIPELINE  optional  pipeline name or id; blank = search every ticket pipeline
//   HUBSPOT_LIST_TYPE_PROPERTY  optional  internal name of the ticket "list type" property, default "list_type"
// List links are taken from the ticket's notes: the newest note that contains a link.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const HS = "https://api.hubapi.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TYPE_KEYS: [string, string[]][] = [
  ["Declined Services", ["declined"]],
  ["Warranty Expiration", ["warranty", "expiration"]],
  ["Recalls", ["recall"]],
  ["Special Order Parts", ["specialorder", "parts"]],
  ["Missed & Appointment Confirmation", ["missed", "confirmation", "confirmed", "appointment"]],
  ["Telematics / TLE", ["telematics", "connectedservice"]],
  ["CSI", ["csi"]],
  ["CXPro / Service Lifestyle Engine", ["cxpro", "lifestyle", "sle", "servicedue"]],
];
const EXACT: Record<string, string> = { tle: "Telematics / TLE", cx: "CXPro / Service Lifestyle Engine", sle: "CXPro / Service Lifestyle Engine", csi: "CSI", sop: "Special Order Parts" };
function guessType(text: string): string | null {
  const n = (text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return null;
  if (EXACT[n]) return EXACT[n];
  for (const [type, keys] of TYPE_KEYS) if (keys.some((k) => n.includes(k))) return type;
  if (n.includes("service")) return "CXPro / Service Lifestyle Engine";
  return null;
}

async function hs(path: string, token: string, body?: unknown) {
  const res = await fetch(HS + path, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) { await new Promise((r) => setTimeout(r, 1200)); return hs(path, token, body); }
  if (!res.ok) throw new Error(`HubSpot ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: run } = await db.from("du_sync_runs").insert({}).select("id").single();
  const finish = (patch: Record<string, unknown>) =>
    run ? db.from("du_sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run.id) : null;

  try {
    const token = Deno.env.get("HUBSPOT_TOKEN");
    if (!token) throw new Error("HUBSPOT_TOKEN secret is not set");
    const wantStage = (Deno.env.get("HUBSPOT_STAGE") || "Upload Needed").trim().toLowerCase();
    const wantPipe = (Deno.env.get("HUBSPOT_PIPELINE") || "").trim().toLowerCase();
    const ltProp = (Deno.env.get("HUBSPOT_LIST_TYPE_PROPERTY") || "list_type").trim();
    const notices: string[] = [];

    // 0. The ticket "list type" property: map its internal values to their labels.
    const ltLabel: Record<string, string> = {};
    let ltOk = true;
    try {
      const prop = await hs(`/crm/v3/properties/tickets/${encodeURIComponent(ltProp)}`, token);
      for (const o of prop.options ?? []) ltLabel[o.value] = o.label;
    } catch (_) { ltOk = false; notices.push(`Ticket property "${ltProp}" not found`); }
    const listTypeOf = (raw: string | null | undefined) => {
      if (!raw) return null;
      const parts = String(raw).split(";").map((v) => ltLabel[v] ?? v);  // multi-select values are ; separated
      const label = parts[0];
      return guessType(label) ?? guessType(String(raw)) ?? label;
    };

    // 1. Find the pipeline/stage ids whose names match.
    const pipes = await hs("/crm/v3/pipelines/tickets", token);
    const targets: { pipeline: string; stage: string }[] = [];
    for (const p of pipes.results ?? []) {
      if (wantPipe && p.id.toLowerCase() !== wantPipe && String(p.label).toLowerCase() !== wantPipe) continue;
      for (const s of p.stages ?? []) {
        if (String(s.label).trim().toLowerCase() === wantStage || s.id === wantStage) targets.push({ pipeline: p.id, stage: s.id });
      }
    }
    if (!targets.length) throw new Error(`No ticket stage named "${wantStage}" found${wantPipe ? ` in pipeline "${wantPipe}"` : ""}`);

    // 2. Search tickets in those stages.
    const tickets: any[] = [];
    for (const t of targets) {
      let after: string | undefined;
      do {
        const page = await hs("/crm/v3/objects/tickets/search", token, {
          filterGroups: [{ filters: [
            { propertyName: "hs_pipeline", operator: "EQ", value: t.pipeline },
            { propertyName: "hs_pipeline_stage", operator: "EQ", value: t.stage },
          ] }],
          properties: ["subject", "content", "createdate", "hubspot_owner_id", ...(ltOk ? [ltProp] : [])],
          sorts: [{ propertyName: "createdate", direction: "DESCENDING" }],
          limit: 100,
          after,
        });
        tickets.push(...(page.results ?? []));
        after = page.paging?.next?.after;
      } while (after);
    }

    // 3. Associated company names (the dealer).
    const companyOf: Record<string, string> = {};
    for (const part of chunk(tickets.map((t) => ({ id: t.id })), 100)) {
      if (!part.length) continue;
      const assoc = await hs("/crm/v4/associations/tickets/companies/batch/read", token, { inputs: part });
      for (const r of assoc.results ?? []) if (r.to?.[0]) companyOf[r.from.id] = String(r.to[0].toObjectId);
    }
    const companyName: Record<string, string> = {};
    for (const part of chunk([...new Set(Object.values(companyOf))].map((id) => ({ id })), 100)) {
      if (!part.length) continue;
      const res = await hs("/crm/v3/objects/companies/batch/read", token, { inputs: part, properties: ["name"] });
      for (const c of res.results ?? []) companyName[c.id] = c.properties?.name ?? "";
    }

    // 3b. List links: the newest note on the ticket that contains a link.
    const URL_RE = /https?:\/\/[^\s"'<>]+/i;
    const firstUrl = (text: string | null | undefined) => {
      const m = String(text || "").replace(/<[^>]*href="([^"]+)"[^>]*>/gi, " $1 ").replace(/&amp;/g, "&").match(URL_RE);
      return m ? m[0].replace(/[).,;]+$/, "") : null;
    };
    const noteLink: Record<string, string> = {};
    try {
      const noteOf: Record<string, string[]> = {};
      for (const part of chunk(tickets.map((t) => ({ id: t.id })), 100)) {
        if (!part.length) continue;
        const assoc = await hs("/crm/v4/associations/tickets/notes/batch/read", token, { inputs: part });
        for (const r of assoc.results ?? []) noteOf[r.from.id] = (r.to ?? []).map((x: any) => String(x.toObjectId));
      }
      const allNotes = [...new Set(Object.values(noteOf).flat())];
      const body: Record<string, { url: string | null; ts: string }> = {};
      for (const part of chunk(allNotes.map((id) => ({ id })), 100)) {
        if (!part.length) continue;
        const res = await hs("/crm/v3/objects/notes/batch/read", token, { inputs: part, properties: ["hs_note_body", "hs_timestamp"] });
        for (const n of res.results ?? []) body[n.id] = { url: firstUrl(n.properties?.hs_note_body), ts: n.properties?.hs_timestamp || "" };
      }
      for (const [tid, ids] of Object.entries(noteOf)) {
        const best = ids.map((id) => body[id]).filter((b) => b && b.url).sort((a, b) => (a.ts < b.ts ? 1 : -1))[0];
        if (best) noteLink[tid] = best.url!;
      }
    } catch (_) { notices.push("Couldn't read ticket notes for list links"); }
    const linkOf = (t: any) => noteLink[String(t.id)] ?? null;

    // 4. Ticket owners → names, and team members by email.
    const owners: Record<string, { name: string; email: string }> = {};
    try {
      const o = await hs("/crm/v3/owners?limit=500", token);
      for (const x of o.results ?? []) owners[x.id] = { name: [x.firstName, x.lastName].filter(Boolean).join(" ") || x.email, email: (x.email || "").toLowerCase() };
    } catch (_) { /* owners scope not granted — names stay blank */ }
    const { data: profiles } = await db.from("du_profiles").select("id,email");
    const profileByEmail = Object.fromEntries((profiles ?? []).map((p) => [p.email.toLowerCase(), p.id]));

    // 5. Insert tickets the tracker doesn't have yet.
    const { data: existing } = await db.from("du_uploads").select("id,hubspot_ticket_id,hubspot_in_stage,list_type,list_url").not("hubspot_ticket_id", "is", null);
    const known = new Set((existing ?? []).map((e) => e.hubspot_ticket_id));
    const inStage = new Set(tickets.map((t) => String(t.id)));
    const fresh = tickets.filter((t) => !known.has(String(t.id))).map((t) => {
      const subject = t.properties?.subject || `Ticket ${t.id}`;
      const owner = owners[t.properties?.hubspot_owner_id];
      return {
        dealer: companyName[companyOf[t.id]] || subject,
        list_type: listTypeOf(t.properties?.[ltProp]) ?? guessType(t.properties?.content) ?? guessType(subject),
        list_url: linkOf(t),
        status: "Expected",
        source: "hubspot",
        notes: `HubSpot ticket #${t.id}: ${subject}`,
        hubspot_ticket_id: String(t.id),
        hubspot_ticket_name: subject,
        hubspot_owner: owner?.name ?? null,
        hubspot_created_at: t.properties?.createdate ?? null,
        hubspot_in_stage: true,
        owner_id: owner ? profileByEmail[owner.email] ?? null : null,
      };
    });
    if (fresh.length) {
      const { error } = await db.from("du_uploads").upsert(fresh, { onConflict: "hubspot_ticket_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    // 6. Mark which tracked tickets are still sitting in the stage.
    const back = (existing ?? []).filter((e) => inStage.has(e.hubspot_ticket_id) && e.hubspot_in_stage !== true).map((e) => e.id);
    const left = (existing ?? []).filter((e) => !inStage.has(e.hubspot_ticket_id) && e.hubspot_in_stage !== false).map((e) => e.id);
    if (back.length) await db.from("du_uploads").update({ hubspot_in_stage: true }).in("id", back);
    if (left.length) await db.from("du_uploads").update({ hubspot_in_stage: false }).in("id", left);

    // 7. Fill in list type (when blank) and list link (when HubSpot has a newer one) on tracked tickets.
    const byId = Object.fromEntries(tickets.map((t) => [String(t.id), t]));
    let typed = 0;
    for (const e of existing ?? []) {
      const t = byId[e.hubspot_ticket_id];
      if (!t) continue;
      const patch: Record<string, unknown> = {};
      const lt = listTypeOf(t.properties?.[ltProp]) ?? guessType(t.properties?.content);
      if (lt && !e.list_type) { patch.list_type = lt; typed++; }
      const url = linkOf(t);
      if (url && url !== e.list_url) patch.list_url = url;
      if (Object.keys(patch).length) await db.from("du_uploads").update(patch).eq("id", e.id);
    }

    await finish({ found: tickets.length, created: fresh.length, error: notices.length ? notices.join("; ") : null });
    return json({ ok: true, found: tickets.length, created: fresh.length, typed, notices });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish({ error: message });
    return json({ ok: false, error: message }, 500);
  }
});
