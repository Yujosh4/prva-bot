// Gives the /pilot-application endpoint a real https:// URL via a Cloudflare quick tunnel,
// so the live (https) website isn't blocked from calling it as "mixed content." Runs as a
// child process of this same Node process — no extra process for the host to manage, and
// since cloudflared connects outbound to Cloudflare's edge (like the Discord gateway
// connection already does), it works even if PORT isn't itself publicly reachable.
//
// Trade-off: without a Cloudflare account + owned domain, this is a "quick tunnel" — the
// public hostname is randomly generated and changes every time the bot restarts. We DM
// ADMIN_USER_ID (if set) with the fresh URL each time so it doesn't require digging through
// host console logs. If join.html's PILOT_APP_API_URL ever goes stale, requests to it just
// fail and the website falls back to the plain webhook automatically — nothing breaks.

import { Tunnel } from "cloudflared";
import { PORT, ADMIN_USER_ID } from "./env.js";

const RESTART_DELAY_MS = 5000;

export function startCloudflareTunnel(client) {
  const localUrl = `http://localhost:${PORT}`;
  const tunnel = Tunnel.quick(localUrl);

  tunnel.on("url", async (url) => {
    const endpoint = `${url}/pilot-application`;
    console.log(`Cloudflare Tunnel ready. Pilot Application endpoint: ${endpoint}`);
    console.log("Paste this into Website/join.html as PILOT_APP_API_URL.");

    if (ADMIN_USER_ID) {
      try {
        const user = await client.users.fetch(ADMIN_USER_ID);
        await user.send(
          `Cloudflare Tunnel (re)started. New Pilot Application endpoint:\n\`${endpoint}\`\n\n` +
            "Paste this into Website/join.html as PILOT_APP_API_URL and push. " +
            "Until you do, applications keep working via the webhook fallback (no buttons)."
        );
      } catch (err) {
        console.warn("Could not DM ADMIN_USER_ID with the tunnel URL:", err.message);
      }
    }
  });

  tunnel.on("error", (err) => {
    console.error("Cloudflare Tunnel error:", err?.message || err);
  });

  tunnel.on("exit", (code, signal) => {
    console.warn(`Cloudflare Tunnel process exited (code ${code}, signal ${signal}). Restarting in ${RESTART_DELAY_MS / 1000}s...`);
    setTimeout(() => startCloudflareTunnel(client), RESTART_DELAY_MS);
  });

  return tunnel;
}
