import "dotenv/config";

export const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  TYPE_RATING_CHANNEL_ID,
  STAFF_ROLE_ID,
  PILOT_APP_API_KEY,
  ADMIN_USER_ID
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
