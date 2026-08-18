// PRVA Mabuhay Miles bot
//
// Flow:
//   1. Staff runs /mm-setup once in whatever channel pilots should see the
//      "Request Mabuhay Miles Account" button (e.g. #crew-center or #bot-commands).
//   2. A pilot clicks the button. The bot creates a new post in the staff-only
//      #mm-application forum channel, adds that pilot as a member of just that
//      one thread (so it reads as private to them even though the forum itself
//      is hidden from the @everyone / pilot role), and pings the Staff role.
//   3. Inside the thread, staff use the Approve / Reject buttons. Approving
//      posts a message that mentions the pilot so they get notified. Staff
//      still do the actual Crew Center work (granting the member card, etc.)
//      themselves — this bot only handles the request/notify flow.

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

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID, MM_FORUM_CHANNEL_ID, STAFF_ROLE_ID } = process.env;

for (const [name, value] of Object.entries({
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  GUILD_ID,
  MM_FORUM_CHANNEL_ID,
  STAFF_ROLE_ID
})) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Check your .env / host env settings.`);
    process.exit(1);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const PRVA_RED = 0xc8102e;

const setupCommand = new SlashCommandBuilder()
  .setName("mm-setup")
  .setDescription("Post the Mabuhay Miles application button in this channel (staff only).")
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
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "mm-setup") {
      const embed = new EmbedBuilder()
        .setColor(PRVA_RED)
        .setTitle("Mabuhay Miles")
        .setDescription(
          "Reached 500 hours? Request your Mabuhay Miles membership below and a staff member " +
            "will verify your hours and get your card set up."
        );
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("mm_request").setLabel("Request Mabuhay Miles Account").setStyle(ButtonStyle.Danger)
      );
      await interaction.channel.send({ embeds: [embed], components: [row] });
      await interaction.reply({ content: "Posted.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton() && interaction.customId === "mm_request") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const forumChannel = await interaction.guild.channels.fetch(MM_FORUM_CHANNEL_ID);
      if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
        await interaction.editReply("Setup problem: MM_FORUM_CHANNEL_ID isn't a forum channel. Ask a dev to check the bot config.");
        return;
      }

      const pendingTagId = findTagId(forumChannel, "Pending");

      const thread = await forumChannel.threads.create({
        name: `${interaction.user.username} — Mabuhay Miles`,
        appliedTags: pendingTagId ? [pendingTagId] : [],
        message: {
          content:
            `<@&${STAFF_ROLE_ID}> New Mabuhay Miles request from <@${interaction.user.id}>.\n\n` +
            "Please verify they've crossed 500 hours before approving.",
          embeds: [
            new EmbedBuilder()
              .setColor(PRVA_RED)
              .setDescription(
                `Hi <@${interaction.user.id}>! Your Mabuhay Miles request has been received. ` +
                  "A staff member will process it shortly and check that you meet the minimum requirements."
              )
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId("mm_approve").setLabel("Approve").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId("mm_reject").setLabel("Reject").setStyle(ButtonStyle.Secondary)
            )
          ]
        }
      });

      // Forum channel is staff-only; explicitly add the requester to just this thread.
      await thread.members.add(interaction.user.id);

      await interaction.editReply(`Request submitted! Staff will follow up in <#${thread.id}>.`);
      return;
    }

    if (interaction.isButton() && (interaction.customId === "mm_approve" || interaction.customId === "mm_reject")) {
      const isStaff = interaction.member.roles.cache.has(STAFF_ROLE_ID);
      if (!isStaff) {
        await interaction.reply({ content: "Only staff can do that.", flags: MessageFlags.Ephemeral });
        return;
      }

      const thread = interaction.channel;
      const forumChannel = thread.parent;
      const approved = interaction.customId === "mm_approve";

      if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
        const tagId = findTagId(forumChannel, approved ? "Approved" : "Rejected");
        const pendingTagId = findTagId(forumChannel, "Pending");
        const currentTags = thread.appliedTags.filter((t) => t !== pendingTagId);
        await thread.setAppliedTags(tagId ? [...currentTags, tagId] : currentTags).catch(() => {});
      }

      // Pull the original requester back out of the thread starter message mention.
      const starter = await thread.fetchStarterMessage().catch(() => null);
      const mentionedId = starter?.mentions?.users?.first()?.id;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(approved ? 0x2f7d4f : 0x60656e)
            .setDescription(
              approved
                ? `✅ ${mentionedId ? `<@${mentionedId}>` : "Pilot"} — your Mabuhay Miles membership has been **approved**! Welcome aboard.`
                : `${mentionedId ? `<@${mentionedId}>` : "Pilot"} — your Mabuhay Miles request was not approved at this time. Reach out to staff with any questions.`
            )
        ]
      });

      if (approved) {
        await thread.setName(`✅ ${thread.name.replace(/^✅ /, "")}`).catch(() => {});
      }
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong. Check the bot logs.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
