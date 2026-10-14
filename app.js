/* CallSource Data Upload Center — app logic. Data lives in Supabase (tables du_*);
   with placeholder keys in config.js the app runs on in-memory demo data instead. */
(() => {
const C = window.APP_CONFIG || {};
const DOMAIN = (C.TEAM_DOMAIN || "callsourceauto.com").toLowerCase();
const LIVE = !!(C.SUPABASE_URL && !/YOUR-PROJECT/.test(C.SUPABASE_URL) && C.SUPABASE_ANON_KEY && !/YOUR-/.test(C.SUPABASE_ANON_KEY) && window.supabase);
const sb = LIVE ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;

const STATUSES = [["Expected","Expected"],["Received","Received"],["Issues","Issues – sent back"],["Ready","Ready to load"],["Loaded","Uploaded"]];
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
const fmt = n => n == null || n === "" ? "–" : Number(n).toLocaleString("en-US");
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const fmtDate = s => { if (!s) return "–"; const d = new Date(s.slice(0, 10) + "T12:00:00"); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 6e4); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; const h = Math.round(m / 60); if (h < 24) return h + " hr ago"; return Math.round(h / 24) + " days ago"; };
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
const S = { uploads: [], profiles: {}, me: null, sync: null, page: store.get("du-page") || "uploads",
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
  },
  subscribe(onChange) {
    sb.channel("du-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "du_uploads" }, ({ eventType, new: n, old: o }) => {
        if (eventType === "DELETE") S.uploads = S.uploads.filter(r => r.id !== o.id);
        else { const i = S.uploads.findIndex(r => r.id === n.id); if (i >= 0) S.uploads[i] = n; else S.uploads.unshift(n); }
        onChange();
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
    async load() { S.uploads = rows; S.profiles = Object.fromEntries(people.map(([id, email, full_name]) => [id, { id, email, full_name }])); S.me = S.profiles.d1; S.sync = { started_at: new Date(Date.now() - 6 * 6e4).toISOString(), finished_at: new Date().toISOString(), found: 3, created: 0 }; },
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
  $("to-signup").textContent = m === "signin" ? "Create an account" : "Back to sign in";
  $("to-reset").hidden = m !== "signin";
  const box = $("auth-msg"); box.textContent = msg; box.classList.toggle("ok", ok);
}
$("to-signup").addEventListener("click", () => setMode(mode === "signin" ? "signup" : "signin"));
$("to-reset").addEventListener("click", () => setMode("reset"));
$("authform").addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("a-email").value.trim().toLowerCase(), pass = $("a-pass").value, btn = $("auth-go");
  if (mode !== "newpass" && !email.endsWith("@" + DOMAIN)) return setMode(mode, `Use your @${DOMAIN} email address.`);
  if ((mode === "signup" || mode === "newpass") && pass.length < 8) return setMode(mode, "Passwords need at least 8 characters.");
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
    if (!email.endsWith("@" + DOMAIN)) { await sb.auth.signOut(); $("auth").hidden = false; $("app").hidden = true; return setMode("signin", `Only @${DOMAIN} accounts can use the Upload Center.`); }
    const { data: member, error: memberErr } = await sb.rpc("du_is_team");
    if (!memberErr && member === false) { await sb.auth.signOut(); $("auth").hidden = false; $("app").hidden = true; return setMode("signin", "This account doesn't have access to the Upload Center. Ask an Upload Center admin to add you."); }
    S.me = { id: session.user.id, email, full_name: session.user.user_metadata?.full_name || "" };
  }
  $("auth").hidden = true; $("app").hidden = false;
  try { await api.load(); } catch (e) { toast("Couldn't load uploads: " + (e.message || e)); }
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
  ["uploads", "hubspot", "checker", "template"].forEach(p => $("p-" + p).hidden = p !== page);
  window.scrollTo(0, 0);
}
document.querySelectorAll("#nav button").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));

function render() {
  const open = S.uploads.filter(r => r.status !== "Loaded").length;
  const hs = S.uploads.filter(r => r.source === "hubspot" && r.hubspot_in_stage !== false && r.status !== "Loaded").length;
  $("n-open").textContent = open || ""; $("n-hs").textContent = hs || "";
  renderUploads(); renderHubspot();
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
function setStatus(st) { S.status = st; store.set("du-status", st); renderUploads(); $("rows").closest(".card").scrollIntoView({ behavior: "smooth", block: "start" }); }

function renderUploads() {
  const R = S.uploads, t = today(), month = t.slice(0, 7);
  const exp = R.filter(r => r.status === "Expected"), late = exp.filter(isLate), iss = R.filter(r => r.status === "Issues"), rdy = R.filter(r => r.status === "Ready");
  const upM = R.filter(r => r.status === "Loaded" && (r.uploaded_on || "").slice(0, 7) === month);
  const turns = R.filter(r => r.uploaded_on && r.uploaded_on >= addDays(t, -30)).map(turn).filter(x => x != null && x >= 0);
  const avg = turns.length ? Math.round(turns.reduce((a, b) => a + b, 0) / turns.length * 10) / 10 : null;
  $("kpis").replaceChildren(
    kpi("", "Open files", R.filter(r => r.status !== "Loaded").length, "Not uploaded yet", () => setStatus("open")),
    kpi(late.length ? "bad" : "", "Waiting on dealer", exp.length, late.length ? late.length + " past expected date" : "None late", () => setStatus("Expected")),
    kpi(iss.length ? "bad" : "", "Sent back", iss.length, fmt(iss.reduce((a, r) => a + (+r.issue_count || 0), 0)) + " rows to fix", () => setStatus("Issues")),
    kpi(rdy.length ? "warn" : "", "Ready to upload", rdy.length, "Checked and clean", () => setStatus("Ready")),
    kpi("good", "Uploaded this month", upM.length, fmt(upM.reduce((a, r) => a + (+r.row_count || 0), 0)) + " customer rows", () => setStatus("Loaded")),
    kpi("", "Avg turnaround", avg == null ? "–" : avg, "Came in → uploaded, last 30 days", null, avg == null ? "" : avg === 1 ? "day" : "days"));
  renderWeekly(); renderByType();

  // status segments
  const counts = { open: R.filter(r => r.status !== "Loaded").length, all: R.length }; STATUSES.forEach(([s]) => counts[s] = R.filter(r => r.status === s).length);
  $("seg").replaceChildren(...[["open", "Open"], ...STATUSES, ["all", "All"]].map(([v, l]) => el("button", { class: S.status === v ? "on" : "", role: "tab", "aria-selected": S.status === v ? "true" : "false", onclick: () => { S.status = v; store.set("du-status", v); renderUploads(); } }, [l, el("i", { text: counts[v] })])));

  // table
  const q = S.q.toLowerCase(), lim = { month: t.slice(0, 7) + "-01", 30: addDays(t, -30), 90: addDays(t, -90) }[S.period];
  let list = R.filter(r => (S.status === "all" || (S.status === "open" ? r.status !== "Loaded" : r.status === S.status))
    && (!S.type || r.list_type === S.type) && (!lim || refDate(r) >= lim || r.status !== "Loaded")
    && (!q || [r.dealer, r.file_name, r.notes, r.hubspot_ticket_name, r.hubspot_ticket_id].join(" ").toLowerCase().includes(q)));
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
      el("td", { class: "dealer" }, [el("b", {}, [r.dealer, r.source === "hubspot" ? (ticketHref(r) ? el("a", { class: "src", href: ticketHref(r), target: "_blank", rel: "noopener", title: "Open ticket in HubSpot", text: "HubSpot ↗", onclick: e => e.stopPropagation() }) : el("span", { class: "src", text: "HubSpot" })) : null]), r.file_name ? el("small", { text: r.file_name }) : null, r.list_url ? el("a", { class: "listlink", href: r.list_url, target: "_blank", rel: "noopener", text: "Open list ↗", onclick: e => e.stopPropagation() }) : null, ticketHref(r) ? ticketLink(r, "View ticket #" + r.hubspot_ticket_id + " ↗", "listlink tixlink") : null]),
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

function renderWeekly() {
  const t = today(), d = new Date(t + "T12:00:00"); const monday = addDays(t, -((d.getDay() + 6) % 7));
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(monday, -7 * (7 - i)));
  const data = weeks.map(w => { const e = addDays(w, 7); const rs = S.uploads.filter(r => r.uploaded_on && r.uploaded_on >= w && r.uploaded_on < e); return { w, n: rs.length, rows: rs.reduce((a, r) => a + (+r.row_count || 0), 0) }; });
  const W = 640, H = 190, L = 8, B = 28, T = 22, mx = Math.max(1, ...data.map(x => x.n)), bw = (W - 2 * L) / data.length;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Files uploaded per week, last 8 weeks">`;
  for (let g = 1; g <= 3; g++) { const y = H - B - (H - B - T) * g / 3; s += `<line x1="${L}" x2="${W - L}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-dasharray="3 4"/>`; }
  s += `<line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>`;
  data.forEach((x, i) => {
    const h = (H - B - T) * x.n / mx, bx = L + i * bw + bw * .2, w = bw * .6, last = i === data.length - 1;
    s += `<rect x="${bx}" y="${H - B - h}" width="${w}" height="${Math.max(h, x.n ? 2 : 0)}" rx="3" fill="${last ? "var(--green)" : "var(--blue)"}" opacity="${last ? 1 : .8}"><title>${x.n} files · ${x.rows.toLocaleString()} rows</title></rect>`;
    if (x.n) s += `<text x="${bx + w / 2}" y="${H - B - h - 6}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">${x.n}</text>`;
    s += `<text x="${bx + w / 2}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${last ? "This wk" : fmtDate(x.w)}</text>`;
  });
  $("weekly").className = "bars"; $("weekly").innerHTML = s + "</svg>";
}
function renderByType() {
  const open = S.uploads.filter(r => r.status !== "Loaded");
  const rows = [...TYPE_NAMES, null].map(t => [t || "No list type yet", open.filter(r => (r.list_type || null) === t).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
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
   HUBSPOT PAGE
   ========================================================= */
function renderHubspot() {
  const list = S.uploads.filter(r => r.source === "hubspot" && r.hubspot_in_stage !== false).sort((a, b) => (a.hubspot_created_at || "") < (b.hubspot_created_at || "") ? -1 : 1);
  const t = today(), age = r => r.hubspot_created_at ? days(r.hubspot_created_at.slice(0, 10), t) : null;
  const notIn = list.filter(r => r.status === "Expected"), oldest = list.length ? Math.max(...list.map(age).filter(x => x != null)) : null;
  $("hs-kpis").replaceChildren(
    kpi("", "In Upload Needed", list.length, "Tickets in HubSpot"),
    kpi(notIn.length ? "warn" : "", "List not in yet", notIn.length, "Still Expected in the tracker", notIn.length ? () => { go("uploads"); setStatus("Expected"); } : null),
    kpi(oldest > 7 ? "bad" : "", "Oldest ticket", oldest == null ? "–" : oldest, "Since the ticket opened", null, oldest == null ? "" : oldest === 1 ? "day" : "days"),
    kpi("good", "Uploaded from HubSpot", S.uploads.filter(r => r.source === "hubspot" && r.status === "Loaded").length, "All time"));
  const s = S.sync, info = $("syncinfo");
  info.className = "sync" + (s && s.error ? " err" : "");
  info.textContent = !s ? "Not synced yet" : s.error ? "Last sync failed: " + s.error.slice(0, 90) : `Synced ${ago(s.finished_at || s.started_at)} · ${s.found ?? 0} tickets${s.created ? ", " + s.created + " new" : ""}`;
  $("hs-rows").replaceChildren(...list.map(r => {
    const a = age(r), tk = ticketLink(r, r.hubspot_ticket_name || "#" + r.hubspot_ticket_id);
    return el("tr", { class: "click", onclick: () => openDrawer(r) }, [
      el("td", { class: "dealer" }, [el("b", {}, tk), el("small", { text: "#" + r.hubspot_ticket_id })]), el("td", { text: r.dealer }),
      el("td", {}, a == null ? "–" : el("span", { class: a > 7 ? "late" : "", text: a === 0 ? "Today" : a + (a === 1 ? " day" : " days") })),
      el("td", { text: r.hubspot_owner || "–" }), el("td", {}, r.list_url ? el("a", { class: "listlink", href: r.list_url, target: "_blank", rel: "noopener", text: "Open list ↗", onclick: e => e.stopPropagation() }) : el("span", { class: "faint", text: "No link yet" })), el("td", {}, el("span", { class: "pill st-" + r.status, text: stLabel(r.status) })),
      el("td", { text: fmtDate(r.received_on) }), el("td", { text: fmtDate(r.uploaded_on) })]);
  }));
  const E = $("hs-empty"); E.hidden = list.length > 0;
  if (!list.length) E.replaceChildren(el("b", { text: "No tickets in Upload Needed" }), s ? "Every ticket in that stage is accounted for." : "Once the HubSpot sync is set up (README step 6), tickets show up here.");
}
$("syncnow").addEventListener("click", async () => {
  const b = $("syncnow"); b.disabled = true; b.textContent = "Syncing…";
  try { const r = await api.sync(); if (r && r.ok === false) throw new Error(r.error); toast(`HubSpot synced: ${r.found} tickets, ${r.created} new`); if (LIVE) await api.load(); render(); }
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
go(S.page === "hubspot" || S.page === "checker" || S.page === "template" ? S.page : "uploads");
setMode("signin");
boot();
})();
