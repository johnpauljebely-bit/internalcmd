import {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  type ContainerBuilder,
} from "discord.js";
import {
  CALLSIGN_ADMIN_ROLE_IDS,
  CALLSIGN_RANGES,
  COMMUNITY_DIRECTIVE_ROLE_ID,
  DELTA_PD_CALLSIGN_RANGE,
  RANK_CHOICES,
  type Department,
} from "../config.js";
import {
  assignCallsign,
  findLinkByDiscordId,
  getCallsignsByDiscordId,
  getLivePlayerByUsername,
  getTakenCallsignNumbers,
  removeCallsignForDepartment,
} from "../db.js";

// Same "online" threshold the CAD's onboarding uses (COORDINATION.md) — a live_players row only
// gets touched by a live getServerPlayers() poll, so "online" is "updated recently enough."
const LIVE_PLAYER_ONLINE_WINDOW_MS = 90_000;
import { containerMessage, infoCard, type InfoField } from "../ui.js";
import { formatCallsignBlock } from "../callsignFormat.js";
import { findLowestAvailableNumber } from "../callsignAssign.js";

export const callsignCommand = new SlashCommandBuilder()
  .setName("callsign")
  .setDescription("Callsign assignment and management")
  .addSubcommand((sub) =>
    sub
      .setName("assign")
      .setDescription("Assign the lowest available callsign in a rank's range")
      .addUserOption((opt) => opt.setName("user").setDescription("Member to assign").setRequired(true))
      .addStringOption((opt) =>
        opt
          .setName("department")
          .setDescription("Department")
          .setRequired(true)
          .addChoices(
            { name: "RCMP", value: "rcmp" },
            { name: "BCHP", value: "bchp" },
            { name: "Ownership", value: "ownership" },
          ),
      )
      .addStringOption((opt) =>
        opt.setName("rank").setDescription("Rank").setRequired(true).addChoices(...RANK_CHOICES),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("manage")
      .setDescription("View, reassign, or remove a member's callsign (Directive/Executive/WL Command only)")
      .addUserOption((opt) => opt.setName("user").setDescription("Member to manage").setRequired(true)),
  )
  .addSubcommand((sub) =>
    sub
      .setName("self-assign")
      .setDescription("Delta PD only — claims your current live in-game callsign, no free-typing"),
  );

function hasCallsignPermission(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  return interaction.member.roles.cache.some((r) => CALLSIGN_ADMIN_ROLE_IDS.includes(r.id));
}

// Ownership (100-199) is cross-department and reserved for people who already hold the Community
// Directive role — it's not a rank anyone gets promoted into, it's an identifier for people who
// already have that standing. Checked against the TARGET (who's receiving the callsign), not the
// admin running the command (who's already gated by hasCallsignPermission).
async function targetHasDirectiveRole(interaction: ChatInputCommandInteraction, targetId: string): Promise<boolean> {
  try {
    const member = await interaction.guild!.members.fetch(targetId);
    return member.roles.cache.has(COMMUNITY_DIRECTIVE_ROLE_ID);
  } catch (err) {
    console.error(`[callsign] failed to check Directive role for ${targetId}`, err);
    return false;
  }
}

async function handleAssign(interaction: ChatInputCommandInteraction) {
  if (!hasCallsignPermission(interaction)) {
    await interaction.reply(
      containerMessage("You need a Directive, Executive-tier, or Whitelisted Command role to use this.", {
        ephemeral: true,
      }),
    );
    return;
  }

  const target = interaction.options.getUser("user", true);
  const department = interaction.options.getString("department", true) as Department;
  const rankInput = interaction.options.getString("rank", true).trim().toLowerCase();

  const ranges = CALLSIGN_RANGES[department as Exclude<Department, "delta-pd">];
  const rankRange = ranges.find((r) => r.rank === rankInput);

  if (!rankRange) {
    const valid = ranges.map((r) => r.rank).join(", ");
    await interaction.reply(
      containerMessage(`Unknown rank "${rankInput}" for ${department.toUpperCase()}. Valid ranks: ${valid}`, {
        ephemeral: true,
      }),
    );
    return;
  }

  if (department === "ownership" && !(await targetHasDirectiveRole(interaction, target.id))) {
    await interaction.reply(
      containerMessage(`<@${target.id}> needs the Community Directive role before they can receive an Ownership callsign.`, {
        ephemeral: true,
      }),
    );
    return;
  }

  const taken = new Set(await getTakenCallsignNumbers(department));
  const number = findLowestAvailableNumber(rankRange.min, rankRange.max, taken);

  if (number === null) {
    await interaction.reply(
      containerMessage(
        `No callsigns left in ${rankRange.min}-${rankRange.max} for ${department.toUpperCase()} ${rankInput}.`,
        { ephemeral: true },
      ),
    );
    return;
  }

  await assignCallsign(department, number, rankInput, target.id, interaction.user.id);

  // Ack before the member.fetch/setNickname calls — Discord API calls are usually fast but not
  // guaranteed under 3s, and missing that window crashes the whole process (confirmed live for
  // a different command with this same shape of bug).
  await interaction.deferReply();

  let nicknameNote = "";
  try {
    const member = await interaction.guild!.members.fetch(target.id);
    const link = await findLinkByDiscordId(target.id);
    const nameForNick = link?.roblox_username ?? member.displayName;
    await member.setNickname(`${number} | ${nameForNick}`);
  } catch (err) {
    nicknameNote = " (couldn't set their nickname — check my role is above theirs and I have Manage Nicknames)";
    console.error(`[callsign] nickname update failed for ${target.id}`, err);
  }

  await interaction.editReply(
    containerMessage(
      `Assigned **${number}** to <@${target.id}> (${department.toUpperCase()} ${rankInput}).${nicknameNote}`,
    ),
  );
}

async function handleManage(interaction: ChatInputCommandInteraction) {
  if (!hasCallsignPermission(interaction)) {
    await interaction.reply(
      containerMessage("You need a Directive, Executive-tier, or Whitelisted Command role to use this.", {
        ephemeral: true,
      }),
    );
    return;
  }
  if (!interaction.guild) return;

  const target = interaction.options.getUser("user", true);
  let selectedDepartment: Department | null = null;
  let selectedRank: string | null = null;

  async function buildPanel(statusLine?: string, includeControls = true) {
    const link = await findLinkByDiscordId(target.id);
    const callsigns = await getCallsignsByDiscordId(target.id);

    const fields: InfoField[] = [
      { label: "Discord", value: `<@${target.id}>` },
      { label: "Roblox username", value: link?.roblox_username ?? "Not linked" },
    ];
    if (callsigns.length === 0) {
      fields.push({ label: "Callsign", value: "None assigned" });
    } else {
      for (const cs of callsigns) {
        fields.push({ label: `Callsign — ${cs.department.toUpperCase()}`, value: formatCallsignBlock(cs) });
      }
    }
    if (statusLine) fields.push({ label: "Status", value: statusLine });

    const card = infoCard("Manage Callsign", fields, { ephemeral: true });
    if (!includeControls) return card;

    const container = card.components[0] as ContainerBuilder;

    const departmentSelect = new StringSelectMenuBuilder()
      .setCustomId("department")
      .setPlaceholder(selectedDepartment ? `Department: ${selectedDepartment.toUpperCase()}` : "1. Select department")
      .addOptions(
        { label: "RCMP", value: "rcmp", default: selectedDepartment === "rcmp" },
        { label: "BCHP", value: "bchp", default: selectedDepartment === "bchp" },
        { label: "Ownership", value: "ownership", default: selectedDepartment === "ownership" },
      );

    const rankSelect = new StringSelectMenuBuilder()
      .setCustomId("rank")
      .setPlaceholder(selectedRank ? `Rank: ${selectedRank}` : "2. Select rank")
      .addOptions(RANK_CHOICES.map((r) => ({ label: r.name, value: r.value, default: r.value === selectedRank })));

    const controlButtons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("confirm-assign").setLabel("3. Assign / Reassign").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("remove")
        .setLabel("Remove Callsign")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(callsigns.length === 0),
      new ButtonBuilder().setCustomId("close").setLabel("Close").setStyle(ButtonStyle.Secondary),
    );

    container
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(departmentSelect))
      .addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(rankSelect))
      .addActionRowComponents(controlButtons);

    return card;
  }

  await interaction.reply(await buildPanel());
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 5 * 60_000 });

  // Unlike the slash-command entry points below (and every other command in this codebase), this
  // is a message-component collector, not the top-level `interactionCreate` handler — so it's NOT
  // covered by discordBot.ts's own try/catch. Found while re-reading this: an error thrown after
  // `i.deferUpdate()`/`i.deferReply()` (e.g. the `assignCallsign` unique-constraint race if two
  // admins pick the same lowest-free number at once, or any transient Discord/DB hiccup) would
  // become an unhandled rejection inside this event listener — caught only by the process-wide
  // safety net in discordBot.ts (logs, keeps running), but the user's ephemeral panel would be
  // left stuck on "thinking..." forever with zero explanation. Wrapped the same way
  // discordBot.ts's own handler already is, for the same reason.
  collector.on("collect", async (i) => {
   try {
    if (i.user.id !== interaction.user.id) {
      await i.reply(containerMessage("This isn't your panel.", { ephemeral: true }));
      return;
    }

    if (i.isStringSelectMenu() && i.customId === "department") {
      selectedDepartment = i.values[0] as Department;
      await i.update(await buildPanel());
      return;
    }

    if (i.isStringSelectMenu() && i.customId === "rank") {
      selectedRank = i.values[0];
      await i.update(await buildPanel());
      return;
    }

    if (i.isButton() && i.customId === "close") {
      await i.update(await buildPanel("Closed.", false));
      collector.stop("closed");
      return;
    }

    if (i.isButton() && i.customId === "remove") {
      // Scoped to whichever department is selected in the dropdown above — someone can now hold
      // more than one callsign at once (e.g. RCMP + Ownership), so "remove" can't mean "wipe
      // everything" anymore. Reuses the same department selector the assign flow already has
      // rather than adding a second one.
      if (!selectedDepartment) {
        await i.update(await buildPanel("Pick a department first — Remove only clears that one callsign."));
        return;
      }

      // Same crash class as the slash-command handlers below — ack before the slow Discord API
      // call, not after.
      await i.deferUpdate();
      const removed = await removeCallsignForDepartment(target.id, selectedDepartment);

      // Only clear the nickname if that was their last callsign — if they still hold one in
      // another department, their nickname is still accurate and shouldn't be blanked.
      const remaining = await getCallsignsByDiscordId(target.id);
      if (remaining.length === 0) {
        try {
          const member = await interaction.guild!.members.fetch(target.id);
          await member.setNickname(null);
        } catch (err) {
          console.error(`[callsign] nickname reset failed for ${target.id}`, err);
        }
      }

      const removedDept = selectedDepartment.toUpperCase();
      selectedDepartment = null;
      selectedRank = null;
      await i.editReply(
        await buildPanel(removed > 0 ? `${removedDept} callsign removed.` : `No ${removedDept} callsign to remove.`),
      );
      return;
    }

    if (i.isButton() && i.customId === "confirm-assign") {
      if (!selectedDepartment || !selectedRank) {
        await i.update(await buildPanel("Pick a department and rank first."));
        return;
      }

      const ranges = CALLSIGN_RANGES[selectedDepartment as Exclude<Department, "delta-pd">];
      const rankRange = ranges.find((r) => r.rank === selectedRank);
      if (!rankRange) {
        await i.update(await buildPanel(`"${selectedRank}" isn't a valid rank for ${selectedDepartment.toUpperCase()}.`));
        return;
      }

      if (selectedDepartment === "ownership" && !(await targetHasDirectiveRole(interaction, target.id))) {
        await i.update(await buildPanel(`<@${target.id}> needs the Community Directive role first.`));
        return;
      }

      // Scoped to just the department being (re)assigned — Ownership is meant to stack alongside
      // an existing RCMP/BCHP/Delta PD callsign, not replace it, so wiping every department the
      // target holds (the old behavior, back when one person only ever had one callsign) would
      // silently destroy an unrelated callsign the moment Ownership entered the picture.
      await removeCallsignForDepartment(target.id, selectedDepartment);
      const taken = new Set(await getTakenCallsignNumbers(selectedDepartment));
      const number = findLowestAvailableNumber(rankRange.min, rankRange.max, taken);

      if (number === null) {
        await i.update(await buildPanel(`No callsigns left in ${rankRange.min}-${rankRange.max}.`));
        return;
      }

      // All fast validation passed — ack now, before the slow member.fetch/setNickname call.
      await i.deferUpdate();

      await assignCallsign(selectedDepartment, number, selectedRank, target.id, interaction.user.id);

      let note = "";
      try {
        const member = await interaction.guild!.members.fetch(target.id);
        const link = await findLinkByDiscordId(target.id);
        await member.setNickname(`${number} | ${link?.roblox_username ?? member.displayName}`);
      } catch (err) {
        note = " (nickname update failed)";
        console.error(`[callsign] nickname update failed for ${target.id}`, err);
      }

      await i.editReply(await buildPanel(`Assigned **${number}**.${note}`));
      return;
    }
   } catch (err) {
    console.error("[callsign] manage panel collector errored", err);
    try {
      const errorReply = containerMessage("Something went wrong — try again.", { ephemeral: true });
      if (i.deferred || i.replied) {
        await i.editReply(errorReply);
      } else {
        await i.reply(errorReply);
      }
    } catch (replyErr) {
      console.error("[callsign] failed to report the manage-panel error back to the user", replyErr);
    }
   }
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "closed") return;
    try {
      await interaction.editReply(await buildPanel("Session expired — run /callsign manage again.", false));
    } catch {
      // message may already be gone (e.g. ephemeral expired) — nothing to clean up
    }
  });
}

// Delta PD is unwhitelisted (anyone can play), no admin gate, unlike /callsign assign. Per the
// user's explicit instruction (2026-08-11, relayed via COORDINATION.md): "dpd callsigns based off
// of ingame callsigns only please" — this used to let someone free-type any 400-499 number
// (matching the original brief's "self-chosen, not auto-assigned"), but that's been superseded.
// It now derives the number entirely from `live_players.callsign` (the CAD's onboarding was
// updated to the same rule first — see COORDINATION.md for the parallel implementation) rather
// than taking one as a command argument at all. Still writes to the same `callsigns` table
// shape/columns as the CAD's self-registration path (BOT_SIDE_INSTRUCTIONS.md #5).
async function handleSelfAssign(interaction: ChatInputCommandInteraction) {
  const link = await findLinkByDiscordId(interaction.user.id);
  if (!link) {
    await interaction.reply(containerMessage("You need to /link your Roblox account first.", { ephemeral: true }));
    return;
  }

  const livePlayer = await getLivePlayerByUsername(link.roblox_username);
  const isOnline =
    livePlayer && Date.now() - livePlayer.updated_at.getTime() <= LIVE_PLAYER_ONLINE_WINDOW_MS;

  if (!isOnline) {
    await interaction.reply(
      containerMessage("You need to be online in ER:LC first — get in-game, then run this again.", {
        ephemeral: true,
      }),
    );
    return;
  }

  const number = Number(livePlayer.callsign);
  if (!Number.isFinite(number) || number < DELTA_PD_CALLSIGN_RANGE.min || number > DELTA_PD_CALLSIGN_RANGE.max) {
    await interaction.reply(
      containerMessage(
        `Your current in-game callsign (\`${livePlayer.callsign ?? "not set"}\`) isn't a valid Delta PD number — ` +
          `must be ${DELTA_PD_CALLSIGN_RANGE.min}-${DELTA_PD_CALLSIGN_RANGE.max}. Set a valid one in-game and try again.`,
        { ephemeral: true },
      ),
    );
    return;
  }

  const existingCallsigns = await getCallsignsByDiscordId(interaction.user.id);
  const existingDeltaPd = existingCallsigns.find((cs) => cs.department === "delta-pd");

  if (existingDeltaPd?.number === number) {
    await interaction.reply(containerMessage(`You already have callsign **${number}**.`, { ephemeral: true }));
    return;
  }

  // Still enforced as a safety net even though the number now comes from ER:LC's own live state,
  // not free-typed — two different people could plausibly end up reporting the same in-game
  // callsign momentarily, and this is the actual uniqueness guarantee either way.
  const taken = new Set(await getTakenCallsignNumbers("delta-pd"));
  if (taken.has(number)) {
    await interaction.reply(
      containerMessage(`Callsign **${number}** is already taken — set a different one in-game and try again.`, {
        ephemeral: true,
      }),
    );
    return;
  }

  // Ack before the member.fetch/setNickname call, same crash class as every other command here.
  await interaction.deferReply();

  if (existingDeltaPd) {
    await removeCallsignForDepartment(interaction.user.id, "delta-pd");
  }
  await assignCallsign("delta-pd", number, "Officer", interaction.user.id, interaction.user.id);

  let nicknameNote = "";
  try {
    const member = await interaction.guild!.members.fetch(interaction.user.id);
    await member.setNickname(`${number} | ${link.roblox_username}`);
  } catch (err) {
    nicknameNote = " (couldn't set your nickname — check my role is above yours and I have Manage Nicknames)";
    console.error(`[callsign] self-assign nickname update failed for ${interaction.user.id}`, err);
  }

  await interaction.editReply(containerMessage(`You're now Delta PD **${number}**.${nicknameNote}`));
}

export async function handleCallsignCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "manage") {
    await handleManage(interaction);
  } else if (sub === "self-assign") {
    await handleSelfAssign(interaction);
  } else {
    await handleAssign(interaction);
  }
}
