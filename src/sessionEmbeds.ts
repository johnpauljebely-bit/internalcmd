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
import {
  SESSION_BANNER_URL,
  SESSION_FOOTER_IMAGE_URL,
  SESSION_JOIN_CODE,
  MEDIA_RELAY_EMOJI,
  WELCOME_MEMBERCOUNT_EMOJI,
  WELCOME_DASHBOARD_URL,
  DASHBOARD_BANNER_URL,
} from "./config.js";

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
type TopLevelComponent = ContainerBuilder | TextDisplayBuilder | ActionRowBuilder<ButtonBuilder>;

interface ComponentsV2Payload {
  flags: number;
  components: TopLevelComponent[];
}

function payload(components: TopLevelComponent[], ephemeral = false): ComponentsV2Payload {
  return {
    flags: ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    components,
  };
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

// ---------------------------------------------------------------------------------------------
// 8. Welcome message on join — no Container wrapper this time, matches the exact top-level
// [TextDisplay, ActionRow] shape given (unlike every other panel here, which wraps in Container).
// ---------------------------------------------------------------------------------------------
// Short phrases that read naturally directly before ", <@userid>!" — per the user's own example
// ("Hola! Glad to see you"). Kept short and varied rather than a single fixed greeting.
const WELCOME_GREETINGS = [
  "Welcome",
  "Hola! Glad to see you",
  "Hey there",
  "Great to see you",
  "Glad to have you here",
  "Howdy",
  "Welcome aboard",
  "Good to see you",
];

function randomGreeting(): string {
  return WELCOME_GREETINGS[Math.floor(Math.random() * WELCOME_GREETINGS.length)];
}

export function buildWelcomeMessage(newMemberId: string, memberCount: number) {
  const textDisplay = text(
    `${randomGreeting()}, <@${newMemberId}>! Enjoy *Vancouver's* best roleplay.\n` +
      "-# To roleplay, check <#1535866584604872775>. For LEO, visit <#1535866584881438839>.",
  );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("welcome_member_count")
      .setLabel(`${memberCount} Members`)
      .setEmoji(WELCOME_MEMBERCOUNT_EMOJI)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder().setLabel("Dashboard").setStyle(ButtonStyle.Link).setURL(WELCOME_DASHBOARD_URL),
  );

  return payload([textDisplay, buttons]);
}

// ---------------------------------------------------------------------------------------------
// 9. !dashboard — the community rules hub. Two Section rows (Discord/Roblox) with button
// accessories; clicking either replies with the matching ephemeral rules panel.
// ---------------------------------------------------------------------------------------------
export function buildDashboardPanel() {
  // Both sections use identical body text in the user's own spec (only the button labels differ,
  // "Discord" vs "Roblox") — kept exactly as given rather than assuming it's a copy-paste mistake
  // the way the earlier Queue-button "Staff" label clearly was; here the text is generic enough
  // that duplicating it plausibly IS intentional.
  const sectionText = "**Discord Guidelines**\n-# Rules to follow for **everyone** in our community";

  const container = new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(DASHBOARD_BANNER_URL)))
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Delta Roleplay Community\n> Joining this server means you're accepting every rule " +
          "outlined below, plus the common-sense clause for situations these rules don't directly " +
          "address. **Moderation action can be taken by staff at their discretion, at any time.**",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(sectionText))
        .setButtonAccessory(
          new ButtonBuilder().setCustomId("dashboard_discord_rules").setLabel("Discord").setStyle(ButtonStyle.Secondary),
        ),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(sectionText))
        .setButtonAccessory(
          new ButtonBuilder().setCustomId("dashboard_roblox_rules").setLabel("Roblox").setStyle(ButtonStyle.Secondary),
        ),
    )
    .addSeparatorComponents(sep(2, true))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

export function buildDiscordRulesEmbed() {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(
        "# Delta Roleplay — Discord Server Rules\n\n" +
          "### 1. Nickname & Callsign Format\n" +
          "- On-duty department members must set their nickname to: `Callsign | ROBLOX Username` (e.g. `104 | ExampleUser`)\n" +
          "- Do not display a rank, callsign, or department tag you have not actually earned or been assigned.\n\n" +
          "### 2. Voice Chat Requirement\n" +
          "- This server operates on a VC-required basis for roleplay.\n" +
          "- If you're actively involved in a scene, you must be connected to the correct voice channel with your microphone working.\n" +
          "- Sitting muted or deafened to dodge communication during roleplay is not allowed.\n\n" +
          "### 3. Respect & Conduct\n" +
          "- Treat every member — regardless of rank — with basic respect.\n" +
          "- Staff instructions should be followed; if you disagree, take it to a ticket rather than arguing in chat.\n" +
          "- Harassment, deliberate provocation (\"baiting\"), and public drama/hostility are not tolerated.\n\n" +
          "### 4. Prohibited Content\n" +
          "- No pornographic, sexual, nude, or graphically violent material of any kind.\n" +
          "- This covers images, GIFs, audio clips, custom emojis, decals, avatars, and shared links.\n\n" +
          "### 5. Mentions & Pings\n" +
          "- Don't ping High Ranks or staff members unless it's genuinely necessary.\n" +
          "- Support and management issues go through the ticket system unless a staff member says otherwise.\n\n" +
          "### 6. Channel Etiquette\n" +
          "- Each channel has a specific purpose — keep discussion relevant to it.\n" +
          "- Off-topic chatter, spam, or posting support requests in the wrong place isn't allowed.\n" +
          "- Flooding channels with repeated messages, reaction spam, or copy-pasted content counts as spam.\n\n" +
          "### 7. Handling Disputes\n" +
          "- Punishments and staff calls are not to be debated in public channels.\n" +
          "- Use the appeal/ticket process if you believe a decision was wrong.\n\n" +
          "### 8. Outside Advertising\n" +
          "- Promoting other servers, communities, groups, or services requires staff permission first.\n\n" +
          "### 9. General Conduct Clause\n" +
          "- Staff reserve the right to act on any behavior that disrupts the server or harms the community, even if it isn't explicitly listed above.",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container], true);
}

// NOTE: rule #9 cuts off mid-sentence in the user's own spec ("Don't disconnect, reset your
// character," and nothing after) — shipped verbatim rather than guessing how it ends. Flag this
// to finish the sentence once the rest of the text is available.
export function buildRobloxRulesEmbed() {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(
        "# Delta Roleplay — Roleplay Rules\n\n" +
          "### 1. Deathmatching (RDM)\n" +
          "- You need a valid, escalated in-character reason before attacking, injuring, or killing another player.\n" +
          "- The level of force used has to match what's actually happening in the scene.\n\n" +
          "### 2. Vehicle-Based Deathmatching (VDM)\n" +
          "- Vehicles can't be used as weapons without proper in-character justification.\n" +
          "- No unrealistic ramming, mowing people down, or wrecking vehicles just to end a scene in your favor.\n\n" +
          "### 3. Fail Roleplay (FRP)\n" +
          "- Play out your injuries, restraints, age, and physical limitations realistically.\n" +
          "- Don't magically produce items out of nowhere or ignore things like being cuffed or shot.\n\n" +
          "### 4. No Intent to Roleplay (NITRP)\n" +
          "- Don't join scenes purely to troll, farm reactions, or manufacture chaos.\n" +
          "- Every scene should be driven by a believable character motive.\n\n" +
          "### 5. Low-Effort / Passive Roleplay\n" +
          "- Keep scenes grounded and realistic — avoid pointless shootouts or manufactured chaos for its own sake.\n" +
          "- Don't force priority situations without real justification.\n\n" +
          "### 6. Realistic Driving\n" +
          "- Drive in a way that fits the vehicle, road conditions, and situation.\n" +
          "- No reckless \"GTA-style\" driving, deliberate wrong-way driving, or unnecessary off-roading.\n\n" +
          "### 7. Character Appearance Standards\n" +
          "- Characters need to look and sound like real people.\n" +
          "- Civilians can't wear tactical/military-style gear without specific approval.\n" +
          "- Department members must wear their department's approved uniform and gear.\n\n" +
          "### 7a. Departmental Equipment\n" +
          "- Only use equipment and gear authorized for your specific department and rank.\n" +
          "- LEO duty-belt loadouts are limited to approved items unless otherwise authorized.\n\n" +
          "### 8. Impersonation\n" +
          "- Civilians may not pose as law enforcement, fire, EMS, or staff.\n" +
          "- Fake traffic stops, fake emergency lights, or claiming false authority are not allowed.\n\n" +
          "### 9. Avoiding Roleplay by Leaving\n" +
          "- Don't disconnect, reset your character,",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container], true);
}
