import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js";
import { MARKETPLACE_BANNER_URL, MARKETPLACE_CHECK_THUMBNAIL_URL, MARKETPLACE_ITEMS, SESSION_FOOTER_IMAGE_URL } from "./config.js";

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

type TopLevelComponent = ContainerBuilder | TextDisplayBuilder | ActionRowBuilder<ButtonBuilder>;

function payload(components: TopLevelComponent[], ephemeral = false) {
  return {
    flags: ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2,
    components,
  };
}

// ---------------------------------------------------------------------------------------------
// !marketplace — two containers: the purchasable-items panel, and the claim/FAQ panel below it.
// Every purchase button is a real Link (style 5, real URL, no custom_id) — the given JSON had
// custom_id set alongside url on these, which Discord rejects (Link buttons can't carry a
// custom_id; learned this the hard way on an earlier !embed submission this session).
// ---------------------------------------------------------------------------------------------
export function buildMarketplacePanel() {
  const itemsContainer = new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(MARKETPLACE_BANNER_URL)))
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        "# Delta Marketplace\n> Welcome to the official marketplace hub of **Delta Roleplay**! This is " +
          "your one-stop destination for everything available within our community — from **donation " +
          "perks** to **paid promotional advertising**, and plenty more beyond that.\n\n" +
          "*Browse the categories below to see what's currently on offer.*",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(text("## Purchasable Items"));

  for (const item of MARKETPLACE_ITEMS) {
    itemsContainer.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`\n**${item.name}** — ${item.price}\n-# ${item.description}`))
        .setButtonAccessory(new ButtonBuilder().setLabel(item.buttonLabel).setStyle(ButtonStyle.Link).setURL(item.url)),
    );
  }

  const claimContainer = new ContainerBuilder()
    .addTextDisplayComponents(
      text(
        "# Claiming Purchases\n> After the purchases were claimed, click the button below to claim your " +
          "purchase. Make sure you are verified by going ingame (when the server is up) and running " +
          "`/link` in discord and following the steps.",
      ),
    )
    .addSeparatorComponents(sep(undefined, false))
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("marketplace_claim_purchase").setLabel("Claim Purchase").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("marketplace_faq").setLabel("FAQ").setStyle(ButtonStyle.Secondary),
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([itemsContainer, claimContainer]);
}

// ---------------------------------------------------------------------------------------------
// FAQ — the user's own three Q&As, plus a few more in the same format (flagged as added, not
// given verbatim, in case the wording needs adjusting).
// ---------------------------------------------------------------------------------------------
export function buildMarketplaceFaqEmbed() {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      text(
        "# Frequently Asked Questions\n-# Please read below before opening a ticket in regards to claiming.\n\n" +
          "> **Question**: Why does the bot keep failing to claim?\n" +
          "*Your inventory must be public. Change this in your Roblox settings*\n\n" +
          "> **Question**: How do I claim an SPGW or Paid Advert?\n" +
          "*Once claimed, open a ticket and provide the code DMed to you*\n\n" +
          "> **Question**: What happens when I claim Delta Plus?\n" +
          "*Once claimed, the Delta Plus role will be automatically assigned*\n\n" +
          "> **Question**: I clicked Claim Purchase and got a DM, but never opened a ticket — is my code still valid?\n" +
          "*Yes, codes don't expire. Open a ticket whenever you're ready and provide it*\n\n" +
          "> **Question**: Can I claim the same item twice?\n" +
          "*No — each purchase can only be claimed once. Buying again doesn't generate a new code*\n\n" +
          "> **Question**: I don't have Roblox linked, what do I do?\n" +
          "*Run `/link` in the command channel, then go ingame and run the `;verify` code it gives you*",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container], true);
}

// ---------------------------------------------------------------------------------------------
// Claim code DM — sent after a successful claim. `claimedAtUnixSeconds` renders with Discord's
// `:T` (time-only) format, matching the "the T unicode one" the user asked for. "User" is the
// linked ROBLOX username/ID, not the Discord one — this is what /check and staff actually need to
// verify against the Roblox gamepass purchase itself, and matches what's stored per claim in
// marketplace_claims.
// ---------------------------------------------------------------------------------------------
export function buildClaimCodeDm(params: {
  code: string;
  robloxUsername: string;
  robloxUserId: string;
  claimedAtUnixSeconds: number;
  itemName: string;
}) {
  const { code, robloxUsername, robloxUserId, claimedAtUnixSeconds, itemName } = params;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text("## Your Claim Code for your purchase"))
    .addSeparatorComponents(sep(2))
    .addTextDisplayComponents(
      text(
        `**${code}**\n` +
          `**User:** ${robloxUsername} (\`${robloxUserId}\`)\n` +
          `**Purchase time:** <t:${claimedAtUnixSeconds}:T>\n` +
          `**Item:** ${itemName}\n\n` +
          "-# Thanks for supporting Delta roleplay! Open a ticket to redeem.",
      ),
    )
    .addSeparatorComponents(sep(2))
    .addMediaGalleryComponents(footerGallery());

  return payload([container]);
}

// ---------------------------------------------------------------------------------------------
// /check's result embed — same content whether a code was just claimed or is being looked up
// again later, so re-running /check with an already-checked code shows identical values (per the
// user's own spec — there's no separate "already checked" state to track).
// ---------------------------------------------------------------------------------------------
export function buildCheckResultEmbed(params: {
  robloxUsername: string;
  robloxUserId: string;
  itemName: string;
  claimedAtUnixSeconds: number;
}) {
  const { robloxUsername, robloxUserId, itemName, claimedAtUnixSeconds } = params;

  const container = new ContainerBuilder()
    .addTextDisplayComponents(text("**Purchase Claimed**"))
    .addSeparatorComponents(sep(2))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            `**User:** ${robloxUsername} (\`${robloxUserId}\`)\n**Purchased item:** ${itemName}\n` +
              `**Time:** <t:${claimedAtUnixSeconds}:T>\n-# Status: Claimed`,
          ),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(MARKETPLACE_CHECK_THUMBNAIL_URL)),
    );

  return payload([container]);
}
