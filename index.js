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
//   5. Staff verify the pilot's hours (in the Crew Center, once that exists) and handle
//      the actual membership card themselves — this bot only handles the request/notify
//      flow, not the Crew Center side.
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
      ]
    }
  });

  return thread;
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
      if (thread) {
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
