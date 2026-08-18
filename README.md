# PRVA Mabuhay Miles Bot

Handles the Mabuhay Miles membership request flow in Discord:

1. Staff runs `/mm-setup` once in whatever channel pilots should see the button (e.g. a
   `#crew-center` or `#bot-commands` channel).
2. A pilot clicks **Request Mabuhay Miles Account**. The bot creates a new post in the
   staff-only `#mm-application` forum channel, adds that pilot as a member of just that one
   thread (so it feels private to them even though the forum itself is hidden from everyone
   else), and pings the Staff role.
3. Staff verify the pilot has crossed 500 hours (in the Crew Center, once that exists) and
   click **Approve** or **Reject** inside the thread. Approving posts a message that mentions
   the pilot so they're notified. The bot doesn't touch the Crew Center itself — staff still
   do that part manually.

This is a standalone Node process — it can't run on Netlify (that's static hosting only). It
needs somewhere that stays online 24/7. See **Hosting** below.

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
2. Create a **Forum Channel** named `mm-application`. Restrict it so only your Staff role
   (and the bot) can see it — edit channel permissions, deny **View Channel** for
   `@everyone`, allow it for your Staff role.
3. (Recommended) In that forum channel's settings, add three **Post Tags**: `Pending`,
   `Approved`, `Rejected`. The bot applies these automatically if they exist by those exact
   names — if you skip this, the bot still works, it just won't tag threads.
4. Collect these IDs (right-click → Copy ID, with Developer Mode on):
   - Your server → **Server ID** (this is `GUILD_ID`)
   - The `#mm-application` forum channel → **Channel ID** (`MM_FORUM_CHANNEL_ID`)
   - Your Staff role (Server Settings → Roles → right-click it) → **Role ID** (`STAFF_ROLE_ID`)
   - Your bot's application → **Application ID**, on the General Information page in the
     Developer Portal (`DISCORD_CLIENT_ID`)

## 3. Configure

Copy `.env.example` to `.env` for local testing:

```bash
cp .env.example .env
```

Fill in the five values. **Never commit the real `.env` file** — it's already in
`.gitignore`.

## 4. Run it locally (optional, to test before deploying)

```bash
npm install
npm start
```

You should see `Logged in as <botname>` and `Slash commands registered.` in the console.

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
   for the same "Logged in as..." message.

## 6. Turn it on

In your Discord server, run `/mm-setup` in whichever channel pilots should see the request
button. That's it — the button posts once and stays there.
