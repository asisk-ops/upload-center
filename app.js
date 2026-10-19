/* CallSource Data Upload Center — app logic. Data lives in Supabase (tables du_*);
   with placeholder keys in config.js the app runs on in-memory demo data instead. */
(() => {
const C = window.APP_CONFIG || {};
const DOMAIN = (C.TEAM_DOMAIN || "callsourceauto.com").toLowerCase();
const LIVE = !!(C.SUPABASE_URL && !/YOUR-PROJECT/.test(C.SUPABASE_URL) && C.SUPABASE_ANON_KEY && !/YOUR-/.test(C.SUPABASE_ANON_KEY) && window.supabase);
const sb = LIVE ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

const STATUSES = [["Expected","Expected"],["Received","Received"],["Issues","Issues – sent back"],["Ready","Ready to load"],["OnHold","On hold"],["Loaded","Uploaded"]];
const stLabel = s => (STATUSES.find(x => x[0] === s) || [s, s])[1];

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
function el(tag, props = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  (Array.isArray(kids) ? kids : [kids]).forEach(c => c != null && c !== false && e.append(c));
  return e;
}
const fmt = n => n == null || n === "" ? "–" : isNaN(Number(n)) ? String(n) : Number(n).toLocaleString("en-US");
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const fmtDate = s => { if (!s) return "–"; const d = new Date(s.slice(0, 10) + "T12:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 6e4); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + " hr ago"; const dd = Math.round(h / 24); return dd === 1 ? "yesterday" : dd + " days ago"; };
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2800); }
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; };
const isLate = r => r.status === "Expected" && r.due_on && r.due_on < today();
const turn = r => r.received_on && r.uploaded_on ? days(r.received_on, r.uploaded_on) : null;
/* HubSpot ticket links. Portal (Hub) ID comes from config.js, or is learned from a pasted ticket link. */
const portalId = () => String(C.HUBSPOT_PORTAL_ID || "").trim() || store.get("du-portal") || "";
const parseTicket = v => { v = String(v || "").trim(); if (!v) return { id: null };
  const u = v.match(/hubspot\.com\/[a-z-]+\/(\d+)\/(?:.*\/)?(?:ticket|record\/0-5)\/(\d+)/i); if (u) return { id: u[2], portal: u[1] };
  const n = v.match(/^#?(\d+)$/); return n ? { id: n[1] } : { bad: true }; };
const ticketHref = r => r && r.hubspot_ticket_id && portalId() ? `https://${C.HUBSPOT_HOST || "app.hubspot.com"}/contacts/${portalId()}/record/0-5/${r.hubspot_ticket_id}` : null;
const ticketLink = (r, text, cls) => { const h = ticketHref(r); return h ? el("a", { class: cls, href: h, target: "_blank", rel: "noopener", title: "Open ticket in HubSpot", text, onclick: e => e.stopPropagation() }) : el("span", { text }); };
const refDate = r => r.received_on || (r.hubspot_created_at || r.created_at || "").slice(0, 10);

/* ---------- state ---------- */
const S = { range: (() => { try { return JSON.parse(store.get("du-range")) || { p: "30" }; } catch (e) { return { p: "30" }; } })(), upFilter: null, incentives: [], incFilter: "all", incQ: "", uploads: [], profiles: {}, me: null, sync: null, page: store.get("du-page") || "uploads",
  status: store.get("du-status") || "open", type: "", period: store.get("du-period") || "all", q: "",
  sort: { key: "received_on", dir: "desc" }, editing: null };

/* =========================================================
   DATA LAYER — Supabase when configured, demo data otherwise
   ========================================================= */
const api = LIVE ? {
  async load() {
    const [u, p, s] = await Promise.all([
      sb.from("du_uploads").select("*").order("created_at", { ascending: false }).limit(5000),
      sb.from("du_profiles").select("id,email,full_name"),
      sb.from("du_sync_runs").select("*").order("started_at", { ascending: false }).limit(1)]);
    if (u.error) throw u.error;
    S.uploads = u.data; S.profiles = Object.fromEntries((p.data || []).map(x => [x.id, x])); S.sync = (s.data || [])[0] || null;
    const inc = await sb.from("du_incentives").select("*").order("dealer");  // table may not exist yet
    S.incentives = inc.error ? [] : inc.data;
  },
  subscribe(onChange) {
    sb.channel("du-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "du_uploads" }, ({ eventType, new: n, old: o }) => {
        if (eventType === "DELETE") S.uploads = S.uploads.filter(r => r.id !== o.id);
        else { const i = S.uploads.findIndex(r => r.id === n.id); if (i >= 0) S.uploads[i] = n; else S.uploads.unshift(n); }
        onChange();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "du_incentives" }, ({ eventType, new: n, old: o }) => {
        S.incentives = S.incentives.filter(r => r.dealer !== (n && n.dealer) && r.dealer !== (o && o.dealer));
        if (eventType !== "DELETE") S.incentives.push(n);
        S.incentives.sort((a, b) => a.dealer < b.dealer ? -1 : 1); onChange();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "du_sync_runs" }, ({ new: n }) => { if (n && (!S.sync || n.id >= S.sync.id)) { S.sync = n; onChange(); } })
      .subscribe();
  },
  async insert(body) { const { data, error } = await sb.from("du_uploads").insert(body).select().single(); if (error) throw error; upsertLocal(data); return data; },
  async update(id, patch) { const { data, error } = await sb.from("du_uploads").update(patch).eq("id", id).select().single(); if (error) throw error; upsertLocal(data); return data; },
  async remove(id) { const { error } = await sb.from("du_uploads").delete().eq("id", id); if (error) throw error; S.uploads = S.uploads.filter(r => r.id !== id); },
  async events(id) { const { data } = await sb.from("du_upload_events").select("*").eq("upload_id", id).order("created_at", { ascending: false }).limit(50); return data || []; },
  async sync() { const { data, error } = await sb.functions.invoke("upload-center-sync", { body: {} }); if (error) throw error; return data; }
} : demoApi();
function upsertLocal(row) { const i = S.uploads.findIndex(r => r.id === row.id); if (i >= 0) S.uploads[i] = row; else S.uploads.unshift(row); }

function demoApi() {
  const t = today(), ev = {};
  const people = [["d1", "alyssa@" + DOMAIN, "Alyssa (demo)"], ["d2", "jordan@" + DOMAIN, "Jordan (demo)"], ["d3", "sam@" + DOMAIN, "Sam (demo)"]];
  const mk = (dealer, list_type, status, recv, up, extra = {}) => ({ id: crypto.randomUUID(), dealer, list_type, status, received_on: recv == null ? null : addDays(t, recv), uploaded_on: up == null ? null : addDays(t, up), due_on: null, row_count: null, issue_count: 0, file_name: "", owner_id: "d1", notes: "", source: "manual", created_at: new Date().toISOString(), ...extra });
  const rows = [
    mk("Example Honda", "Recalls", "Loaded", -20, -18, { row_count: 1240, file_name: "ExampleHonda_Recall_09222026.csv" }),
    mk("Example Toyota", "CXPro / Service Lifestyle Engine", "Loaded", -16, -15, { row_count: 3105, owner_id: "d2" }),
    mk("Example Ford", "Declined Services", "Loaded", -12, -9, { row_count: 860, owner_id: "d3" }),
    mk("Example Hyundai", "CSI", "Loaded", -6, -5, { row_count: 512 }),
    mk("Example Subaru", "Recalls", "Loaded", -3, -2, { row_count: 977, owner_id: "d2" }),
    mk("Example Nissan", "Special Order Parts", "Ready", -1, null, { row_count: 140, owner_id: "d3" }),
    mk("Example Chevrolet", "CXPro / Service Lifestyle Engine", "Issues", -2, null, { row_count: 2210, issue_count: 184, notes: "Phone numbers missing on 184 rows; sent back to dealer." }),
    mk("Example Kia", "Missed & Appointment Confirmation", "Received", 0, null, { row_count: 96, owner_id: "d2" }),
    mk("Example Mazda", "Warranty Expiration", "Expected", null, null, { due_on: addDays(t, -2), source: "hubspot", hubspot_ticket_id: "1001", hubspot_ticket_name: "Example Mazda – warranty list", hubspot_owner: "Jordan (demo)", hubspot_created_at: addDays(t, -6) + "T15:00:00Z", hubspot_in_stage: true, owner_id: "d2" }),
    mk("Example Jeep", null, "Expected", null, null, { source: "hubspot", hubspot_ticket_id: "1002", hubspot_ticket_name: "Example Jeep – monthly upload", hubspot_owner: "Sam (demo)", hubspot_created_at: addDays(t, -1) + "T15:00:00Z", hubspot_in_stage: true, owner_id: "d3" }),
    mk("Example Acura", "Recalls", "Received", -1, null, { source: "hubspot", hubspot_ticket_id: "1003", hubspot_ticket_name: "Example Acura – recall list", hubspot_owner: "Alyssa (demo)", hubspot_created_at: addDays(t, -3) + "T15:00:00Z", hubspot_in_stage: true, row_count: 430 })];
  return {
    async load() {
      S.uploads = rows; S.profiles = Object.fromEntries(people.map(([id, email, full_name]) => [id, { id, email, full_name }])); S.me = S.profiles.d1; S.sync = { started_at: new Date(Date.now() - 6 * 6e4).toISOString(), finished_at: new Date().toISOString(), found: 3, created: 0 }; },
    subscribe() {},
    async insert(b) { const r = { id: crypto.randomUUID(), created_at: new Date().toISOString(), source: "manual", ...b }; rows.unshift(r); (ev[r.id] = ev[r.id] || []).unshift({ action: "created", actor_id: "d1", created_at: r.created_at, detail: {} }); return r; },
    async update(id, p) { const r = rows.find(x => x.id === id); if (p.status && p.status !== r.status) (ev[id] = ev[id] || []).unshift({ action: "status", actor_id: "d1", created_at: new Date().toISOString(), detail: { from: r.status, to: p.status } }); Object.assign(r, p); return r; },
    async remove(id) { const i = rows.findIndex(x => x.id === id); rows.splice(i, 1); },
    async events(id) { return ev[id] || []; },
    async sync() { await new Promise(r => setTimeout(r, 600)); S.sync = { started_at: new Date().toISOString(), finished_at: new Date().toISOString(), found: 3, created: 0 }; return { ok: true, found: 3, created: 0 }; }
  };
}

/* =========================================================
   AUTH
   ========================================================= */
let mode = "signin";
function setMode(m, msg = "", ok = false) {
  mode = m;
  $("auth-title").textContent = { signin: "Sign in", signup: "Create your account", reset: "Reset your password", newpass: "Choose a new password" }[m];
  $("auth-go").textContent = { signin: "Sign in", signup: "Create account", reset: "Send reset link", newpass: "Save password" }[m];
  $("row-name").hidden = m !== "signup"; $("row-pass").hidden = m === "reset";
  $("a-email").closest(".fld").hidden = m === "newpass";
  $("a-pass").autocomplete = m === "signin" ? "current-password" : "new-password";
  const box = $("auth-msg"); box.textContent = msg; box.classList.toggle("ok", ok);
}
// Accounts are created by an admin in Supabase; there is no self sign-up or self reset here.
$("authform").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("a-email").value.trim().toLowerCase(), pass = $("a-pass").value, btn = $("auth-go");
  if ((mode === "signup" || mode === "newpass") && pass.length < 8) return setMode(mode, "Passwords need at least 8 characters.");
  if (mode === "signup" || mode === "reset") return setMode("signin", "Ask your admin to create your account or reset your password.");
  btn.disabled = true;
  try {
    if (mode === "signin") { const { error } = await sb.auth.signInWithPassword({ email, password: pass }); if (error) throw error; }
    else if (mode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: $("a-name").value.trim() }, emailRedirectTo: location.href.split("#")[0] } });
      if (error) throw error;
      if (!data.session) setMode("signin", "Check your inbox to confirm your email, then sign in.", true);
    } else if (mode === "reset") {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] }); if (error) throw error;
      setMode("signin", "If that email has an account, a reset link is on its way.", true);
    } else { const { error } = await sb.auth.updateUser({ password: pass }); if (error) throw error; toast("Password updated"); }
  } catch (err) { setMode(mode, /invalid login/i.test(err.message) ? "That email and password don't match." : err.message); }
  finally { btn.disabled = false; }
});
$("signout").addEventListener("click", async () => { if (LIVE) await sb.auth.signOut(); else toast("Demo mode has no sign-in."); });

async function enter(session) {
  if (LIVE) {
    const email = (session.user.email || "").toLowerCase();
    // Access = a @callsourceauto.com email, or an email an admin added to du_extra_members in Supabase.
    const { data: member, error: memberErr } = await sb.rpc("du_is_team");
    if ((memberErr && !email.endsWith("@" + DOMAIN)) || (!memberErr && member === false)) { await sb.auth.signOut(); $("auth").hidden = false; $("app").hidden = true; return setMode("signin", "This account doesn't have access to the Upload Center. Ask an Upload Center admin to add you."); }
    S.me = { id: session.user.id, email, full_name: session.user.user_metadata?.full_name || "" };
  }
  $("auth").hidden = true; $("app").hidden = false;
  try { await api.load(); } catch (e) { toast("Couldn't load uploads: " + (e.message || e)); }
  if (!S.incentives.length) await loadIncentiveFile();
  if (LIVE && S.profiles[S.me.id]) S.me = S.profiles[S.me.id];
  renderMe(); fillOwners(); render();
  api.subscribe(render);
}
function boot() {
  if (!LIVE) { $("demobar").hidden = false; enter(null); return; }
  let entered = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { $("auth").hidden = false; $("app").hidden = true; setMode("newpass"); return; }
    if (session && !entered && mode !== "newpass") { entered = true; enter(session); }
    if (!session) { entered = false; $("app").hidden = true; $("auth").hidden = false; if (mode === "newpass") setMode("signin"); }
    if (session && mode === "newpass" && event === "USER_UPDATED") { mode = "signin"; entered = true; enter(session); }
  });
}

/* =========================================================
   SHELL
   ========================================================= */
const name = id => { const p = S.profiles[id]; return p ? (p.full_name || p.email.split("@")[0]) : ""; };
const avatar = id => el("span", { class: "avatar", style: `background:${hue(id)}`, text: ((name(id) || "?").match(/[A-Za-z]+/g) || ["?"]).filter(w => w.toLowerCase() !== "demo").map(w => w[0]).slice(0, 2).join("").toUpperCase() });
function who(id) { return id && S.profiles[id] ? el("span", { class: "who" }, [avatar(id), el("span", { text: name(id) + (S.me && id === S.me.id ? " (you)" : "") })]) : el("span", { class: "faint", text: "Unassigned" }); }
function renderMe() { const m = S.me; if (!m) return; $("me").replaceChildren(avatar(m.id), el("div", { style: "min-width:0" }, [el("b", { text: m.full_name || m.email.split("@")[0] }), el("small", { text: m.email })])); }
function fillOwners() { const s = $("f-owner"); s.replaceChildren(el("option", { value: "", text: "Unassigned" }), ...Object.values(S.profiles).sort((a, b) => name(a.id).localeCompare(name(b.id))).map(p => el("option", { value: p.id, text: name(p.id) }))); }

function go(page) {
  S.page = page; store.set("du-page", page);
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  ["uploads", "hubspot", "incentives", "checker", "template"].forEach(p => $("p-" + p).hidden = p !== page);
  window.scrollTo(0, 0);
}
document.querySelectorAll("#nav button").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));

function render() {
  const open = S.uploads.filter(r => r.status !== "Loaded").length;
  const hs = S.uploads.filter(r => r.source === "hubspot" && r.hubspot_in_stage !== false && r.status !== "Loaded").length;
  $("n-open").textContent = open || ""; $("n-hs").textContent = hs || "";
  renderUploads(); renderHubspot(); try { renderIncentives(); } catch (e) { console.error("Incentives:", e); }
  $("dealers").replaceChildren(...[...new Set(S.uploads.map(r => r.dealer).filter(Boolean))].sort().map(d => el("option", { value: d })));
}

/* =========================================================
   UPLOADS PAGE
   ========================================================= */
TYPE_NAMES.forEach(n => { $("ft").append(el("option", { value: n, text: n })); $("f-type").append(el("option", { value: n, text: n })); $("c-type").append(el("option", { value: n, text: n })); });
STATUSES.forEach(([v, l]) => $("f-status").append(el("option", { value: v, text: l })));
$("fp").value = S.period;

function kpi(cls, k, v, s, onclick, unit) {
  return el(onclick ? "button" : "div", { class: "kpi " + cls, onclick, title: onclick ? "Show these files" : null },
    [el("div", { class: "k", text: k }), el("div", { class: "v" }, [fmt(v), unit ? el("small", { text: unit }) : null]), el("div", { class: "s", text: s })]);
}
function setStatus(st) { S.upFilter = null; S.status = st; store.set("du-status", st); renderUploads(); $("rows").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" }); }

function renderUploads() {
  const R = S.uploads, t = today(), month = t.slice(0, 7);
  const exp = R.filter(r => r.status === "Expected"), late = exp.filter(isLate), iss = R.filter(r => r.status === "Issues"), rdy = R.filter(r => r.status === "Ready"), hold = R.filter(r => r.status === "OnHold");
  const upM = R.filter(r => r.status === "Loaded" && (r.uploaded_on || "").slice(0, 7) === month);
  const turns = R.filter(r => r.uploaded_on && r.uploaded_on >= addDays(t, -30)).map(turn).filter(x => x != null && x >= 0);
  const avg = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length * 10) / 10 : null;
  $("kpis").replaceChildren(
    kpi("", "Open files", R.filter(r => r.status !== "Loaded").length, "Not uploaded yet", () => setStatus("open")),
    kpi(iss.length ? "bad" : "", "Sent back", iss.length, fmt(iss.reduce((a, r) => a + (+r.issue_count || 0), 0)) + " rows to fix", () => setStatus("Issues")),
    kpi(rdy.length ? "warn" : "", "Ready to upload", rdy.length, "Checked and clean", () => setStatus("Ready")),
    kpi(hold.length ? "hold" : "", "On hold", hold.length, "Paused for now", () => setStatus("OnHold")),
    kpi("good", "Uploaded this month", upM.length, fmt(upM.reduce((a, r) => a + (+r.row_count || 0), 0)) + " customer rows", () => setStatus("Loaded")),
    kpi("", "Avg turnaround", avg == null ? "–" : avg, "Came in → uploaded, last 30 days", null, avg == null ? "" : avg === 1 ? "day" : "days"));
  try { renderDaily(); } catch (e) { console.error("Daily chart:", e); }
  try { renderByType(); } catch (e) { console.error("List type chart:", e); }

  // status segments
  const counts = { open: R.filter(r => r.status !== "Loaded").length, all: R.length }; STATUSES.forEach(([s]) => counts[s] = R.filter(r => r.status === s).length);
  $("seg").replaceChildren(...[["open", "Open"], ...STATUSES, ["all", "All"]].map(([v, l]) => el("button", { class: S.status === v ? "on" : "", role: "tab", "aria-selected": S.status === v ? "true" : "false", onclick: () => { S.status = v; store.set("du-status", v); renderUploads(); } }, [l, el("i", { text: counts[v] })])));

  // table
  const q = S.q.toLowerCase(), lim = { month: t.slice(0, 7) + "-01", 30: addDays(t, -30), 90: addDays(t, -90) }[S.period];
  let list = R.filter(r => (S.status === "all" || (S.status === "open" ? r.status !== "Loaded" : r.status === S.status))
    && (!S.type || r.list_type === S.type) && (!lim || refDate(r) >= lim || r.status !== "Loaded")
    && (!q || [r.dealer, r.file_name, r.notes, r.hubspot_ticket_name, r.hubspot_ticket_id].join(" ").toLowerCase().includes(q))
    && (!S.upFilter || (r.uploaded_on && r.uploaded_on >= S.upFilter.from && r.uploaded_on <= S.upFilter.to)));
  const uf = $("upchip"); uf.hidden = !S.upFilter;
  if (S.upFilter) uf.replaceChildren("Uploaded " + (S.upFilter.from === S.upFilter.to ? fmtDate(S.upFilter.from) : fmtDate(S.upFilter.from) + " – " + fmtDate(S.upFilter.to)) + " ", el("button", { type: "button", "aria-label": "Clear date filter", text: "×", onclick: () => { S.upFilter = null; renderUploads(); } }));
  const { key, dir } = S.sort, order = Object.fromEntries(STATUSES.map(([s], i) => [s, i]));
  const val = r => key === "turn" ? turn(r) : key === "status" ? order[r.status] : key === "received_on" ? refDate(r) : r[key];
  list.sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * (dir === "asc" ? 1 : -1); });
  document.querySelectorAll("#p-uploads th[data-sort]").forEach(th => { th.classList.toggle("sorted", th.dataset.sort === key); th.classList.toggle("asc", th.dataset.sort === key && dir === "asc"); });

  $("rows").replaceChildren(...list.map(r => {
    const st = el("select", { class: "st st-" + r.status, "aria-label": "Status for " + r.dealer, onclick: e => e.stopPropagation() }, STATUSES.map(([v, l]) => { const o = el("option", { value: v, text: l }); o.selected = v === r.status; return o; }));
    st.addEventListener("change", () => quickStatus(r, st.value));
    const up = el("input", { type: "date", class: "inline", value: r.uploaded_on || "", "aria-label": "Uploaded date for " + r.dealer, onclick: e => e.stopPropagation() });
    up.addEventListener("change", () => quickUploaded(r, up.value));
    const tn = turn(r);
    return el("tr", { class: "click", onclick: () => openDrawer(r) }, [
      el("td", { class: "dealer" }, [el("b", {}, [r.dealer, r.source === "hubspot" ? (ticketHref(r) ? el("a", { class: "src", href: ticketHref(r), target: "_blank", rel: "noopener", title: "Open ticket in HubSpot", text: "HubSpot ↗", onclick: e => e.stopPropagation() }) : el("span", { class: "src", text: "HubSpot" })) : null]), r.file_name ? el("small", { text: r.file_name }) : null, r.list_url ? el("a", { class: "listlink", href: r.list_url, target: "_blank", rel: "noopener", text: "Open list ↗", onclick: e => e.stopPropagation() }) : null, ticketHref(r) ? ticketLink(r, "View ticket #" + r.hubspot_ticket_id + " ↗", "listlink tixlink") : null, r.source === "hubspot" && r.hubspot_stage ? el("small", { class: "hsstage" + (r.hubspot_in_stage === false && r.status !== "Loaded" ? " warn" : ""), text: "HubSpot stage: " + r.hubspot_stage }) : null]),
      el("td", {}, r.list_type || el("span", { class: "late", text: "Set list type" })),
      el("td", {}, st),
      el("td", {}, r.received_on ? fmtDate(r.received_on) : (r.due_on ? el("span", {}, [el("span", { class: "faint", text: "due " + fmtDate(r.due_on) + " " }), isLate(r) ? el("span", { class: "late", text: "Late" }) : null]) : el("span", { class: "faint", text: "–" }))),
      el("td", {}, up),
      el("td", { class: "num" }, tn == null || tn < 0 ? el("span", { class: "faint", text: "–" }) : (tn === 0 ? "Same day" : tn + (tn === 1 ? " day" : " days"))),
      el("td", { class: "num", text: fmt(r.row_count) }),
      el("td", { class: "num", text: fmt(r.issue_count), style: +r.issue_count ? "color:var(--red);font-weight:700" : null }),
      el("td", {}, who(r.owner_id))]);
  }));
  const E = $("empty"); E.hidden = list.length > 0;
  if (!list.length) E.replaceChildren(el("b", { text: R.length ? "Nothing matches these filters" : "No uploads yet" }), R.length ? "Try another status or All time." : "Log the first dealer list with “+ Log upload”. HubSpot tickets in Upload Needed appear here automatically once sync is set up.");
}

/* ---------- Daily uploads: pick a date range, see files uploaded per day ---------- */
function rangeOf(p) {
  const t = today(), d = new Date(t + "T12:00:00"), mon = addDays(t, -((d.getDay() + 6) % 7));
  if (p === "today") return [t, t];
  if (p === "week") return [mon, t];
  if (p === "lastweek") return [addDays(mon, -7), addDays(mon, -1)];
  if (p === "7") return [addDays(t, -6), t];
  if (p === "month") return [t.slice(0, 7) + "-01", t];
  if (p === "lastmonth") { const f = new Date(d.getFullYear(), d.getMonth() - 1, 1); return [iso(f), addDays(t.slice(0, 7) + "-01", -1)]; }
  return [addDays(t, -29), t];  // "30"
}
const RANGES = [["today", "Today"], ["week", "This week"], ["lastweek", "Last week"], ["7", "Last 7 days"], ["month", "This month"], ["lastmonth", "Last month"], ["30", "Last 30 days"]];
function setRange(p, from, to) {
  S.range = p === "custom" ? { p, from, to } : { p };
  store.set("du-range", JSON.stringify(S.range)); renderDaily();
}
function curRange() { const r = S.range || { p: "30" }; if (r.p === "custom" && r.from && r.to) return r.from <= r.to ? [r.from, r.to] : [r.to, r.from]; return rangeOf(r.p === "custom" ? "30" : r.p); }
function showUploaded(from, to) { S.upFilter = { from, to }; S.status = "all"; renderUploads(); $("rows").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" }); }

function renderDaily() {
  const [from, to] = curRange(), p = (S.range || {}).p || "30";
  // controls
  const sel = $("dr-preset"); if (!sel.options.length) { RANGES.concat([["custom", "Custom dates"]]).forEach(([v, l]) => sel.append(el("option", { value: v, text: l }))); }
  sel.value = p; $("dr-from").value = from; $("dr-to").value = to;
  // data
  const nDays = days(from, to) + 1, weekly = nDays > 62;
  const inR = S.uploads.filter(r => r.uploaded_on && r.uploaded_on >= from && r.uploaded_on <= to);
  const buckets = [];
  if (weekly) { const d0 = new Date(from + "T12:00:00"); let w = addDays(from, -((d0.getDay() + 6) % 7)); while (w <= to) { buckets.push([w, addDays(w, 6)]); w = addDays(w, 7); } }
  else for (let i = 0; i < nDays; i++) { const x = addDays(from, i); buckets.push([x, x]); }
  const data = buckets.map(([a, b]) => { const rs = inR.filter(r => r.uploaded_on >= a && r.uploaded_on <= b); return { a, b, n: rs.length, rows: rs.reduce((s, r) => s + (+r.row_count || 0), 0) }; });
  const rows = inR.reduce((s, r) => s + (+r.row_count || 0), 0);
  const workdays = buckets.length && !weekly ? data.filter(x => { const g = new Date(x.a + "T12:00:00").getDay(); return g && g !== 6 && x.a <= today(); }).length : 0;
  const best = data.reduce((m, x) => x.n > (m ? m.n : 0) ? x : m, null);
  $("dr-title").textContent = weekly ? "Uploads per week" : "Daily uploads";
  $("dr-stats").replaceChildren(
    stat(fmt(inR.length), inR.length === 1 ? "file uploaded" : "files uploaded"),
    stat(fmt(rows), "customer rows"),
    weekly ? null : stat(workdays ? (Math.round(inR.length / workdays * 10) / 10).toString() : "–", "avg per workday"),
    stat(best ? (weekly ? "Wk of " + fmtDate(best.a) : fmtDate(best.a)) : "–", best ? `busiest (${best.n})` : "busiest day"),
    inR.length ? el("button", { class: "btn ghost sm", text: "List these uploads ↓", onclick: () => showUploaded(from, to) }) : null);
  // chart
  const W = 760, H = 200, L = 6, B = 26, T = 20, mx = Math.max(1, ...data.map(x => x.n)), bw = (W - 2 * L) / data.length, t = today();
  const every = Math.ceil(data.length / 12);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Files uploaded ${weekly ? "per week" : "per day"}, ${fmtDate(from)} to ${fmtDate(to)}">`;
  for (let g = 1; g <= 3; g++) { const y = H - B - (H - B - T) * g / 3; s += `<line x1="${L}" x2="${W - L}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 4"/>`; }
  s += `<line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>`;
  data.forEach((x, i) => {
    const h = (H - B - T) * x.n / mx, w = Math.min(bw * .7, 46), bx = L + i * bw + (bw - w) / 2, now = t >= x.a && t <= x.b;
    const g = new Date(x.a + "T12:00:00").getDay(), wkend = !weekly && (g === 0 || g === 6);
    s += `<g class="bar" data-a="${x.a}" data-b="${x.b}" style="cursor:${x.n ? "pointer" : "default"}"><rect x="${L + i * bw}" y="${T - 4}" width="${bw}" height="${H - B - T + 4}" fill="transparent"/>`;
    s += `<rect x="${bx}" y="${H - B - h}" width="${w}" height="${Math.max(h, x.n ? 2 : 0)}" rx="3" fill="${now ? "var(--green)" : "var(--blue)"}" opacity="${now ? 1 : .85}"/>`;
    s += `<title>${weekly ? "Week of " + fmtDate(x.a) : new Date(x.a + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}: ${x.n} file${x.n === 1 ? "" : "s"} · ${x.rows.toLocaleString()} rows${x.n ? " — click to list them" : ""}</title></g>`;
    if (x.n && data.length <= 45) s += `<text x="${bx + w / 2}" y="${H - B - h - 5}" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)" pointer-events="none">${x.n}</text>`;
    if (i % every === 0 || data.length <= 14) s += `<text x="${bx + w / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${wkend ? "var(--faint)" : "var(--muted)"}">${now && !weekly ? "Today" : fmtDate(x.a)}</text>`;
  });
  const box = $("daily"); box.className = "bars"; box.innerHTML = s + "</svg>";
  box.querySelectorAll("g.bar").forEach(gEl => gEl.addEventListener("click", () => { const a = gEl.dataset.a, b = gEl.dataset.b; if (inR.some(r => r.uploaded_on >= a && r.uploaded_on <= b)) showUploaded(a, b); }));
  $("dr-empty").hidden = inR.length > 0;
}
const stat = (v, k) => el("div", { class: "dstat" }, [el("b", { text: v }), el("span", { text: k })]);
$("dr-preset").addEventListener("change", e => { if (e.target.value === "custom") { const [f, t] = curRange(); setRange("custom", f, t); $("dr-from").focus(); } else setRange(e.target.value); });
["dr-from", "dr-to"].forEach(id => $(id).addEventListener("change", () => { if ($("dr-from").value && $("dr-to").value) setRange("custom", $("dr-from").value, $("dr-to").value); }));

function renderByType() {
  const open = S.uploads.filter(r => r.status !== "Loaded");
  const rows = [...new Set([...TYPE_NAMES, ...open.map(r => r.list_type).filter(Boolean)]), null].map(t => [t || "No list type yet", open.filter(r => (r.list_type || null) === t).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const mx = Math.max(1, ...rows.map(x => x[1]));
  $("bytype").replaceChildren(rows.length ? el("div", { class: "rowbars" }, rows.map(([n, c]) => el("div", { class: "rb" }, [el("span", { text: n }), el("div", { class: "tr" }, el("div", { style: `width:${c / mx * 100}%` })), el("b", { text: c })]))) : el("div", { class: "empty", text: "No open files." }));
}

async function quickStatus(r, status) {
  const patch = { status };
  if (status !== "Expected" && !r.received_on) patch.received_on = today();
  if (status === "Loaded" && !r.uploaded_on) patch.uploaded_on = today();
  try { await api.update(r.id, patch); toast(`${r.dealer} → ${stLabel(status)}`); render(); } catch (e) { toast("Couldn't save: " + e.message); render(); }
}
async function quickUploaded(r, date) {
  const patch = { uploaded_on: date || null };
  if (date && r.status !== "Loaded") patch.status = "Loaded";
  if (date && !r.received_on) patch.received_on = date;
  try { await api.update(r.id, patch); toast(date ? `${r.dealer} uploaded ${fmtDate(date)}` : "Uploaded date cleared"); render(); } catch (e) { toast("Couldn't save: " + e.message); render(); }
}
$("q").addEventListener("input", e => { S.q = e.target.value; renderUploads(); });
$("ft").addEventListener("change", e => { S.type = e.target.value; renderUploads(); });
$("fp").addEventListener("change", e => { S.period = e.target.value; store.set("du-period", S.period); renderUploads(); });
document.querySelectorAll("#p-uploads th[data-sort]").forEach(th => th.addEventListener("click", () => { const k = th.dataset.sort; S.sort = { key: k, dir: S.sort.key === k && S.sort.dir === "desc" ? "asc" : "desc" }; renderUploads(); }));
$("add").addEventListener("click", () => openDrawer(null));
$("export").addEventListener("click", () => {
  const cols = [["dealer", "Dealer"], ["list_type", "List type"], ["status", "Status"], ["received_on", "Came in"], ["uploaded_on", "Uploaded"], ["due_on", "Expected by"], ["row_count", "Rows"], ["issue_count", "Rows with issues"], ["file_name", "File name"], ["owner", "Owner"], ["source", "Source"], ["hubspot_ticket_id", "HubSpot ticket"], ["notes", "Notes"]];
  const lines = [cols.map(c => c[1]).join(",")].concat(S.uploads.map(r => cols.map(([k]) => csvCell(k === "owner" ? name(r.owner_id) : k === "status" ? stLabel(r.status) : r[k])).join(",")));
  const a = el("a", { href: URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" })), download: `upload-tracker-${today()}.csv` });
  document.body.append(a); a.click(); a.remove(); toast("Exported " + S.uploads.length + " uploads");
});

/* =========================================================
   DRAWER (add / edit + activity)
   ========================================================= */
async function openDrawer(r, prefill) {
  S.editing = r || null;
  const d = r || { status: "Received", received_on: today(), owner_id: S.me && S.me.id, ...prefill };
  $("d-title").textContent = r ? r.dealer : "Log upload";
  $("f-dealer").value = d.dealer || ""; $("f-type").value = d.list_type || ""; $("f-status").value = d.status || "Received";
  $("f-received").value = d.received_on || ""; $("f-uploaded").value = d.uploaded_on || ""; $("f-due").value = d.due_on || "";
  $("f-owner").value = d.owner_id && S.profiles[d.owner_id] ? d.owner_id : ""; $("f-rows").value = d.row_count ?? ""; $("f-issues").value = d.issue_count ?? "";
  $("f-file").value = d.file_name || ""; $("f-notes").value = d.notes || ""; $("f-link").value = d.list_url || "";
  const ft = $("f-ticket"); ft.value = d.hubspot_ticket_id ? (ticketHref(d) || d.hubspot_ticket_id) : ""; ft.disabled = !!(r && r.source === "hubspot"); ft.title = ft.disabled ? "Set by the HubSpot sync" : "";
  const del = $("d-del"); del.hidden = !r; del.classList.remove("armed"); del.textContent = "Delete";
  const hs = $("d-hs"); hs.hidden = !(r && r.hubspot_ticket_id);
  if (r && r.hubspot_ticket_id) {
    const link = ticketLink(r, r.hubspot_ticket_name || "#" + r.hubspot_ticket_id);
    hs.replaceChildren(el("b", { text: "HubSpot ticket: " }), link, el("br"), el("span", { class: "muted", text: `${r.hubspot_in_stage === false ? "Moved out of Upload Needed" : "In Upload Needed"} · opened ${fmtDate(r.hubspot_created_at)}${r.hubspot_owner ? " · " + r.hubspot_owner : ""}` }));
  }
  const inc = $("d-inc"), ir = incFor(d.dealer); inc.hidden = !ir;
  if (ir) inc.replaceChildren(el("summary", {}, ["Incentives for " + ir.dealer, incFlag(ir) ? el("span", { class: "tag " + incFlag(ir)[0], text: incFlag(ir)[1] }) : null]), incBody(ir));
  $("d-activity").replaceChildren();
  $("scrim").hidden = false; $("drawer").hidden = false; setTimeout(() => $("f-dealer").focus(), 30);
  if (r) {
    const evs = await api.events(r.id);
    if (S.editing !== r) return;
    const line = e => {
      const actor = e.actor_id ? name(e.actor_id) || "Someone" : "HubSpot sync";
      const what = e.action === "status" ? `changed status from ${stLabel(e.detail.from)} to ${stLabel(e.detail.to)}`
        : e.action === "uploaded" ? (e.detail.to ? `set uploaded date to ${fmtDate(e.detail.to)}` : "cleared the uploaded date")
        : e.action === "hubspot" ? "added this from HubSpot" : e.action === "created" ? "logged this upload" : "edited details";
      return el("li", {}, el("div", {}, [el("b", { text: actor }), " " + what, el("small", { text: new Date(e.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) })]));
    };
    $("d-activity").replaceChildren(el("div", { class: "ctitle", style: "margin:8px 0 0", text: "Activity" }), evs.length ? el("ul", { class: "timeline" }, evs.map(line)) : el("p", { class: "faint", text: "No activity recorded yet." }));
  }
}
function closeDrawer() { $("scrim").hidden = true; $("drawer").hidden = true; S.editing = null; }
$("d-close").addEventListener("click", closeDrawer); $("d-cancel").addEventListener("click", closeDrawer); $("scrim").addEventListener("click", closeDrawer);
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("drawer").hidden) closeDrawer(); });
$("dform").addEventListener("submit", async e => {
  e.preventDefault();
  const num = v => v === "" ? null : Math.max(0, parseInt(v, 10) || 0), status = $("f-status").value;
  const body = { dealer: $("f-dealer").value.trim(), list_type: $("f-type").value || null, status, received_on: $("f-received").value || null,
    uploaded_on: $("f-uploaded").value || (status === "Loaded" ? today() : null), due_on: $("f-due").value || null, owner_id: $("f-owner").value || null,
    row_count: num($("f-rows").value), issue_count: num($("f-issues").value), file_name: $("f-file").value.trim() || null, notes: $("f-notes").value.trim() || null, list_url: $("f-link").value.trim() || null };
  if (!body.dealer) return $("f-dealer").focus();
  if (body.list_url && !body.received_on) { body.received_on = today(); if (body.status === "Expected") body.status = "Received"; }
  if (!$("f-ticket").disabled) { const t = parseTicket($("f-ticket").value);
    if (t.bad) { toast("HubSpot ticket should be a ticket link or a ticket number."); return $("f-ticket").focus(); }
    if (t.portal && !C.HUBSPOT_PORTAL_ID) store.set("du-portal", t.portal);
    body.hubspot_ticket_id = t.id; }
  const btn = $("d-save"); btn.disabled = true;
  try {
    if (S.editing) { await api.update(S.editing.id, body); toast("Saved"); }
    else { if (openDrawer.source) body.source = openDrawer.source; await api.insert(body); toast("Upload logged"); }
    openDrawer.source = null; closeDrawer(); render();
  } catch (err) { toast("Couldn't save: " + err.message); }
  finally { btn.disabled = false; }
});
$("d-del").addEventListener("click", async () => {
  const b = $("d-del");
  if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Click again to delete"; setTimeout(() => { b.classList.remove("armed"); b.textContent = "Delete"; }, 4000); return; }
  try { await api.remove(S.editing.id); toast("Deleted"); closeDrawer(); render(); } catch (e) { toast("Couldn't delete: " + e.message); }
});

/* =========================================================
   INCENTIVES — from Supabase (Google Sheet sync) when set up, otherwise from incentives.csv in this site
   ========================================================= */
const nName = s => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
function incFor(dealer) { const n = nName(dealer); return n ? S.incentives.find(r => nName(r.dealer) === n) || S.incentives.find(r => { const m = nName(r.dealer); return m.length > 5 && (n.includes(m) || m.includes(n)); }) : null; }
const NONE_RE = /^(no offer|none|n\/a|-|–|—)$/i;
const hasOffer = v => !!(v && !NONE_RE.test(v.trim()));
const tidy = v => v == null ? null : String(v).replace(/\r/g, "").replace(/ {5,}/g, "\n").replace(/\s+\/\/\s*/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() || null;
function incFlag(r) {
  const all = [r.active, r.at_risk, r.inactive, r.other, r.expiration].join(" ");
  if (/needs? update|do not use/i.test(all)) return ["err", "Needs update"];
  if (![r.active, r.at_risk, r.inactive, r.other].some(hasOffer)) return ["muted", "No offer"];
  return null;
}
/* Built-in copy of the incentive sheet (Oct 15, 2026). An incentives.csv uploaded to the site replaces it. */
const INCENTIVES_BUILTIN = [["Acura of Little Rock", "", "", "", "$100 Off Timing Belt & Tensioner Installation\nFree Vacuum & Wash\nSpend & Save\nSpend $100 - Save $10\nSpend $200 - Save $20\nSpend $300 - Save $30\nSpend $400 - Save $40\n\n20% off up to $150 in savings - Main Shop \n\n$10 off LOF\n\n$15 off an alignment", ""], ["Boulevard Cadillac", "Free Car Wash and Health Insp", "$20 off Service", "$50 off Service", "🍂 $20 Off Premium Oil & Filter Change\nIncludes up to 5 quarts of factory-recommended oil, a new OEM filter, and fluid top-offs.\n\n🔋 Complimentary Fall Inspection & Battery Health Test\nIncluded with any paid service. Summer heat can take a toll on your battery. We'll test your battery's cold-cranking amps and inspect key safety components at no additional charge.\n\n🛑 $15 Off Brake System Service\nHelp ensure maximum stopping power with a comprehensive inspection of your brake pads, rotors, and brake fluid.\n\n🌧️ Complete Wiper Replacement Special $100 Installed\nfor a Full Set of OEM Wiper Blades (Front & Rear)\n\nNo rear wiper? Enjoy 10% off front OEM wiper blade installation.", ""], ["Grainger Honda", "NO OFFER", "NO OFFER", "NO OFFER", "", ""], ["Honda of Jonesboro", "10% off cap of $125 this excludes Tires and Alignments ", "10% off cap of $125 this excludes Tires and Alignments ", "10% off cap of $125 this excludes Tires and Alignments ", "$10 off Alignment\nSpend & Save\n10$ off Services from $49.99-$99.99\n$15 off Services from $100-$149.99\n$20 Off Services from $150 or More", ""], ["Honda World of Conway", "", "", "", "Complete Oil Change Package $189.95 (Lof, Rotate, Engine and Cabin Filter)\n10% off up to $100\nBuy one get one free wiper inserts\n$25 off Honda Battery\nneeds update", ""], ["JLR Rancho Mirage", "10% off any one service, free health inspection,\n& free car wash.", "15% off any one service (oil change, brakes, etc.)", "25% off any one service OR $150 off an oil change", "20% off any/all deferred services", ""], ["Joe Machen's Toyota", "$24.95 SYN LOF\n // 4-wheel Align $79.99 // Front or Rear Brake Service $349.99 // TrueStart Battery $25 OFF $10 OFF $50-$149.99 // $15 OFF $150-$249.99 // $25 OFF $250-$499.99 $50 OFF $500-$999.99// $100 OFF $1K+ CUSTOMER CAN USE ALL OFFERS", "", "$21.95 SYN LOF\n //All-weather wipers $19.99 // 4-wheel Align $79.99 // Cabin Air Filter $39.99  $10 OFF $50-$149.99 // $15 OFF $150-$249.99 // $25 OFF $250-$499.99 $50 OFF $500-$999.99// $100 OFF $1K+ CUSTOMER CAN USE ALL OFFERS", "Varied Discounts from TLE lists - will be listed on ticket", ""], ["Katy Honda", "NONE", "NONE", "NONE", "", ""], ["Lamborghini Houston", "", "", "", "Expired Services: Comp MPI, 10% off Service & Complimentary Detail\nInactive 12+ Customers: Within 100 miles of dealer comp valet\n + $250 certificate towards any service or repair.\nComplimentary Certified Warranty Check ($1k Value)", ""], ["Land Rover VW of Little Rock", "Military Discount 10% up to $100", "Military Discount 10% up to $100", "Military Discount 10% up to $100", "", ""], ["Lithia Toyota of Odessa", "", "$15.99 wiper blades & $39.99 oil change\n", "$15.99 wipers & $19.99 oil change\n", "10% off all repairs above $250, alignment with tire purchase $140(cars) $150(trucks/suvs), coolant fluid exchange $249.99, oil change special $59.99 - these all expire end of month", ""], ["Lombard Toyota", "", "$39.95 Oil Change or\nFree Wipers or Free Pit Stop", "Inactive customers we want to offer a $49.95 oil change up to 5 quarts\n not including 0W8 engine oil ( slightly higher)", "", ""], ["Marburger Chevrolet", "Free Health Insp", "$20 off any Service", "$50 off any Service", "$59.99 oil change for Saturdays; if customer asks they can use it another day - $20 off LOF Diesel - ", ""], ["Mark McLarty Toyota", "$49.95 Oil Change 6 Months", "$49.95 Oil Change 7-8 Months\n$39.95 Oil Change 9-12 ", "$19.95 Oil Change - 12+ Months", "", ""], ["Matt Blatt Mitsubishi", "6 Month Free Vehicle Health Inpection", "9 Month - 20% off Overall - Cap $100", "12 Month - 20% off Overall - Cap $100\n18 - 24 $50 Oil Change\n24+ Months - $30 Oil Change", "9 Month: 20% off entire service - cap @ $100\n12 months: 20% off entire service - cap @ $100\n18 Month $50 Oil Change\n24-month $30 Oil Change\nTires: Buy 3 get 1 free; no limitation on brand", ""], ["McDonough Hyundai", "", "9 Month Offers 20% off service", "12-15 Months LOF $59.95, LOF & Rotate $79.95      \nEV: Free Charge of vehicle and Free Tire Rotation if they come in for an additional service", "10% off DS\n", ""], ["McLarty Nissan of Benton", "6-12 months: $15 off oil change\n\n\n", "12-18 months: $20 off oil change\n\n\n", "18+ months: $59.95 oil change offer\n\nor $79.95 — LOF & Tire Rotation", "June Incentives $59.99 — LOF with MPI\n$79.95 — LOF & Tire Rotation\nTire Rebates: $100 Rebate on 4‑tire purchase\nValid through June 30. \nRebate submissions due no later than July 7\nEligible brands: Bridgestone and Kumho Tires", ""], ["Mercedes-Benz of Little Rock", "", "", "", "Connected Car Leads and Unserviced VINS\nService A $50 off // Service B $75 off\n20% off Service for up to $200 off\n\nRetention Campaigns\nSpend and Save Deals\n$200 – $300 - Save $50\n$300 – $500 - Save $75\n$500 – $700 - Save $100\n$700 – $1,000 - Save $150\nOver $1,000 - Save $200", ""], ["New Smyrna CDJR", "Free Car Wash and Health Insp\n$75 off for Diesel LOF", "$20 off Service \n$75 off for Diesel LOF", "$50 off Service \n$75 off for Diesel LOF", "$50 off of $250 or more\n", ""], ["Nyle Maxwell CDJR", "10% off Declined Services up to $50 or financing", "10% off Declined Services up to $50 or financing", "10% off Declined Services up to $50 or financing", "10% off DS - up to $50 -\nof Financing                                                                                                                                                                             Oil Change Packages Package 1. 6QT oil plus labor $255.47 (2 oil changes within 18 months) Package 2. 8QT oil and Lobor $303.10 (2 oil changes within 18 months) Package 3. Diesel oil chane $625.77 and labor ( 2 oil changes within 18 months) ALL 3 PACKAGES COME WITH OIL AND FILTER CHANGE, TIRE ROTATION, AND A MULTIPOINT INSPECTION", ""], ["Ralph Hayes Toyota", "6-9 months - If No Comp Maintenance\n and customer declines\nfree oil change can be offered", "9-12 Months\nFree oil change. free filter, or free wipers, (BDC COMP SERVICE)", "Complomentary Maintenance Packages \n\n- 3 Oil Changes (valid for 2 years)\n\n- Lifetime Tire Rotations (for the life of your vehicle)\n\n- 2 Years of Unlimited Alignments", "", ""], ["South Charlotte Hyundai", "", "9 Month: 10% off Service", "12 Month: 15% off Service\n15 Month: 20% off Service\n18 Month: 15% off\n24 Month: 15% off", "Happy Hour Special Mon-Friday 1 PM - 4 PM $30 off Oil Change or $30 off Any Flush Service                          $25 OFF 4 Wheel Alignment                                                                                                                                            Seasonal Service Special $50 off Oil Change & Filter Replacement, Tire Rotation, Balance, Aligment, Brake Inspection and MPI\n\nneeds update, do not use", ""], ["Toyota of Newport", "Service Bundle - $15 OFF service bundle including Oil Change, Tire Rotation, and Front Wiper Blade Replacement.        \n$25 off Brake Service Per AXLE                                                   \n$10 off Single Oil Change", "$50 off LOF; EV $20 off", "$70 off LOF; EV $20 off", "", ""], ["Toyota of Poway", "$34.95 Conv LOF // $64.96 Syn LOF\n0w-8 LOF $149.95", "$34.95 Conv LOF // $64.96 Syn LOF\n0w-8 LOF $149.95", "$34.95 Conv LOF // $64.96 Syn LOF\n0w-8 LOF $149.95", "", ""], ["Village Ford", "", "", "", "Village Ford Service Offers - needs update, do not use", ""], ["Volvo Cars Ontario", "", "", "", "", ""], ["Yokem Toyota", "Buy 3, get 1 tire for $1 \nTues $20 of LOF\n$25 off brake fluid exchange", "Buy 3 get 1 tire for $1 \nTues $20 of LOF\nUp to $100 off $1000", "$19.95 Conventional / 29.95 Syn", "", ""]];
function useBuiltinIncentives() {
  S.incentives = INCENTIVES_BUILTIN.map(r => ({ dealer: tidy(r[0]), active: tidy(r[1]), at_risk: tidy(r[2]), inactive: tidy(r[3]), other: tidy(r[4]), expiration: tidy(r[5]) }))
    .filter(r => r.dealer).sort((a, b) => a.dealer.localeCompare(b.dealer));
  S.incSource = "file"; S.incFileDate = new Date("2026-10-15T12:00:00");
}
async function loadIncentiveFile() {
  try {
    const res = await fetch("incentives.csv?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return useBuiltinIncentives();
    const rows = parseCSV(await res.text()), hi = rows.findIndex(r => r.some(c => nName(c) === "dealer"));
    if (hi < 0) return useBuiltinIncentives();
    const H = rows[hi].map(nName), ix = t => H.findIndex(t);
    const C = { dealer: ix(h => h === "dealer"), active: ix(h => h.startsWith("active")), at_risk: ix(h => h.startsWith("atrisk")), inactive: ix(h => h.startsWith("inactive")), other: ix(h => h.startsWith("other")), expiration: ix(h => h.startsWith("expir")) };
    const get = (r, i) => i < 0 ? null : tidy(r[i]);
    S.incentives = rows.slice(hi + 1).map(r => ({ dealer: get(r, C.dealer), active: get(r, C.active), at_risk: get(r, C.at_risk), inactive: get(r, C.inactive), other: get(r, C.other), expiration: get(r, C.expiration) }))
      .filter(r => r.dealer).sort((a, b) => a.dealer.localeCompare(b.dealer));
    S.incSource = "file"; const lm = res.headers.get("last-modified"); S.incFileDate = lm ? new Date(lm) : null;
    if (!S.incentives.length) useBuiltinIncentives();
  } catch (e) { useBuiltinIncentives(); }
}
const TIERS = [["active", "Active", "0–6 months", "t-active"], ["at_risk", "At-risk", "7–12 months", "t-risk"], ["inactive", "Inactive", "12+ months", "t-inactive"]];
async function copyText(t, what) { try { await navigator.clipboard.writeText(t); toast(what + " copied"); } catch (e) { toast("Couldn't copy. Select the text instead."); } }
function offerBlock(r, k, label, sub, cls) {
  const v = r[k], ok = hasOffer(v), long = ok && (v.length > 260 || v.split("\n").length > 7);
  const p = el("p", { class: long ? "clamp" : "", text: ok ? v : (v ? v.toUpperCase() === v ? "No offer" : v : "No offer") });
  return el("div", { class: "tier " + cls + (ok ? "" : " none") }, [
    el("div", { class: "tier-h" }, [el("b", { text: label }), sub ? el("small", { text: sub }) : null,
      ok ? el("button", { type: "button", class: "copy", title: "Copy this offer", "aria-label": "Copy " + label + " offer for " + r.dealer, text: "Copy", onclick: e => { e.stopPropagation(); copyText(v, label + " offer"); } }) : null]),
    p, long ? el("button", { type: "button", class: "more", text: "Show more", onclick: e => { const on = p.classList.toggle("clamp"); e.target.textContent = on ? "Show more" : "Show less"; } }) : null]);
}
function incBody(r) {
  return el("div", { class: "incbody" }, [
    el("div", { class: "tiers" }, TIERS.map(([k, l, s, c]) => offerBlock(r, k, l, s, c))),
    hasOffer(r.other) || r.other ? offerBlock(r, "other", "Other incentives", "", "t-other") : null,
    r.expiration ? el("div", { class: "incexp" }, [el("b", { text: "Expires " }), r.expiration]) : null]);
}
function renderIncentives() {
  const R = S.incentives, q = S.incQ.toLowerCase(), fileMode = S.incSource === "file";
  const flagged = R.filter(r => incFlag(r) && incFlag(r)[0] === "err"), none = R.filter(r => incFlag(r) && incFlag(r)[0] === "muted");
  $("inc-kpis").replaceChildren(
    kpi("", "Dealers", R.length, fileMode ? "In the incentive sheet" : "From the Google Sheet", () => { S.incFilter = "all"; renderIncentives(); }),
    kpi("good", "With offers", R.length - flagged.length - none.length, "Ready for agents to use", () => { S.incFilter = "ok"; renderIncentives(); }),
    kpi(flagged.length ? "bad" : "", "Needs update", flagged.length, "Marked “needs update” or “do not use”", () => { S.incFilter = "flag"; renderIncentives(); }),
    kpi("", "No offer", none.length, "Nothing to offer right now", () => { S.incFilter = "none"; renderIncentives(); }));
  const segs = [["all", "All", R.length], ["ok", "With offers", R.length - flagged.length - none.length], ["flag", "Needs update", flagged.length], ["none", "No offer", none.length]];
  if (!fileMode) segs.push(["nohs", "Not in HubSpot", R.filter(r => !r.hubspot_company_id).length]);
  $("inc-seg").replaceChildren(...segs.map(([v, l, n]) => el("button", { class: S.incFilter === v ? "on" : "", role: "tab", "aria-selected": S.incFilter === v ? "true" : "false", onclick: () => { S.incFilter = v; renderIncentives(); } }, [l, el("i", { text: n })])));
  const match = r => { const f = incFlag(r); return S.incFilter === "all" || (S.incFilter === "ok" && !f) || (S.incFilter === "flag" && f && f[0] === "err") || (S.incFilter === "none" && f && f[0] === "muted") || (S.incFilter === "nohs" && !r.hubspot_company_id); };
  const list = R.filter(r => match(r) && (!q || [r.dealer, r.active, r.at_risk, r.inactive, r.other].join(" ").toLowerCase().includes(q)));
  $("inc-list").replaceChildren(...list.map(r => {
    const f = incFlag(r), open = S.uploads.filter(u => u.status !== "Loaded" && nName(u.dealer) === nName(r.dealer)).length;
    return el("article", { class: "inccard" + (f ? " is-" + f[0] : "") }, [
      el("header", {}, [
        el("div", { class: "inc-mono", text: r.dealer.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase(), "aria-hidden": "true" }),
        el("h3", { text: r.dealer }),
        f ? el("span", { class: "tag " + f[0], text: f[1] }) : null,
        !fileMode && r.hubspot_company_id && C.HUBSPOT_PORTAL_ID ? el("a", { class: "tag hs", href: `https://${C.HUBSPOT_HOST || "app.hubspot.com"}/contacts/${C.HUBSPOT_PORTAL_ID}/record/0-2/${r.hubspot_company_id}`, target: "_blank", rel: "noopener", text: "HubSpot ↗" }) : null,
        open ? el("button", { class: "tag ok", text: open + " open upload" + (open === 1 ? "" : "s"), onclick: () => { go("uploads"); S.q = r.dealer; $("q").value = r.dealer; setStatus("open"); } }) : null]),
      incBody(r)]);
  }));
  const E = $("inc-empty"); E.hidden = list.length > 0;
  if (!list.length) E.replaceChildren(el("b", { text: R.length ? "No dealers match" : "No incentives yet" }), R.length ? "Try another filter or search." : "Add incentives.csv to the site to show the incentive sheet here.");
  const s = S.sync;
  $("inc-info").textContent = fileMode ? (S.incFileDate ? "Sheet updated " + S.incFileDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "") : (R.length ? `Synced ${s ? ago(s.finished_at || s.started_at) : "–"}` : "");
  $("inc-refresh").hidden = fileMode;
  $("inc-sub").textContent = fileMode ? "Offers agents can use for each dealer, by how long since the customer's last visit. To update, download the Google Sheet as CSV and upload it to GitHub as incentives.csv." : "From the CX Pro incentive Google Sheet. Edit the sheet; changes show here and in HubSpot within 15 minutes.";
}
$("inc-q").addEventListener("input", e => { S.incQ = e.target.value; renderIncentives(); });
$("inc-refresh").addEventListener("click", async () => {
  const b = $("inc-refresh"); b.disabled = true; b.textContent = "Refreshing…";
  try { const r = await api.sync(); if (r && r.ok === false) throw new Error(r.error); const i = r && r.incentives;
    toast(i ? `Incentives updated: ${i.dealers} dealers, ${i.changed} changed, ${i.pushed} sent to HubSpot` : "Synced."); if (LIVE) await api.load(); render(); }
  catch (e) { toast("Refresh failed: " + (e.message || e)); }
  finally { b.disabled = false; b.textContent = "Refresh now"; }
});

/* =========================================================
   HUBSPOT PAGE
   ========================================================= */
function renderHubspot() {
  const H = S.uploads.filter(r => r.source === "hubspot");
  const list = H.filter(r => r.hubspot_in_stage !== false).sort((a, b) => (a.hubspot_created_at || "") < (b.hubspot_created_at || "") ? -1 : 1);
  const t = today(), age = r => r.hubspot_created_at ? days(r.hubspot_created_at.slice(0, 10), t) : null;
  const ages = list.map(age).filter(x => x != null), oldest = ages.length ? Math.max(...ages) : null;
  const notIn = list.filter(r => r.status === "Expected");
  $("hs-kpis").replaceChildren(
    kpi("", "In Upload Needed", list.length, "Tickets in that HubSpot stage"),
    kpi(notIn.length ? "warn" : "", "List not in yet", notIn.length, "Still Expected in the tracker", notIn.length ? () => { go("uploads"); setStatus("Expected"); } : null),
    kpi("", "List received", list.filter(r => r.status === "Received" || r.status === "Ready").length, "Waiting to be uploaded"),
    kpi(list.some(r => r.status === "OnHold") ? "hold" : "", "On hold", list.filter(r => r.status === "OnHold").length, "In Upload Needed, paused here"),
    kpi(oldest > 7 ? "bad" : "", "Oldest ticket", oldest == null ? "–" : oldest, "Since the ticket opened", null, oldest == null ? "" : oldest === 1 ? "day" : "days"),
    kpi("good", "Uploaded from HubSpot", H.filter(r => r.status === "Loaded").length, "All time", () => { go("uploads"); setStatus("Loaded"); }));
  const s = S.sync, info = $("syncinfo");
  info.className = "sync" + (s && s.error ? " err" : "");
  info.textContent = !s ? "Not synced yet" : s.error ? "Last sync note: " + s.error.slice(0, 90) : `Synced ${ago(s.finished_at || s.started_at)} · ${s.found ?? 0} in Upload Needed${s.created ? ", " + s.created + " new" : ""}`;
  const row = r => {
    const a = age(r), tk = ticketLink(r, r.hubspot_ticket_name || "#" + r.hubspot_ticket_id);
    const st = el("select", { class: "st st-" + r.status, "aria-label": "Status for " + r.dealer, onclick: e => e.stopPropagation() }, STATUSES.map(([v, l]) => { const o = el("option", { value: v, text: l }); o.selected = v === r.status; return o; }));
    st.addEventListener("change", () => quickStatus(r, st.value));
    return el("tr", { class: "click", onclick: () => openDrawer(r) }, [
      el("td", { class: "dealer" }, [el("b", {}, tk), el("small", { text: "#" + r.hubspot_ticket_id + (r.hubspot_stage ? " · " + r.hubspot_stage : "") })]), el("td", { text: r.dealer }),
      el("td", {}, a == null ? "–" : el("span", { class: a > 7 && r.hubspot_in_stage !== false ? "late" : "", text: a === 0 ? "Today" : a + (a === 1 ? " day" : " days") })),
      el("td", { text: r.hubspot_owner || "–" }), el("td", {}, r.list_url ? el("a", { class: "listlink", href: r.list_url, target: "_blank", rel: "noopener", text: "Open list ↗", onclick: e => e.stopPropagation() }) : el("span", { class: "faint", text: "No link yet" })), el("td", {}, st),
      el("td", { text: fmtDate(r.received_on) }), el("td", { text: fmtDate(r.uploaded_on) })]);
  };
  $("hs-rows").replaceChildren(...list.map(row));
  const E = $("hs-empty"); E.hidden = list.length > 0;
  if (!list.length) E.replaceChildren(el("b", { text: "No tickets in Upload Needed" }), s ? "Nothing is waiting in HubSpot right now." : "Once the HubSpot sync is set up, tickets show up here.");
}
$("syncnow").addEventListener("click", async () => {
  const b = $("syncnow"); b.disabled = true; b.textContent = "Syncing…";
  try { const r = await api.sync(); if (r && r.ok === false) throw new Error(r.error); toast(`HubSpot synced: ${r.found} in Upload Needed, ${r.created} new${r.closed ? `, ${r.closed} marked Uploaded` : ""}`); if (LIVE) await api.load(); render(); }
  catch (e) { toast("Sync failed: " + (e.message || e)); }
  finally { b.disabled = false; b.textContent = "Sync now"; }
});

/* =========================================================
   FILE CHECKER
   ========================================================= */
function renderResult(R) {
  const box = $("result");
  if (R.fatal) return box.replaceChildren(el("div", { class: "verdict bad" }, el("div", {}, [el("h2", { text: "Can't check this file" }), el("p", { text: R.fatal })])));
  const errN = R.errRows.size, fixN = R.fixRows.size, warnN = R.warnRows.size, dropN = R.drop.size, colBad = R.missingCols.length > 0;
  const cls = colBad || errN ? "bad" : fixN || warnN || R.checks.some(c => c[0] !== "ok") ? "warn" : "good";
  const head = colBad ? "Send back to dealer" : errN ? `${fmt(errN)} of ${fmt(R.total)} rows need fixing` : fixN ? "Ready after cleanup" : "Clean and ready to upload";
  const sub = colBad ? "Required columns are missing, so this list can't be uploaded." : errN ? "These rows have problems only the dealer can fix." : fixN ? `${fmt(fixN)} rows had formatting the checker fixed. Download the cleaned file.` : warnN ? `${fmt(warnN)} rows are worth a quick look, but nothing blocks the upload.` : `All ${fmt(R.total)} rows pass every check.`;
  const extraNote = [dropN ? `${fmt(dropN)} rows with expiration dates before this week were removed from the cleaned file.` : "", TYPE_NOTES[R.type] || ""].filter(Boolean).join(" ");
  const S2 = summarize(R);
  const logBtn = el("button", { class: "btn", text: "Log to tracker", onclick: () => {
    go("uploads"); openDrawer.source = "checker";
    openDrawer(null, { dealer: R.dealer, list_type: R.type, row_count: R.total, issue_count: errN, file_name: R.name, received_on: today(), status: colBad || errN ? "Issues" : "Ready",
      notes: colBad ? "Missing columns: " + R.missingCols.join(", ") : errN ? S2.filter(s => s.kind === "err").slice(0, 3).map(s => `${s.msg} (${s.n})`).join("; ") : "" });
  } });
  const dl = el("button", { class: "btn green", text: "Download cleaned CSV", onclick: () => {
    const csv = [R.out.join(",")].concat(R.clean.map(r => r.map(csvCell).join(","))).join("\r\n") + "\r\n";
    const a = el("a", { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: R.name.replace(/\.csv$/i, "") + "_clean.csv" }); document.body.append(a); a.click(); a.remove();
  } });
  const kids = [
    el("div", { class: "verdict " + cls }, [el("div", {}, [el("h2", { text: head }), el("p", { text: sub }), extraNote ? el("p", { style: "font-size:13px", text: extraNote }) : null, el("p", { class: "faint", style: "font-size:12px", text: `${R.name} · ${R.type} · ${fmt(R.total)} rows` })]), el("div", { class: "actions" }, [dl, logBtn])]),
    el("div", { class: "grid" }, [
      el("div", { class: "card c-5" }, [el("div", { class: "ctitle", text: "File and headers" }), el("ul", { class: "checks" }, R.checks.map(([k, t]) => el("li", { class: k, text: t })))]),
      el("div", { class: "card c-7 flush" }, [el("div", { class: "ctitle pad" }, ["Row issues", el("span", { text: `${fmt(errN)} to fix · ${fmt(warnN)} to review · ${fmt(fixN)} auto-cleaned` })]),
        S2.length ? el("div", { class: "table-wrap" }, el("table", { class: "tbl" }, [el("thead", {}, el("tr", {}, [el("th", { text: "Issue" }), el("th", { class: "num", text: "Rows" }), el("th", { text: "Result" })])),
          el("tbody", {}, S2.map(s => el("tr", {}, [el("td", { text: s.msg }), el("td", { class: "num", text: fmt(s.n) }), el("td", {}, el("span", { class: "tag " + (s.kind === "err" ? "err" : s.kind === "warn" ? "warn" : "fix"), text: s.kind === "err" ? "Dealer must fix" : s.kind === "warn" ? "Review" : "Fixed" }))])))])) : el("div", { class: "empty", text: "No row issues found." })])])];
  const errs = R.issues.filter(i => i.kind === "err");
  if (errs.length) kids.push(el("details", { class: "card flush" }, [el("summary", { text: `Row-by-row list (${fmt(errs.length)} problems${errs.length > 500 ? ", first 500 shown" : ""})` }),
    el("div", { class: "table-wrap" }, el("table", { class: "tbl" }, [el("thead", {}, el("tr", {}, [el("th", { class: "num", text: "Row" }), el("th", { text: "Column" }), el("th", { text: "Problem" })])), el("tbody", {}, errs.slice(0, 500).map(i => el("tr", {}, [el("td", { class: "num", text: i.row }), el("td", {}, el("code", { text: i.col })), el("td", { text: i.msg })])))]))]));
  box.replaceChildren(...kids); box.scrollIntoView({ behavior: "smooth", block: "start" });
}
let lastFile = null;
const runCheck = () => lastFile && renderResult(checkFile(lastFile.name, lastFile.text, $("c-type").value || null));
const readFile = f => { if (!f) return; const r = new FileReader(); r.onload = () => { lastFile = { name: f.name, text: String(r.result) }; runCheck(); }; r.readAsText(f); };
$("file").addEventListener("change", e => { readFile(e.target.files[0]); e.target.value = ""; });
const drop = $("drop");
drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } });
["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => readFile(e.dataTransfer.files[0]));
$("c-type").addEventListener("change", runCheck);
$("sample").addEventListener("click", () => { $("c-type").value = ""; lastFile = { name: "SampleHonda_DeclinedServices_10082026.csv", text:
  "VIN,Name,Phone_Number,dealer_vehicle_year,dealer_vehicle_make,dealer_vehicle_model,coupon,service_type,last_service_date,recall_id\n" +
  "1HGCV1F34MA012345,Maria Lopez,(512) 555-0142,2021,Honda,Accord,$20 off oil change,\"Brake pads, cabin filter\",3/14/2026,\n" +
  "5FNRL6H78NB04567,James Carter,5125550199,2022,Honda,Odyssey,,Tire rotation,2026-02-02,\n" +
  "2HKRW2H85LH612345,Dana Kim,512555017,2020,Honda,CR-V,,,01/09/2026,\n" +
  "1HGCV1F34MA012345,Maria Lopez,5125550142,2021,Honda,Accord,,Wiper blades,03/14/2026,\n" }; runCheck(); });

/* =========================================================
   TEMPLATE PAGE
   ========================================================= */
const hdrFor = t => { const T = TYPES[t], lv = { name: "R", phone_number: "R", email: "R" }; VARS.forEach((v, i) => lv[v] = T.r[i]); YMM.forEach(c => lv[c] = T.ymm || "R"); return HEAD.filter(h => lv[h] && lv[h] !== "L").join(","); };
TYPE_NAMES.forEach(n => $("hdrtype").append(el("option", { value: n, text: n })));
const showHdr = () => $("hdrline").textContent = hdrFor($("hdrtype").value);
$("hdrtype").addEventListener("change", showHdr); showHdr();
$("copyhdr").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("hdrline").textContent); toast("Header row copied"); } catch (e) { const r = document.createRange(); r.selectNodeContents($("hdrline")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selected. Press Ctrl+C to copy"); } });
(() => {
  const g = $("reqgrid");
  g.append(el("thead", {}, el("tr", {}, [el("th", { text: "List type" }), el("th", { text: "Year / make / model" }), ...VARS.map(v => el("th", {}, el("code", { text: v === "dealer_vehicle_vin" ? "VIN" : v })))])));
  g.append(el("tbody", {}, TYPE_NAMES.map(n => { const T = TYPES[n], y = T.ymm || "R"; return el("tr", { title: TYPE_NOTES[n] || null }, [el("td", { style: "font-weight:600;white-space:nowrap", text: n }), el("td", { class: "req-" + y, text: LEVEL_TEXT[y] }), ...T.r.map(r => el("td", { class: "req-" + r, text: LEVEL_TEXT[r] }))]); })));
  $("typenotes").replaceChildren(...Object.entries(TYPE_NOTES).map(([n, t]) => el("li", {}, [el("b", { text: n + ": " }), t])));
  const c = $("colguide");
  c.append(el("thead", {}, el("tr", {}, ["Upload header", "What it is", "Format", "Example"].map(h => el("th", { text: h })))));
  c.append(el("tbody", {}, GUIDE.map(r => el("tr", {}, [el("td", {}, el("code", { text: r[0] })), el("td", { text: r[1] }), el("td", { text: r[2] }), el("td", {}, el("code", { text: r[3] }))]))));
})();

/* ---------- start ---------- */
go(["hubspot", "incentives", "checker", "template"].includes(S.page) ? S.page : "uploads");
setMode("signin");
boot();
})();
