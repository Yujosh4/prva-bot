// PRVA Mabuhay Miles bot
//
// Flow:
//   1. Staff runs /mm-setup once in the PUBLIC #mm-application channel. This posts a
//      ticket-style embed with two buttons: "Apply for Mabuhay Miles" and
//      "Upgrade Mabuhay Miles".
//   2. A pilot clicks one. The bot creates a new post in the #pilot-applications forum
//      channel, tagged "Mabuhay Miles", and pings the Staff role there.
//   3. Back in #mm-application, the bot replies (visible only to that pilot) confirming
//      the request was submitted, with a "Cancel Request" button.
//   4. If the pilot clicks Cancel, the bot posts a cancellation note in the forum thread
//      and archives it, so staff don't process a withdrawn request.
//   5. Staff verify the pilot's hours (in the Crew Center, once that exists), then click
//      Approve or Reject directly on the forum post. Either one posts a decision note in
//      the thread, removes the buttons, archives the thread, and DMs the pilot. Only
//      members with the Staff role (or Manage Server) can use these buttons.
//
// NOTE: Pilot Applications (from the website's Join Us form) and Type Rating requests are
// not wired up in this file yet — see the PRVA chat history / README for what's still
// pending clarification.

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
  ChannelType,
  MessageFlags
} from "discord.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID, PILOT_APPLICATIONS_FORUM_CHANNEL_ID, STAFF_ROLE_ID } = process.env;

for (const [name, value] of Object.entries({
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  PILOT_APPLICATIONS_FORUM_CHANNEL_ID,
  STAFF_ROLE_ID
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Check your .env / host env settings.`);
    process.exit(1);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const PRVA_RED = 0xc8102e;
const MM_TAG_NAME = "Mabuhay Miles";

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

function findTagId(forumChannel, name) {
  const tag = forumChannel.availableTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return tag ? tag.id : null;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  // Prints every forum's tags on startup — handy for grabbing tag IDs for the website's
  // webhook config (a plain webhook can't look tags up by name the way this bot can).
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
});

async function createMmForumPost(interaction, kind) {
  const forumChannel = await interaction.guild.channels.fetch(PILOT_APPLICATIONS_FORUM_CHANNEL_ID);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    throw new Error("PILOT_APPLICATIONS_FORUM_CHANNEL_ID isn't a forum channel.");
  }

  const tagId = findTagId(forumChannel, MM_TAG_NAME);
  const label = kind === "upgrade" ? "Mabuhay Miles Upgrade" : "Mabuhay Miles Application";

  const decisionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mm_approve_${interaction.user.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mm_reject_${interaction.user.id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );

  const thread = await forumChannel.threads.create({
    name: `${interaction.user.username} — ${label}`,
    appliedTags: tagId ? [tagId] : [],
    message: {
      content: `<@&${STAFF_ROLE_ID}> New ${label.toLowerCase()} from <@${interaction.user.id}>.`,
      embeds: [
        new EmbedBuilder()
          .setColor(PRVA_RED)
          .setDescription(
            `**Type:** ${label}\n**Pilot:** <@${interaction.user.id}> (${interaction.user.username})\n\n` +
              "Please verify their hours in the Crew Center before approving."
          )
      ],
      components: [decisionRow]
    }
  });

  return thread;
}

function isStaffMember(member) {
  if (!member) return false;
  const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
  const hasManage = member.permissions?.has?.(PermissionFlagsBits.ManageGuild);
  return Boolean(hasRole || hasManage);
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

    if (interaction.isButton() && (interaction.customId.startsWith("mm_approve_") || interaction.customId.startsWith("mm_reject_"))) {
      const isApprove = interaction.customId.startsWith("mm_approve_");
      const pilotId = interaction.customId.replace(isApprove ? "mm_approve_" : "mm_reject_", "");

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

      const pilotUser = await client.users.fetch(pilotId).catch(() => null);
      if (pilotUser) {
        const dmText = isApprove
          ? "Your Mabuhay Miles request has been approved! Check the server for your updated status."
          : "Your Mabuhay Miles request wasn't approved this time. Reach out to staff on Discord if you have questions.";
        await pilotUser.send(dmText).catch(() => {});
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

client.login(DISCORD_TOKEN);
