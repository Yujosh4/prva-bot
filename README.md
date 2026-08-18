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
   buttons so it can't be double-processed, archives the thread, and DMs the pilot (silently
   skipped if their DMs are closed).

**Pilot Applications:** the website's Join Us form POSTs to this bot's `/pilot-application`
HTTP endpoint (see `server.js`), which creates a forum post the same way as Mabuhay Miles —
tagged `Pilot Application`, with working Approve/Reject buttons. There's no verified Discord
user id for these submissions (the form only collects a free-text Discord username), so
decisions don't DM the applicant, just post/archive the thread. If the endpoint is
unreachable, `join.html` falls back to posting straight to a plain Discord webhook instead
(no buttons, but the application still reaches staff) — see **Website wiring** below.

**Not wired up yet:** Type Rating requests. Meant to land in `#pilot-applications` too,
tagged `Type Rating`, but deferred until the Crew Center exists.

This is a standalone Node process — it can't run on Netlify (that's static hosting only). It
needs somewhere that stays online 24/7. It also now needs an exposed HTTP port for the
website to reach (see **Website wiring**). See **Hosting** below.

## 1. Create the bot in Discord

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application** → name it (e.g. "PRVA Bot").
2. Go to **Bot** in the sidebar → **Reset Token** → copy the token. Treat this like a
   password — never paste it in chat, a commit, or anywhere public. You'll paste it into
   your host's environment variables (step 4).
3. No privileged intents need to be toggled on for this bot — it only uses slash commands
   and buttons, not message content.
4. Go to **OAuth2 → URL Generator**. Under **Scopes**, check `bot` and
   `applications.commands`. Under **Bot Permissions**, check:
   - View Channels
   - Send Messages
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads
   - Embed Links
5. Copy the generated URL, open it, and invite the bot to your PRVA server.

## 2. Set up the Discord server

1. Turn on Developer Mode: Discord Settings → Advanced → Developer Mode.
2. Create (or confirm) a **public text channel** named `mm-application` — pilots need to be
   able to see and use this one.
3. Create a **Forum Channel** named `pilot-applications`. (Whether this should be staff-only
   or visible to pilots too is still open — ask Claude to lock it down once you've decided.)
4. In that forum channel's settings, add a **Post Tag** named exactly `Mabuhay Miles`. The
   bot looks it up by name at startup and logs all available tags to the console — handy
   once you add `Pilot Application` and `Type Rating` tags too.
5. Collect these IDs (right-click → Copy ID, with Developer Mode on):
   - Your server → **Server ID** (`GUILD_ID`)
   - The `#pilot-applications` forum channel → **Channel ID**
     (`PILOT_APPLICATIONS_FORUM_CHANNEL_ID`)
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

## 6. Website wiring (Pilot Applications → this bot)

For the website's Join Us form to reach `/pilot-application`, your host needs to expose an
HTTP port for the bot process (separate from Discord's own connection, which is outbound
only and needs no port).

1. On Wispbyte, check your server's **Network/Allocation** tab for the public address
   assigned to your server — usually something like `your-node.wispbyte.com:25xxx`. Set
   `PORT` in your env vars only if Wispbyte doesn't already inject one automatically (check
   the **Startup** tab — if it lists a `SERVER_PORT` variable, leave your own `PORT` blank).
2. Once deployed, confirm it's reachable by visiting
   `http://<that address>/health` in a browser — you should see `{"ok":true,...}`. If it
   times out or refuses to connect, the port likely isn't exposed publicly on your plan —
   ask in Wispbyte's support/docs about exposing a custom TCP/HTTP port for a Node app, or
   fall back to leaving `PILOT_APP_API_URL` blank in `join.html` (the plain-webhook fallback
   still works, just without Approve/Reject buttons).
3. In `Website/join.html`, set:
   - `PILOT_APP_API_URL` to `http://<that address>/pilot-application`
   - `PILOT_APP_API_KEY` to the same string you set as `PILOT_APP_API_KEY` in the bot's env
4. Push the website change — Netlify redeploys automatically.

## 7. Turn it on

In Discord, run `/mm-setup` in `#mm-application`. That's it — the buttons post once and
stay there.
