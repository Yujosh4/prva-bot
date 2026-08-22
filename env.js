import "dotenv/config";

export const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  TYPE_RATING_CHANNEL_ID,
  TYPE_RATING_EXAMINER_ROLE_ID,
  AIRCRAFT_SPOTLIGHT_CHANNEL_ID,
  STAFF_ROLE_ID,
  PILOT_APP_API_KEY,
  ADMIN_USER_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = process.env;

export const PORT = process.env.PORT || process.env.SERVER_PORT || "3000";

const required = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  STAFF_ROLE_ID
};

if (!TYPE_RATING_CHANNEL_ID) {
  console.warn(
    "TYPE_RATING_CHANNEL_ID is not set — the /typerating-request and /typerating-assign-examiner " +
      "HTTP endpoints will refuse every request until it is. Needs a plain text channel (not a " +
      "forum), since Type Rating threads are real private threads, which forum channels can't create."
  );
}

if (!TYPE_RATING_EXAMINER_ROLE_ID) {
  console.warn(
    "TYPE_RATING_EXAMINER_ROLE_ID is not set — new Type Rating requests will ping STAFF_ROLE_ID instead " +
      "(everything still works, just pings the wrong role)."
  );
}

if (!AIRCRAFT_SPOTLIGHT_CHANNEL_ID) {
  console.warn(
    "AIRCRAFT_SPOTLIGHT_CHANNEL_ID is not set — the /photo-approved HTTP endpoint will refuse every request " +
      "until it is (Top Shots approvals just won't post to Discord, everything else still works)."
  );
}

for (const [name, value] of Object.entries(required)) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Check your .env / host env settings.`);
    process.exit(1);
  }
}

if (!PILOT_APP_API_KEY) {
  console.warn(
    "PILOT_APP_API_KEY is not set — the /pilot-application HTTP endpoint will refuse every request until it is."
  );
}

if (!ADMIN_USER_ID) {
  console.warn(
    "ADMIN_USER_ID is not set — the Cloudflare Tunnel URL will only be logged to the console, not DMed to you."
  );
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not both set — checkride \"starting now\" reminders are " +
      "disabled (everything else still works). SUPABASE_SERVICE_ROLE_KEY is a real secret (bypasses RLS) -- " +
      "Project Settings -> API -> service_role key, set only here in the bot's own env, never in a website config."
  );
}
