import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { SESSION_BANNER_URL, SESSION_FOOTER_IMAGE_URL, SESSION_JOIN_CODE, MEDIA_RELAY_EMOJI } from "./config.js";

function bannerGallery(): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(SESSION_BANNER_URL));
}

function footerGallery(): MediaGalleryBuilder {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(SESSION_FOOTER_IMAGE_URL));
}

function sep(spacing?: 1 | 2, divider?: boolean): SeparatorBuilder {
  const s = new SeparatorBuilder();
  if (spacing !== undefined) s.setSpacing(spacing === 2 ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
  if (divider !== undefined) s.setDivider(divider);
  return s;
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

// Components V2 top-level message payload — flags/components only, matching containerMessage's
// shape in ui.ts so callers can pass this straight to channel.send()/interaction.reply() with no
// cast needed at the call site (discord.js's send/reply overloads accept this shape directly, the
// same way they already accept containerMessage's output elsewhere in this codebase).
type TopLevelComponent = ContainerBuilder | TextDisplayBuilder;

interface ComponentsV2Payload {
  flags: number;
  components: TopLevelComponent[];
}

function payload(components: TopLevelComponent[]): ComponentsV2Payload {
  return { flags: MessageFlags.IsComponentsV2, components };
}

// ---------------------------------------------------------------------------------------------
// 1. /sessionpanel — the persistent, live-updating panel. Player/staff/queue counts passed in
// fresh each time this is built (used both for the initial send and every 15s edit after).
// ---------------------------------------------------------------------------------------------
export interface SessionPanelStats {
  players: number;
  staff: number;
  queue: number | null;
  privateServerName: string;
  privateServerOwner: string;
  joinCode: string;
}

function statSection(label: string, sublabel: string, buttonLabel: string): SectionBuilder {
  return new SectionBuilder()
    .addTextDisplayComponents(text(`\n**${label}**\n-# ${sublabel}`))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(`session_stat_${label.replace(/\s+/g, "_").toLowerCase()}`)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
    );
}

export function buildSessionPanel(stats: SessionPanelStats) {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(bannerGallery())
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Delta Roleplay Sessions\n\n> Here at **Delta Roleplay**, we use a session management " +
          "based system for highest quality roleplay. Sessions are announced in this channel when " +
          "our team decides to host one. A vote will be cast for attendees.",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        `## Server Information\nPrivate Server Name: \`\`\`${stats.privateServerName}\`\`\`\n` +
          `Private Server Owner: \`\`\`${stats.privateServerOwner}\`\`\`\nServer Join Code: \`\`\`${stats.joinCode}\`\`\``,
      ),
    )
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(text("## Server Statistics\n"))
    .addSectionComponents(statSection("Ingame Players", "The number of players actively ingame", `${stats.players} Players`))
    .addSectionComponents(statSection("Ingame Staff", "The number of staff currently moderating", `${stats.staff} Staff`))
    .addSectionComponents(
      statSection("Server Queue", "The number of players waiting to join", `${stats.queue ?? "?"} Queue`),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

// ---------------------------------------------------------------------------------------------
// 2. /sessionstart — the vote panel. Pings @here + the session role as a plain top-level text
// component alongside the container (Components V2 messages can have multiple top-level items).
// ---------------------------------------------------------------------------------------------
export function buildSessionVotePanel(pingRoleId: string) {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(bannerGallery())
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Session Vote\n> Our team has decided to hold a session vote, to capture the " +
          "**Delta Roleplay Community**'s current availability to join ingame. Click the button below to cast your vote.",
      ),
    )
    .addSeparatorComponents(sep(undefined, false))
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("session_cast_vote").setLabel("Cast Vote").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("session_list_voters")
          .setLabel("List Current Voters")
          .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([text(`@here | <@&${pingRoleId}>`), container]);
}

// ---------------------------------------------------------------------------------------------
// 3. Session Start-up — sent once the vote threshold is reached. voterIds get tagged in a
// top-level text component below the container.
// ---------------------------------------------------------------------------------------------
export function buildSessionStartupPanel(serverName: string, voterIds: string[]) {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(bannerGallery())
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Session Start-up\nThe server is now **open** and the **session is officially active.** " +
          "You may now join and begin roleplay. Please adhere to all server rules, remain in **VC as " +
          "required,** and maintain realistic interactions. Enjoy, **Delta.**\n### Server Details\n" +
          `> **Code:** \`${SESSION_JOIN_CODE}\`\n> **Server Name:** \`${serverName}\``,
      ),
    )
    .addSeparatorComponents(sep(undefined, false))
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("Quick Join Ingame")
          .setStyle(ButtonStyle.Link)
          .setURL(`https://erlc.gg/join/${SESSION_JOIN_CODE}`),
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  const mentions = voterIds.map((id) => `<@${id}>`).join(" ");
  return payload([
    container,
    text(`- **All users who voted should make sure to attend the session.** ${mentions}`),
  ]);
}

// ---------------------------------------------------------------------------------------------
// 4. Full capacity reached — "Thank You, Delta!"
// ---------------------------------------------------------------------------------------------
export function buildSessionFullPanel(reportedAtUnixSeconds: number) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(`## Thank You, Delta!\nOur session has been reported **full** as of <t:${reportedAtUnixSeconds}:R>`),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

// ---------------------------------------------------------------------------------------------
// 5. Session Shutdown Notification — sent after /sessiondown's kick-and-purge sequence.
// ---------------------------------------------------------------------------------------------
export function buildSessionShutdownPanel() {
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(bannerGallery())
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Session Shutdown Notification\n\n> You are no longer allowed to join the in-game " +
          "server, and you will be moderated if you are caught doing so. You will receive a " +
          "notification when the next session is hosted via this channel.",
      ),
    )
    .addSeparatorComponents(sep(undefined, false))
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("session_notification_toggle")
          .setLabel("Session Notification")
          .setStyle(ButtonStyle.Secondary),
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

// ---------------------------------------------------------------------------------------------
// 6. Verification log embed — replaces the old plain-text server-management log line.
// ---------------------------------------------------------------------------------------------
export interface VerificationRundown {
  roleAssignment: boolean;
  directMessage: boolean;
  discordInfoFetch: boolean;
  robloxInfoFetch: boolean;
}

function mark(ok: boolean): string {
  return ok ? "■" : "□";
}

export function buildVerificationLogEmbed(params: {
  code: string;
  discordId: string;
  discordUsername: string;
  robloxUsername: string;
  robloxUserId: string;
  rundown: VerificationRundown;
  verifiedAtUnixSeconds: number;
}) {
  const { code, discordId, discordUsername, robloxUsername, robloxUserId, rundown, verifiedAtUnixSeconds } = params;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text("# New Verification"))
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        `A user just completed our ingame verification with the code **${code}**. They were ` +
          "assigned the role **Community Member** and **Verified**, removing the role **Unverified**.",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "## Verification Information\n\n" +
          `**Discord Username**\n-# <@${discordId}> | **${discordUsername}**\n\n` +
          `**Roblox Username**\n-# **${robloxUsername}** | [Click Me](https://www.roblox.com/users/${robloxUserId}/profile)\n\n` +
          "**Rundown**\n-# ■ = Complete | □ = Failed\n\n" +
          `> -# ${mark(rundown.roleAssignment)} Role assignment\n` +
          `> -# ${mark(rundown.directMessage)} Direct message\n` +
          `> -# ${mark(rundown.discordInfoFetch)} Discord Info Fetch\n` +
          `> -# ${mark(rundown.robloxInfoFetch)} Roblox Info Fetch`,
      ),
    )
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(text(`Verified At: <t:${verifiedAtUnixSeconds}:R>`))
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

// ---------------------------------------------------------------------------------------------
// 7. !media relay — reposts an attached image with the poster's mention + camera emoji.
// ---------------------------------------------------------------------------------------------
export function buildMediaRelayEmbed(authorDiscordId: string, imageUrl: string) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(text(`${MEDIA_RELAY_EMOJI} <@${authorDiscordId}>`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));

  return payload([container]);
}
