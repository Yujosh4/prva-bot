// Small HTTP endpoint so the (static, backend-less) website can hand pilot applications to
// this bot instead of posting straight to a Discord webhook. Doing it this way means the
// forum post is bot-authored, so it can carry working Approve/Reject buttons — a plain
// webhook message can't, since there's no application listening for its button clicks.
//
// Heads up: PILOT_APP_API_KEY is NOT real security. It's read out of join.html's page
// source the same way the old webhook URL was, so anyone can see it. It only stops casual
// automated scanners from finding and hitting this endpoint by accident. The real backstop
// against abuse is the per-IP rate limit below, plus the fact that a spammy submission is
// just a forum post staff can delete — same exposure the plain webhook already had.

import express from "express";
import { EmbedBuilder } from "discord.js";
import { PORT, STAFF_ROLE_ID, PILOT_APP_API_KEY } from "./env.js";
import { PRVA_RED, buildDecisionRow, createForumThread } from "./forumPosts.js";

const PILOT_TAG_NAME = "Pilot Application";
const RATE_LIMIT_WINDOW_MS = 20_000;
const lastRequestByIp = new Map();

function clean(value, maxLength = 1000) {
  const str = (value ?? "").toString().trim();
  return str ? str.slice(0, maxLength) : "—";
}

// Prefers the link the pilot pasted in (so staff land on exactly the profile they meant,
// not one reconstructed from a possibly-mistyped username). Falls back to a constructed
// link only if the pasted one is missing or isn't actually an IFC profile URL.
function resolveIfProfileUrl(ifUsername, ifProfileLink) {
  if (ifProfileLink) {
    try {
      const parsed = new URL(ifProfileLink.toString().trim());
      if (parsed.hostname === "community.infiniteflight.com") return parsed.toString();
    } catch (err) {
      // not a valid URL — fall through to the constructed fallback
    }
  }
  return "https://community.infiniteflight.com/u/" + encodeURIComponent(clean(ifUsername, 100));
}

export function startPilotApplicationServer(client) {
  const app = express();
  app.use(express.json({ limit: "20kb" }));

  app.use((req, res, next) => {
    // CORS only gates browser JS reading the response, not whether the request runs — real
    // protection is the API key + rate limit below, not this header.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PRVA-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ ok: true, discordReady: client.isReady() });
  });

  app.post("/pilot-application", async (req, res) => {
    if (!PILOT_APP_API_KEY) {
      return res.status(503).json({ ok: false, error: "not_configured" });
    }
    if (req.headers["x-prva-key"] !== PILOT_APP_API_KEY) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
    const last = lastRequestByIp.get(ip) || 0;
    if (Date.now() - last < RATE_LIMIT_WINDOW_MS) {
      return res.status(429).json({ ok: false, error: "rate_limited" });
    }
    lastRequestByIp.set(ip, Date.now());

    if (!client.isReady()) {
      return res.status(503).json({ ok: false, error: "bot_not_ready" });
    }

    const { preferredName, pilotGrade, ifUsername, ifProfileLink, discordUsername, staffPosition, whyJoin } = req.body || {};
    if (!preferredName || !pilotGrade || !ifUsername || !discordUsername || !whyJoin) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    try {
      const ifProfileUrl = resolveIfProfileUrl(ifUsername, ifProfileLink);

      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("New Pilot Application")
        .addFields(
          { name: "Preferred Name", value: clean(preferredName, 100), inline: true },
          { name: "Pilot Grade", value: `Grade ${clean(pilotGrade, 20)}`, inline: true },
          { name: "IF Community Username", value: `[${clean(ifUsername, 100)}](${ifProfileUrl})`, inline: true },
          { name: "Discord Username", value: clean(discordUsername, 100), inline: true },
          { name: "Interested Staff Position", value: clean(staffPosition || "None — pilot only", 100), inline: true },
          { name: "Why do you want to join PRVA?", value: clean(whyJoin, 1000), inline: false }
        )
        .setTimestamp(new Date());

      const thread = await createForumThread({
        client,
        tagName: PILOT_TAG_NAME,
        threadName: `${clean(preferredName, 60)} — Pilot Application`,
        pingContent: `<@&${STAFF_ROLE_ID}> New pilot application from **${clean(preferredName, 100)}** (Discord: ${clean(discordUsername, 100)}).`,
        embed,
        decisionRow: buildDecisionRow("pilot", "none")
      });

      res.json({ ok: true, threadId: thread.id });
    } catch (err) {
      console.error("Failed to create pilot application thread:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.listen(PORT, () => {
    console.log(`Pilot application HTTP server listening on port ${PORT}.`);
  });
}
