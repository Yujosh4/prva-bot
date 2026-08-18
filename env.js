import "dotenv/config";

export const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  STAFF_ROLE_ID,
  PILOT_APP_API_KEY
} = process.env;

export const PORT = process.env.PORT || process.env.SERVER_PORT || "3000";

const required = {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  STAFF_ROLE_ID
};

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
