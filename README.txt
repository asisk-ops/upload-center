CallSource Data Upload Center - Executive light-mode redesign
==============================================================

Files to add/replace in the site's project folder (same folder as app.js):
  index.html     (replaces the current one - same IDs and hooks, plus new layout)
  executive.css  (new - loads after styles.css; look & feel only)
  exec.js        (new - draws the hero gauge, pipeline graphic and trend line
                  from numbers app.js already shows; it never writes data)

No changes to app.js, rules.js, config.js or styles.css.

Light mode: forced via data-theme="light" on <html>, so it stays light even
when someone's computer is set to dark mode.

Picking a look (line 3 of index.html) - currently set to Option B, "flow":
  data-look=""            Option A - Command Center (navy hero, donut gauge, icon KPI cards)
  data-look="flow"        Option B - Pipeline Flow (slate + teal, stage-by-stage pipeline, trend line)
  data-look="editorial"   Option C - Editorial (black/white, big numbers, one orange accent)

Uploads page changes: the KPIs and charts that used to be hidden under
"Stats & trends" are now always visible above the worklist.

After deploying, hard-refresh (Ctrl+Shift+R) so browsers pick up the new files.
