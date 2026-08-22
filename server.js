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
import { ChannelType, EmbedBuilder } from "discord.js";
import { PORT, STAFF_ROLE_ID, PILOT_APP_API_KEY, TYPE_RATING_CHANNEL_ID } from "./env.js";
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

  // Type Rating requests, called directly from the Crew Center the same
  // way join.html calls /pilot-application above -- but this one creates
  // a real PRIVATE thread (ChannelType.PrivateThread) on a plain text
  // channel rather than a forum post, since the pilot+examiner
  // conversation here shouldn't be visible to everyone who can see
  // #pilot-applications. invitable: false means only staff (Manage
  // Threads permission) can add further members -- the examiner gets
  // added explicitly via /typerating-assign-examiner below, not by the
  // pilot inviting them.
  app.post("/typerating-request", async (req, res) => {
    if (!PILOT_APP_API_KEY) return res.status(503).json({ ok: false, error: "not_configured" });
    if (req.headers["x-prva-key"] !== PILOT_APP_API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });

    const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown").trim();
    const last = lastRequestByIp.get("tr_" + ip) || 0;
    if (Date.now() - last < RATE_LIMIT_WINDOW_MS) return res.status(429).json({ ok: false, error: "rate_limited" });
    lastRequestByIp.set("tr_" + ip, Date.now());

    if (!client.isReady()) return res.status(503).json({ ok: false, error: "bot_not_ready" });
    if (!TYPE_RATING_CHANNEL_ID) return res.status(503).json({ ok: false, error: "not_configured" });

    const { pilotName, pilotDiscordId, aircraftIcao, aircraftName, rankName, totalHours, ifcUsername } = req.body || {};
    if (!pilotDiscordId || !aircraftIcao) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    try {
      const channel = await client.channels.fetch(TYPE_RATING_CHANNEL_ID);
      if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
        return res.status(500).json({ ok: false, error: "channel_not_text" });
      }

      const thread = await channel.threads.create({
        name: `${clean(pilotName, 40)} — ${clean(aircraftIcao, 10)} Type Rating`.slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: "Type Rating request"
      });

      await thread.members.add(pilotDiscordId).catch((err) => {
        console.warn("Could not add pilot to Type Rating thread (wrong/invalid Discord id?):", err.message);
      });

      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("Type Rating Request")
        .addFields(
          { name: "Pilot", value: `<@${pilotDiscordId}> (${clean(pilotName, 100)})`, inline: true },
          { name: "IFC Username", value: clean(ifcUsername, 100), inline: true },
          { name: "Rank", value: clean(rankName, 60), inline: true },
          { name: "Total Hours", value: clean(totalHours != null ? String(totalHours) : null, 20), inline: true },
          { name: "Aircraft", value: `${clean(aircraftIcao, 10)} — ${clean(aircraftName, 80)}`, inline: true }
        )
        .setTimestamp(new Date());

      await thread.send({
        content: `<@&${STAFF_ROLE_ID}> New Type Rating request from <@${pilotDiscordId}>.`,
        embeds: [embed]
      });

      res.json({ ok: true, threadId: thread.id });
    } catch (err) {
      console.error("Failed to create Type Rating thread:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Adds the assigned checkride examiner to an already-created Type
  // Rating thread. Called from the Crew Center's staff admin page right
  // after "Assign Examiner" is pressed there -- the actual assignment
  // record lives in Supabase (pilot_type_ratings.examiner_discord_id),
  // this just gets the examiner into the conversation and posts a card
  // about who they are, since a bare Discord ID/mention tells the pilot
  // nothing about who's about to check them out. examinerName/
  // examinerIfc/examinerPosition are all required -- staff types them in
  // by hand at assign time (there's no table linking a Discord ID to an
  // IFC username or VA position), so this is the only way the card gets
  // real info instead of a bare mention.
  app.post("/typerating-assign-examiner", async (req, res) => {
    if (!PILOT_APP_API_KEY) return res.status(503).json({ ok: false, error: "not_configured" });
    if (req.headers["x-prva-key"] !== PILOT_APP_API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!client.isReady()) return res.status(503).json({ ok: false, error: "bot_not_ready" });

    const { threadId, examinerDiscordId, examinerName, examinerIfc, examinerPosition } = req.body || {};
    if (!threadId || !examinerDiscordId || !examinerName || !examinerIfc || !examinerPosition) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    try {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread || !thread.isThread()) {
        return res.status(404).json({ ok: false, error: "thread_not_found" });
      }

      // Doesn't throw on a bad/non-member id (mistyped, or someone who
      // hasn't shared a server with the bot) -- staff can always add them
      // manually in Discord, and the assignment itself already went
      // through in the Crew Center regardless of whether this succeeds.
      // The failure reason is surfaced (in the response and the thread
      // message, not just the server console) since a Wispbyte deploy
      // doesn't have console access handy for diagnosing this remotely.
      let addResult = true;
      let addError = null;
      try {
        await thread.members.add(examinerDiscordId);
      } catch (err) {
        addResult = false;
        addError = err?.rawError?.message || err?.message || "unknown error";
        console.warn("Could not add examiner to Type Rating thread:", addError);
      }

      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("Checkride Examiner Assigned")
        .setDescription(
          `<@${examinerDiscordId}> has been assigned as the checkride examiner for this request. ` +
            "Coordinate a date/time here (all checkrides fly on **Training Server**)."
        )
        .addFields(
          { name: "Examiner", value: clean(examinerName, 100), inline: true },
          { name: "IFC Username", value: clean(examinerIfc, 100), inline: true },
          { name: "Position", value: clean(examinerPosition, 100), inline: true }
        )
        .setTimestamp(new Date());

      if (!addResult) {
        embed.addFields({
          name: "⚠️ Couldn't add to thread automatically",
          value: `Discord said: "${addError}". Check the ID is correct and that they're in this server, or add them manually.`,
          inline: false,
        });
      }

      await thread.send({ content: `<@${examinerDiscordId}>`, embeds: [embed] });

      res.json({ ok: true, memberAdded: addResult, addError });
    } catch (err) {
      console.error("Failed to add examiner to Type Rating thread:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  // Posts the confirmed checkride date/time/server to the thread and
  // pings both the pilot and examiner, since setting a schedule in the
  // Crew Center previously left them with no notification at all -- the
  // schedule only existed on the staff side until someone checked back.
  app.post("/typerating-schedule", async (req, res) => {
    if (!PILOT_APP_API_KEY) return res.status(503).json({ ok: false, error: "not_configured" });
    if (req.headers["x-prva-key"] !== PILOT_APP_API_KEY) return res.status(401).json({ ok: false, error: "unauthorized" });
    if (!client.isReady()) return res.status(503).json({ ok: false, error: "bot_not_ready" });

    const {
      threadId, pilotDiscordId, examinerDiscordId, pilotName, examinerName, examinerPosition,
      aircraftIcao, aircraftName, scheduledDate, scheduledTime,
    } = req.body || {};
    if (!threadId || !pilotDiscordId || !examinerDiscordId || !scheduledDate) {
      return res.status(400).json({ ok: false, error: "missing_fields" });
    }

    try {
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread || !thread.isThread()) {
        return res.status(404).json({ ok: false, error: "thread_not_found" });
      }

      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("Checkride Scheduled")
        .addFields(
          { name: "Aircraft", value: `${clean(aircraftIcao, 10)} — ${clean(aircraftName, 80)}`, inline: true },
          { name: "Server", value: "Training Server", inline: true },
          { name: "Date", value: clean(scheduledDate, 20), inline: true },
          { name: "Time", value: clean(scheduledTime, 20), inline: true },
          { name: "Pilot", value: `<@${pilotDiscordId}> (${clean(pilotName, 100)})`, inline: true },
          {
            name: "Examiner",
            value: `<@${examinerDiscordId}> (${clean(examinerName, 100)})${examinerPosition ? ` — ${clean(examinerPosition, 60)}` : ""}`,
            inline: true,
          }
        )
        .setTimestamp(new Date());

      await thread.send({
        content: `<@${pilotDiscordId}> <@${examinerDiscordId}> your checkride has been scheduled — see the details below.`,
        embeds: [embed],
      });

      res.json({ ok: true });
    } catch (err) {
      console.error("Failed to post Type Rating schedule:", err);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  });

  app.listen(PORT, () => {
    console.log(`Pilot application HTTP server listening on port ${PORT}.`);
  });
}
