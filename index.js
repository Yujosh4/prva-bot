// PRVA bot
//
// Mabuhay Miles flow:
//   1. Staff runs /mm-setup once in the PUBLIC #mm-application channel. This posts a
//      ticket-style embed with two buttons: "Apply for Mabuhay Miles" and
//      "Upgrade Mabuhay Miles".
//   2. A pilot clicks one. The bot creates a new post in the #pilot-applications forum
//      channel, tagged "Mabuhay Miles", and pings the Staff role there.
//   3. Back in #mm-application, the bot replies (visible only to that pilot) confirming
//      the request was submitted, with a "Cancel Request" button.
//   4. If the pilot clicks Cancel, the bot posts a cancellation note in the forum thread
//      and archives it, so staff don't process a withdrawn request.
//
// Pilot Application flow:
//   The website's Join Us form POSTs to this bot's /pilot-application HTTP endpoint (see
//   server.js), which creates a forum post the same way, tagged "Pilot Application". There's
//   no verified Discord user id for these (the form only collects a free-text Discord
//   username), so decision buttons don't DM the applicant — see DECISION_COPY below.
//
// Both flows share one decision step: staff click Approve or Reject directly on the forum
// post. Either one posts a decision note in the thread, removes the buttons so it can't be
// double-processed, and archives the thread. Only members with the Staff role (or Manage
// Server) can use these buttons.
//
// Type Rating requests aren't wired up yet — deferred until the Crew Center exists.

import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from "discord.js";
import { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID, PILOT_APPLICATIONS_FORUM_CHANNEL_ID, STAFF_ROLE_ID } from "./env.js";
import { PRVA_RED, isStaffMember, buildDecisionRow, createForumThread } from "./forumPosts.js";
import { startPilotApplicationServer } from "./server.js";
import { startCloudflareTunnel } from "./tunnel.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const MM_TAG_NAME = "Mabuhay Miles";

const DECISION_COPY = {
  mm: {
    approve: "Your Mabuhay Miles request has been approved! Check the server for your updated status.",
    reject: "Your Mabuhay Miles request wasn't approved this time. Reach out to staff on Discord if you have questions."
  },
  pilot: {
    approve: "Your PRVA pilot application has been approved — welcome aboard! Check Discord for next steps.",
    reject: "Your PRVA pilot application wasn't approved this time. Feel free to reach out to staff on Discord if you have questions."
  }
};

const setupCommand = new SlashCommandBuilder()
  .setName("mm-setup")
  .setDescription("Post the Mabuhay Miles ticket buttons in this channel (staff only).")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, GUILD_ID), {
    body: [setupCommand.toJSON()]
  });
  console.log("Slash commands registered.");
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  // Prints every forum's tags on startup — handy for confirming tag names/ids line up.
  try {
    const forum = await c.channels.fetch(PILOT_APPLICATIONS_FORUM_CHANNEL_ID);
    if (forum?.availableTags) {
      console.log(
        "Available tags on #pilot-applications:",
        forum.availableTags.map((t) => `${t.name} = ${t.id}`).join(", ")
      );
    }
  } catch (err) {
    console.warn("Could not read forum tags on startup:", err.message);
  }
  await registerCommands();
  startCloudflareTunnel(c);
});

async function createMmForumPost(interaction, kind) {
  const label = kind === "upgrade" ? "Mabuhay Miles Upgrade" : "Mabuhay Miles Application";

  return createForumThread({
    client,
    tagName: MM_TAG_NAME,
    threadName: `${interaction.user.username} — ${label}`,
    pingContent: `<@&${STAFF_ROLE_ID}> New ${label.toLowerCase()} from <@${interaction.user.id}>.`,
    embed: new EmbedBuilder()
      .setColor(PRVA_RED)
      .setDescription(
        `**Type:** ${label}\n**Pilot:** <@${interaction.user.id}> (${interaction.user.username})\n\n` +
          "Please verify their hours in the Crew Center before approving."
      ),
    decisionRow: buildDecisionRow("mm", interaction.user.id)
  });
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "mm-setup") {
      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("Mabuhay Miles")
        .setDescription(
          "Ready to join the loyalty program, or eligible for the next tier? Pick an option below " +
            "and a staff member will follow up once your hours are verified."
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mm_apply").setLabel("Apply for Mabuhay Miles").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("mm_upgrade").setLabel("Upgrade Mabuhay Miles").setStyle(ButtonStyle.Secondary)
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: "Posted.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton() && (interaction.customId === "mm_apply" || interaction.customId === "mm_upgrade")) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const kind = interaction.customId === "mm_upgrade" ? "upgrade" : "apply";

      const thread = await createMmForumPost(interaction, kind);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`mm_cancel_${thread.id}`).setLabel("Cancel Request").setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({
        content:
          `Your ${kind === "upgrade" ? "upgrade" : "membership"} request has been submitted — staff will process it shortly. ` +
          "Changed your mind? Cancel it below.",
        components: [row]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith("mm_cancel_")) {
      const threadId = interaction.customId.replace("mm_cancel_", "");
      await interaction.deferUpdate();

      const thread = await interaction.guild.channels.fetch(threadId).catch(() => null);

      if (thread?.archived) {
        await interaction.editReply({
          content: "This request has already been handled by staff and can no longer be cancelled.",
          components: []
        });
        return;
      }

      if (thread) {
        const starterMessage = await thread.fetchStarterMessage().catch(() => null);
        if (starterMessage) await starterMessage.edit({ components: [] }).catch(() => {});

        await thread
          .send({
            embeds: [
              new EmbedBuilder()
                .setColor(0x60656e)
                .setDescription(`❌ Cancelled by <@${interaction.user.id}> before staff processed it.`)
            ]
          })
          .catch(() => {});
        await thread.setArchived(true).catch(() => {});
      }

      await interaction.editReply({
        content: "Your request has been cancelled.",
        components: []
      });
      return;
    }

    if (interaction.isButton() && (interaction.customId.startsWith("req_approve_") || interaction.customId.startsWith("req_reject_"))) {
      const isApprove = interaction.customId.startsWith("req_approve_");
      const rest = interaction.customId.replace(isApprove ? "req_approve_" : "req_reject_", "");
      const [kind, pilotId] = rest.split(/_(.+)/);

      if (!isStaffMember(interaction.member)) {
        await interaction.reply({ content: "Only staff can approve or reject requests.", flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.deferUpdate();

      const thread = interaction.channel;
      const decisionLabel = isApprove ? "Approved" : "Rejected";
      const decisionEmoji = isApprove ? "✅" : "❌";
      const decisionColor = isApprove ? 0x2ecc71 : 0xe74c3c;

      await interaction.message.edit({ components: [] }).catch(() => {});

      await thread
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(decisionColor)
              .setDescription(`${decisionEmoji} **${decisionLabel}** by <@${interaction.user.id}>.`)
          ]
        })
        .catch(() => {});

      await thread.setName(`${decisionEmoji} ${thread.name}`.slice(0, 100)).catch(() => {});
      await thread.setArchived(true).catch(() => {});

      if (pilotId && pilotId !== "none") {
        const pilotUser = await client.users.fetch(pilotId).catch(() => null);
        const dmText = DECISION_COPY[kind]?.[isApprove ? "approve" : "reject"];
        if (pilotUser && dmText) await pilotUser.send(dmText).catch(() => {});
      }
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong. Check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (interaction.isRepliable() && interaction.deferred) {
      await interaction.editReply("Something went wrong. Check the bot logs.").catch(() => {});
    }
  }
});

startPilotApplicationServer(client);
client.login(DISCORD_TOKEN);
