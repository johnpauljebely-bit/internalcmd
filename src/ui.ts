import { ContainerBuilder, SeparatorBuilder, TextDisplayBuilder, MessageFlags } from "discord.js";

function flagsFor(ephemeral?: boolean) {
  return ephemeral ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral : MessageFlags.IsComponentsV2;
}

// Components V2 message builder — no accent color set on the container, so no sidebar color.
export function containerMessage(lines: string | string[], opts: { ephemeral?: boolean } = {}) {
  const container = new ContainerBuilder();
  const arr = Array.isArray(lines) ? lines : [lines];
  for (const line of arr) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
  }

  return { flags: flagsFor(opts.ephemeral), components: [container] };
}

export interface InfoField {
  label: string;
  value: string;
}

// Same no-accent-color container, laid out as a title + separator + label/value rows,
// each row separated by a divider for readability.
export function infoCard(
  title: string,
  fields: InfoField[],
  opts: { ephemeral?: boolean } = {},
) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  container.addSeparatorComponents(new SeparatorBuilder());

  fields.forEach((field, i) => {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${field.label}**\n${field.value}`),
    );
    if (i < fields.length - 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    }
  });

  return { flags: flagsFor(opts.ephemeral), components: [container] };
}
