# CallSource Data Upload Center

Your team's tracker for dealer data lists. It shows when each list came in and when it was uploaded, checks CSV files against the upload template, and pulls in HubSpot tickets from the **Upload Needed** stage automatically.

Everything here runs on free plans: Supabase (database and logins), GitHub Pages (the website), and a HubSpot private app.

**Preview first:** open `index.html` in Chrome. With no Supabase keys yet, it runs on clearly labeled demo data, and nothing is saved.

---

## What's in this folder

| File | What it does |
|---|---|
| `index.html`, `styles.css`, `app.js`, `rules.js`, `logo.png` | The website |
| `config.js` | Where you paste your Supabase keys (step 3) |
| `supabase/schema.sql` | Creates the database tables, security rules and activity log (step 2) |
| `supabase/functions/upload-center-sync/index.ts` | The HubSpot sync (step 6) |

Everything in the database starts with `du_`, so it can safely share a Supabase project with other apps, such as an outbound dashboard.

---

## 1. Create a Supabase project (about 3 min)

1. Go to **supabase.com** and sign up with your work email.
2. Click **New project**. Name it `callsource-upload-center`, choose a strong database password (save it somewhere), and pick the region closest to you. Then click **Create**.
   - Already have a Supabase project for something else? You can use it instead. Nothing here will collide with it.

## 2. Set up the database (1 min)

1. In Supabase, open **SQL Editor** → **New query**.
2. Open `supabase/schema.sql`, copy everything, paste it in, and click **Run**. You should see "Success. No rows returned."

## 3. Connect the website to Supabase (2 min)

1. In Supabase, go to **Project Settings → API Keys** (older projects: **Project Settings → API**).
2. Open `config.js` in Notepad (or TextEdit on a Mac) and paste in:
   - **Project URL** (found under **Project Settings → Data API**, or on the project's home page) → `SUPABASE_URL`
   - **Publishable key** (`sb_publishable_…`) or the legacy **anon public** key → `SUPABASE_ANON_KEY`
3. Optional: put your HubSpot account ID in `HUBSPOT_PORTAL_ID` so ticket names link to HubSpot. It's the number in your HubSpot web address, `app.hubspot.com/.../`**12345678**`/...`
4. Save the file.

The publishable (anon) key is meant to be public. The security rules in `schema.sql` only let signed-in @callsourceauto.com accounts read or change anything.

## 4. Put it online with GitHub Pages (5 min)

1. Sign in at **github.com** (or create a free account).
2. Click **+ → New repository**. Name it `upload-center`, leave it **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Drag in everything from this folder (including the `supabase` folder), then click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch **main** and folder **/ (root)**. Click **Save**.
5. After a minute or two, your link appears at the top of that page, like `https://your-name.github.io/upload-center/`.

> A public repository only shows the code. The data stays in Supabase behind the team login. (GitHub Pages for private repositories needs a paid GitHub plan.)

## 5. Turn on team logins (2 min)

In Supabase, go to **Authentication**:

1. **Sign In / Providers → Email**: make sure it's on, and keep **Confirm email** on.
2. **URL Configuration**: set **Site URL** to your GitHub Pages link from step 4. Add the same link under **Redirect URLs**.

Then open your link and click **Create an account**. Only @callsourceauto.com emails are accepted. Confirm the email, sign in, and share the link with your team.

## 6. Connect HubSpot (10 min)

**a. Create a HubSpot private app token**

1. In HubSpot, click the **Settings** gear, then **Integrations → Private Apps**. In newer HubSpot accounts this is under **Development → Legacy apps → Create legacy app → Private**.
2. Name it `Upload Center sync`. On the **Scopes** tab, add:
   - `tickets`
   - `crm.objects.companies.read`
   - `crm.objects.owners.read`
3. Click **Create app** and copy the **access token**. You need a HubSpot Super Admin to do this step.

**b. Add the sync function to Supabase**

1. In Supabase, open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `upload-center-sync`.
3. Delete the sample code, paste in everything from `supabase/functions/upload-center-sync/index.ts`, and click **Deploy**.
4. Go to **Edge Functions → Secrets** and add:

   | Name | Value |
   |---|---|
   | `HUBSPOT_TOKEN` | the token from step 6a |
   | `HUBSPOT_STAGE` | `Upload Needed` (or the exact stage name, if it's different) |
   | `HUBSPOT_PIPELINE` | optional: the pipeline name, if more than one pipeline has a stage with that name |

5. Open the Upload Center, go to **HubSpot queue**, and click **Sync now**. Tickets in Upload Needed should appear, and each one also shows up on the Uploads page as **Expected**.

**c. Make it run every 15 minutes**

1. In Supabase, go to **Database → Extensions** and turn on **pg_cron** and **pg_net**.
2. In **SQL Editor**, open a new query and paste the block at the bottom of `schema.sql` (the lines under *HubSpot auto-sync schedule*).
3. Remove the `-- ` at the start of each line. Replace `YOUR-PROJECT-REF` with the part of your Project URL before `.supabase.co`. Replace `YOUR-ANON-KEY` with the **legacy anon key**, which starts with `eyJ` and is on the **Legacy API keys** tab of Project Settings → API Keys.
   - If your project has no legacy key, open **Edge Functions → upload-center-sync → Details** and turn off **Verify JWT**. The scheduled call then works with any key.
4. Click **Run**.

---

## How it works day to day

- **A HubSpot ticket enters Upload Needed:** within 15 minutes it appears on Uploads as *Expected*, with the dealer taken from the ticket's company.
- **The dealer's list arrives:** run it through **File checker**, then click **Log to tracker**, or change the row's status to *Received*. The "Came in" date fills in automatically.
- **It's uploaded:** set the status to *Uploaded*, or pick a date in the **Uploaded** column. The turnaround (days from came in to uploaded) is calculated for you.
- **Activity:** every status change and uploaded date is recorded with who made it and when. Click any row to see its history.
- **Export CSV** downloads the whole tracker for reporting.

## Good to know

- **Free plan limits:** Supabase's free plan includes 500 MB of database storage (enough for years of upload records) and 2 projects. Free projects can pause after a week with no activity. If that happens, open the project in Supabase and click **Restore**.
- **Adding a teammate:** send them the link. They create an account with their @callsourceauto.com email.
- **Changing the email domain:** edit `TEAM_DOMAIN` in `config.js`, and edit the two places that say `callsourceauto.com` in `schema.sql`, then run it again.

## Troubleshooting

| What you see | Fix |
|---|---|
| Yellow "Demo data" bar on your live site | `config.js` still has the placeholder values. Paste your URL and anon key (step 3). |
| "Only @callsourceauto.com accounts can use the Upload Center" | Sign up with your work email. |
| Confirmation email link opens a broken page | Set the Site URL and Redirect URL in step 5 to your GitHub Pages link. |
| Sync failed: HUBSPOT_TOKEN secret is not set | Add the secret in step 6b, then click Sync now again. |
| Sync failed: No ticket stage named "upload needed" | Set `HUBSPOT_STAGE` to the stage name exactly as it appears in HubSpot. |
| Sync failed: HubSpot … 403 | The private app is missing a scope. Add the three scopes in step 6a. |
