import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from "discord.js";
import { PILOT_APPLICATIONS_FORUM_CHANNEL_ID, STAFF_ROLE_ID } from "./env.js";

export const PRVA_RED = 0xc8102e;

export function findTagId(forumChannel, name) {
  const tag = forumChannel.availableTags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return tag ? tag.id : null;
}

export function isStaffMember(member) {
  if (!member) return false;
  const hasRole = member.roles?.cache?.has(STAFF_ROLE_ID);
  const hasManage = member.permissions?.has?.(PermissionFlagsBits.ManageGuild);
  return Boolean(hasRole || hasManage);
}

// kind identifies which flow a decision button belongs to ("mm" or "pilot"), so the shared
// InteractionCreate handler in index.js knows which DM copy to send. pilotId is "none" for
// flows where we don't have a verified Discord user id to DM (e.g. the website form, which
// only collects a free-text Discord username).
export function buildDecisionRow(kind, pilotId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`req_approve_${kind}_${pilotId}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`req_reject_${kind}_${pilotId}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

export async function getForumChannel(client) {
  const forumChannel = await client.channels.fetch(PILOT_APPLICATIONS_FORUM_CHANNEL_ID);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    throw new Error("PILOT_APPLICATIONS_FORUM_CHANNEL_ID isn't a forum channel.");
  }
  return forumChannel;
}

export async function createForumThread({ client, tagName, threadName, pingContent, embed, decisionRow }) {
  const forumChannel = await getForumChannel(client);
  const tagId = findTagId(forumChannel, tagName);

  const thread = await forumChannel.threads.create({
    name: threadName.slice(0, 100),
    appliedTags: tagId ? [tagId] : [],
    message: {
      content: pingContent,
      embeds: [embed],
      components: decisionRow ? [decisionRow] : []
    }
  });

  return thread;
}
