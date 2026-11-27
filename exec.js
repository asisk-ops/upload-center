/* Executive layer for the Data Upload Center.
   Reads the numbers app.js already renders (KPI cards, daily chart) and adds
   the hero gauge, pipeline mix and chart gradient. Changes no data. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var NS = "http://www.w3.org/2000/svg";

  // Today's date in the hero
  var d = $("x-date");
  if (d) d.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  function num(t) { var n = parseFloat(String(t || "").replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : n; }
  function readKpis() {
    var out = {};
    document.querySelectorAll("#kpis .kpi").forEach(function (k) {
      var key = (k.querySelector(".k") || {}).textContent || "";
      var v = k.querySelector(".v");
      out[key.trim().toLowerCase()] = v ? num(v.firstChild ? v.firstChild.textContent : v.textContent) : 0;
    });
    return out;
  }

  function gauge(pct) {
    var r = 46, c = 2 * Math.PI * r, off = c * (1 - Math.max(0, Math.min(1, pct)));
    return '<svg viewBox="0 0 112 112" aria-hidden="true"><defs><linearGradient id="xg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0ff"/><stop offset="1" stop-color="#5fe0c8"/></linearGradient></defs>' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="11"/>' +
      '<circle cx="56" cy="56" r="' + r + '" fill="none" stroke="url(#xg)" stroke-width="11" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 56 56)"/>' +
      '<text x="56" y="62" text-anchor="middle" fill="#fff" font-family="Barlow,Arial" font-weight="800" font-size="22">' + Math.round(pct * 100) + '%</text></svg>';
  }

  function renderExec() {
    var k = readKpis();
    var done = k["uploaded this month"] || 0, need = k["upload needed"] || 0;
    var sent = k["sent back"] || 0, ready = k["ready to upload"] || 0, hold = k["on hold"] || 0;
    var g = $("x-gauge");
    if (g) {
      var pct = done + need ? done / (done + need) : 0;
      g.innerHTML = gauge(pct) + '<div class="gl"><small>Month to date</small><b>' + done + ' of ' + (done + need) + '</b><span>lists uploaded vs. lists still waiting</span></div>';
    }
    var f = $("x-flow");
    if (f) {
      var waiting = Math.max(0, need - sent - ready - hold);
      var st = [["Waiting on data / formatting", waiting, "lists in the queue", "#f1f5f9", "#334155"],
                ["Sent back", sent, "need dealer fixes", "#fdecea", "#b42318"],
                ["On hold", hold, "paused", "#f1ecfb", "#5b3aa6"],
                ["Ready to upload", ready, "checked and clean", "#fdf3e3", "#9a5a06"],
                ["Uploaded this month", done, "lists completed", "#e3f5f2", "#0f766e"]];
      f.innerHTML = st.map(function (s) { return '<div class="xstage" style="--sb:' + s[3] + ';--sc:' + s[4] + '"><small>' + s[0] + '</small><b>' + s[1] + '</b><span>' + s[2] + '</span></div>'; }).join("");
    }
    var m = $("x-mix");
    if (m) {
      var other = Math.max(0, need - sent - ready - hold);
      var parts = [["Uploaded (month)", done, "#25804a"], ["Ready to upload", ready, "#b8690b"], ["Sent back", sent, "#c0392b"], ["On hold", hold, "#6b46b8"], ["Other waiting", other, "#2458b8"]];
      var tot = parts.reduce(function (a, p) { return a + p[1]; }, 0) || 1;
      m.innerHTML = '<div class="xmix-bar">' + parts.map(function (p) { return p[1] ? '<i style="width:' + (p[1] / tot * 100) + '%;background:' + p[2] + '" title="' + p[0] + ': ' + p[1] + '"></i>' : ""; }).join("") + '</div>' +
        '<div class="xmix-leg">' + parts.map(function (p) { return '<div style="--c:' + p[2] + '">' + p[0] + '<b>' + p[1] + '</b></div>'; }).join("") + '</div>';
    }
  }

  function decorateDaily() {
    var svg = document.querySelector("#daily svg");
    if (!svg || svg.querySelector("#xbar")) return;
    var defs = document.createElementNS(NS, "defs");
    defs.innerHTML = '<linearGradient id="xbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6fe0"/><stop offset="1" stop-color="#0f8b8d"/></linearGradient>';
    svg.insertBefore(defs, svg.firstChild);
    // Trend line + area through the bar tops (shown in the Flow look)
    var pts = [], base = null;
    svg.querySelectorAll("g.bar").forEach(function (g) {
      var r = g.querySelectorAll("rect")[1]; if (!r) return;
      var x = +r.getAttribute("x") + (+r.getAttribute("width")) / 2, y = +r.getAttribute("y"), h = +r.getAttribute("height");
      base = y + h; pts.push([x, y]);
    });
    if (pts.length > 1) {
      var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      var area = line + " L" + pts[pts.length - 1][0].toFixed(1) + " " + base + " L" + pts[0][0].toFixed(1) + " " + base + " Z";
      var gEl = document.createElementNS(NS, "g");
      gEl.setAttribute("class", "daily-line");
      gEl.innerHTML = '<linearGradient id="xarea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14b8a6" stop-opacity=".35"/><stop offset="1" stop-color="#14b8a6" stop-opacity="0"/></linearGradient>' +
        '<path d="' + area + '" fill="url(#xarea)"/><path d="' + line + '" fill="none" stroke="#0f766e" stroke-width="2.5" stroke-linejoin="round"/>' +
        pts.filter(function (p) { return p[1] < base; }).map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#fff" stroke="#0f766e" stroke-width="2"/>'; }).join("");
      svg.appendChild(gEl);
    }
  }

  function watch(id, fn) {
    var el = $(id); if (!el) return;
    new MutationObserver(fn).observe(el, { childList: true, subtree: true });
    fn();
  }
  // Customer rows are formatted/uploaded manually, so hide row-count readouts
  function hideRows() {
    document.querySelectorAll("#kpis .kpi .s").forEach(function (el) {
      if (/customer rows/i.test(el.textContent)) el.textContent = "Lists completed";
    });
    document.querySelectorAll("#dr-stats .dstat").forEach(function (el) {
      if (/customer rows/i.test(el.textContent)) el.style.display = "none";
    });
    document.querySelectorAll("#daily title").forEach(function (t) {
      var v = t.textContent.replace(/ · [\d,]+ rows?/, "");
      if (v !== t.textContent) t.textContent = v;
    });
  }
  // Sign-out safety net: if the normal sign-out hasn't returned to the sign-in
  // screen after a moment (e.g. the auth call stalls), clear this browser's
  // session locally and reload.
  var so = $("signout");
  if (so) so.addEventListener("click", function () {
    if (typeof sb === "undefined" || !sb) return; // demo mode
    setTimeout(function () {
      if ($("app").hidden) return; // signed out normally
      Promise.resolve().then(function () { return sb.auth.signOut({ scope: "local" }); }).catch(function () {}).then(function () {
        setTimeout(function () {
          if ($("app").hidden) return;
          try { Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); }); } catch (e) {}
          location.reload();
        }, 800);
      });
    }, 1500);
  });

  watch("kpis", hideRows);
  watch("dr-stats", hideRows);
  watch("daily", hideRows);
  watch("kpis", renderExec);
  watch("daily", decorateDaily);
})();
