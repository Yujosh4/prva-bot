// Polls Supabase every minute for Type Rating checkrides whose
// scheduled_at instant has arrived, and pings both the pilot and
// examiner in their private thread. This has to be a poll, not a
// setTimeout scheduled when the checkride is booked, because a Wispbyte
// redeploy kills any in-memory timer -- polling against the DB's own
// scheduled_at/reminder_sent_at state means a restart just resumes where
// it left off (and fires any reminder it missed while it was down)
// instead of silently dropping it. See sql/053_typerating_reminders.sql.
import { createClient } from "@supabase/supabase-js";
import { EmbedBuilder } from "discord.js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "./env.js";
import { PRVA_RED } from "./forumPosts.js";

const POLL_INTERVAL_MS = 60_000;

export function startCheckrideReminderLoop(client) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  async function sendReminder(row) {
    if (row.discord_thread_id) {
      const thread = await client.channels.fetch(row.discord_thread_id).catch(() => null);
      if (thread?.isThread()) {
        const aircraft = row.aircraft_types || {};
        const embed = new EmbedBuilder()
          .setColor(PRVA_RED)
          .setTitle("🛫 Checkride Starting Now")
          .setDescription(
            `Your checkride for **${aircraft.icao_type ?? "?"} — ${aircraft.name ?? ""}** is starting now on **Training Server**.`
          )
          .setTimestamp(new Date());
        await thread.send({
          content: `<@${row.discord_user_id}> <@${row.examiner_discord_id}> time to fly — your checkride is starting now.`,
          embeds: [embed]
        });
      }
    }
    // Marked after a successful send attempt (not before) -- if fetching
    // the thread or sending throws, this is skipped and the row stays
    // eligible, so the next poll just retries instead of silently losing
    // the reminder.
    await supabase.from("pilot_type_ratings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", row.id);
  }

  async function tick() {
    try {
      const { data, error } = await supabase
        .from("pilot_type_ratings")
        .select("id, discord_thread_id, discord_user_id, examiner_discord_id, aircraft_types(icao_type, name)")
        .eq("status", "scheduled")
        .not("scheduled_at", "is", null)
        .is("reminder_sent_at", null)
        .lte("scheduled_at", new Date().toISOString());

      if (error) {
        console.error("Checkride reminder poll failed:", error.message);
      } else {
        for (const row of data || []) {
          await sendReminder(row).catch((err) => console.error("Failed to send checkride reminder:", err));
        }
      }
    } catch (err) {
      console.error("Checkride reminder loop error:", err);
    } finally {
      // Rescheduled only after the previous run fully finishes, so a slow
      // tick can't overlap the next one and double-send anything.
      setTimeout(tick, POLL_INTERVAL_MS);
    }
  }

  tick();
}
