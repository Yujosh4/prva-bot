# PRVA Mabuhay Miles Bot

Handles the Mabuhay Miles ticket flow in Discord:

1. Staff runs `/mm-setup` once in the **public** `#mm-application` channel, where pilots can
   see it. This posts a message with two buttons: **Apply for Mabuhay Miles** and
   **Upgrade Mabuhay Miles**.
2. A pilot clicks one. The bot creates a new post in the `#pilot-applications` forum
   channel, tagged `Mabuhay Miles`, and pings the Staff role there.
3. Back in `#mm-application`, the bot replies (visible only to that pilot) confirming their
   request was submitted, with a **Cancel Request** button.
4. If they click Cancel, the bot posts a cancellation note in the forum thread and archives
   it, so staff don't process a withdrawn request.
5. Staff verify the pilot's hours (in the Crew Center, once that exists), then click
   **Approve** or **Reject** directly on the forum post. Only members with the Staff role
   (or Manage Server permission) can use these buttons — anyone else gets an ephemeral
   "only staff" message. Either choice posts a decision note in the thread, removes the
   buttons so it can't be double-processed, adds an **Approved**/**Rejected** post tag
   (alongside the existing type tag, not replacing it — the bot looks the tag up by that
   exact name, so it's skipped harmlessly if you rename or remove it), archives the thread,
   and DMs the pilot (silently skipped if their DMs are closed). For Mabuhay Miles, it also
   tries to update the pilot's original "submitted" message in `#mm-application` so it
   doesn't sit there looking unprocessed — this only works if the decision happens within
   about 15 minutes of the request (a Discord limit, not something this bot controls), so
   the DM is the notification pilots can actually count on.

**Pilot Applications:** the website's Join Us form POSTs to this bot's `/pilot-application`
HTTP endpoint (see `server.js`), which creates a forum post the same way as Mabuhay Miles —
tagged `Pilot Application`, with working Approve/Reject buttons. There's no verified Discord
user id for these submissions (the form only collects a free-text Discord username), so
decisions don't DM the applicant, just post/archive the thread. If the endpoint is
unreachable, `join.html` falls back to posting straight to a plain Discord webhook instead
(no buttons, but the application still reaches staff) — see **Website wiring** below.

**Type Rating requests:** the Crew Center's Type Rating page POSTs to this bot's
`/typerating-request` HTTP endpoint (see `server.js`) the moment a pilot submits a request,
which opens a real **private thread** on a plain text channel (not a forum post like the two
flows above — a checkride conversation between one pilot and one examiner shouldn't be
visible to everyone who can see `#pilot-applications`) and adds the pilot to it. Everything
else — approve/reject, assigning an examiner, scheduling, and the pass/fail result — happens
in the Crew Center itself, not with Discord buttons; the other things this bot does for this
flow are add the assigned examiner to that same thread once staff presses "Assign Examiner"
(`/typerating-assign-examiner`), and post the confirmed date/time when staff presses "Set
Schedule" (`/typerating-schedule`). If any of these endpoints is unreachable, the Crew Center
request/assignment/schedule still goes through — it just proceeds without a thread (or without
Discord being notified), same "never block the real action on the bot being up" fallback
philosophy as the pilot-application webhook fallback below.

**Checkride start reminders:** separately from the three endpoints above, `reminders.js`
polls Supabase directly once a minute (needs `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set —
see `.env.example`) for any scheduled checkride whose time has arrived, and pings the pilot +
examiner in their thread. This is a poll against the DB's own state rather than an in-memory
timer set when the checkride is booked, specifically so a Wispbyte restart between now and the
checkride doesn't silently lose the reminder — it just resumes on the next tick. Staff enter
the checkride time as UTC/Zulu in the Crew Center (labelled there); the Discord messages use
Discord's own `<t:...>` timestamp markdown so everyone sees it in their own local time
automatically, no per-user timezone tracking needed.

This is a standalone Node process — it can't run on Netlify (that's static hosting only). It
needs somewhere that stays online 24/7. It also now needs an exposed HTTP port for the
website to reach (see **Website wiring**). See **Hosting** below.

## 1. Create the bot in Discord

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application** → name it (e.g. "PRVA Bot").
2. Go to **Bot** in the sidebar → **Reset Token** → copy the token. Treat this like a
   password — never paste it in chat, a commit, or anywhere public. You'll paste it into
   your host's environment variables (step 4).
3. Toggle on **Server Members Intent** under **Privileged Gateway Intents** (same Bot page) --
   needed so a new Type Rating request can add every holder of the Type Rating Examiner role
   to the request's thread as real members (see step 6 below, `TYPE_RATING_EXAMINER_ROLE_ID`).
   Without this toggled on here, the bot fails to log in entirely once that intent is added
   to the code (`index.js`), not just that one feature. Message Content intent still isn't
   needed -- this bot never reads message text, only slash commands and buttons.
4. Go to **OAuth2 → URL Generator**. Under **Scopes**, check `bot` and
   `applications.commands`. Under **Bot Permissions**, check:
   - View Channels
   - Send Messages
   - Create Public Threads
   - Create Private Threads
   - Send Messages in Threads
   - Manage Threads
   - Embed Links
5. Copy the generated URL, open it, and invite the bot to your PRVA server.
   Already invited it before adding **Create Private Threads** just now? Re-run this same
   URL Generator step and open the new link — Discord updates an existing bot's permissions
   in place, no need to kick and re-invite it.

## 2. Set up the Discord server

1. Turn on Developer Mode: Discord Settings → Advanced → Developer Mode.
2. Create (or confirm) a **public text channel** named `mm-application` — pilots need to be
   able to see and use this one.
3. Create a **Forum Channel** named `pilot-applications`. (Whether this should be staff-only
   or visible to pilots too is still open — ask Claude to lock it down once you've decided.)
4. In that forum channel's settings, add a **Post Tag** named exactly `Mabuhay Miles`. The
   bot looks it up by name at startup and logs all available tags to the console — handy
   once you add a `Pilot Application` tag too.
5. Create a plain **text channel** (not a forum) named e.g. `type-rating` for the bot to open
   private threads in. Its own visibility can be whatever you want (staff-only is simplest,
   since only staff need to see the channel itself — each request's thread is private
   regardless, visible only to the pilot, the assigned examiner, and staff with Manage
   Threads).
6. Collect these IDs (right-click → Copy ID, with Developer Mode on):
   - Your server → **Server ID** (`GUILD_ID`)
   - The `#pilot-applications` forum channel → **Channel ID**
     (`PILOT_APPLICATIONS_FORUM_CHANNEL_ID`)
   - The `#type-rating` text channel → **Channel ID** (`TYPE_RATING_CHANNEL_ID`)
   - Your "Type Rating Examiner (TRE)" role (Server Settings → Roles → right-click it) →
     **Role ID** (`TYPE_RATING_EXAMINER_ROLE_ID`) -- pings this role (falls back to
     `STAFF_ROLE_ID` if unset) *and* adds every member who holds it to a new request's
     thread as a real member -- a role @mention alone doesn't add anyone to a private
     thread, only explicit membership or Manage Threads does, and even Manage Threads
     doesn't surface it in someone's sidebar the way real membership does
   - Your Staff role (Server Settings → Roles → right-click it) → **Role ID**
     (`STAFF_ROLE_ID`)
   - Your bot's application → **Application ID**, on the General Information page in the
     Developer Portal (`DISCORD_CLIENT_ID`)

## 3. Configure

Copy `.env.example` to `.env` for local testing:

```bash
cp .env.example .env
```

Fill in the values. **Never commit the real `.env` file** — it's already in `.gitignore`.
`PILOT_APP_API_KEY` can be any string you make up — it just has to match what you put in
`Website/join.html`'s `PILOT_APP_API_KEY` constant. Leave `PORT` blank unless your host
doesn't provide one automatically.

## 4. Run it locally (optional, to test before deploying)

```bash
npm install
npm start
```

You should see `Logged in as <botname>`, a list of the forum's available tags, and
`Slash commands registered.` in the console.

## 5. Hosting (so it stays online 24/7)

Netlify can't run this — it's static-only. [Railway](https://railway.app) is the simplest
option with a usable free tier for a small bot like this:

1. Push this `Discord Bot` folder to its own GitHub repo (same pattern as the website: `git
   init`, commit, create an empty repo on GitHub, push).
2. On [railway.app](https://railway.app), sign in with GitHub → **New Project** → **Deploy
   from GitHub repo** → pick the repo.
3. In the Railway project's **Variables** tab, add the same five variables from your `.env`
   file (this is the one place it's safe to paste the real token — Railway keeps it secret).
4. Railway will detect `npm start` automatically and deploy. Check the **Deployments** logs
   for the "Logged in as..." message and the tag list.

## 6. Website + Crew Center wiring (this bot has two callers now)

The website and the Crew Center are both served over `https://`, so their `fetch()` calls
can't reach a plain `http://` endpoint (browsers block that as "mixed content") — the bot
needs a real HTTPS URL. This bot gets one via a **Cloudflare Tunnel** (`tunnel.js`), which
runs as a child process of the bot itself — no separate process for Wispbyte to manage, and
no need for the raw IP:port to be publicly reachable at all, since it connects outbound to
Cloudflare like the Discord connection already does.

1. On first boot, the bot downloads the `cloudflared` binary automatically (via the
   `cloudflared` npm package's postinstall step — this runs as part of `npm install`).
2. Once connected, it logs a line like:
   ```
   Cloudflare Tunnel ready. Pilot Application endpoint: https://random-words-here.trycloudflare.com/pilot-application
   ```
   That same base URL (swap the path) is what both `/typerating-request` and
   `/typerating-assign-examiner` are reachable at too. If you set `ADMIN_USER_ID` in your env
   vars (your own Discord user id), the bot also DMs you this same URL — handy since you
   don't have to dig through Wispbyte's console logs.
3. **This URL changes every time the bot restarts** (it's a free "quick tunnel", not tied to
   a domain you own). Each time it changes, update the base URL in **two** places:
   - `Website/join.html` → `PILOT_APP_API_URL` (the new URL + `/pilot-application`)
   - `Route Network Database/js/config.js` → `DISCORD_BOT_API_URL` (just the new base URL,
     no path — `js/crew-typerating.js` appends `/typerating-request` and
     `/typerating-assign-examiner` itself)

   `PILOT_APP_API_KEY` (website) and `DISCORD_BOT_API_KEY` (Crew Center) both need to match
   `PILOT_APP_API_KEY` in the bot's own env — same shared key for every endpoint, only needs
   setting once, doesn't change on restart. Push both after updating — Netlify redeploys each
   independently.
4. If you forget to update either, or the bot is mid-restart, nothing breaks: both sites
   catch the failed request and fall back gracefully (the website posts straight to a plain
   Discord webhook instead; the Crew Center just proceeds without a Discord thread, or
   without the examiner added to one — the actual request/approval/assignment still goes
   through in Supabase either way).

Optional upgrade later, if you end up owning a domain: point it at a **named** Cloudflare
Tunnel instead of a quick one, so the URL stays fixed across restarts. Ask Claude to set that
up when you're ready — it's a bigger change than this default.

## 7. Turn it on

In Discord, run `/mm-setup` in `#mm-application`. That's it — the buttons post once and
stay there.
