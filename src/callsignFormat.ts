import type { CallsignRow } from "./db.js";

export function formatCallsignBlock(cs: CallsignRow): string {
  const hours = (cs.total_seconds / 3600).toFixed(1);
  return [
    `• Number: **${cs.number}**`,
    `• Rank: ${cs.rank}`,
    `• Assigned: ${new Date(cs.assigned_at).toLocaleString()}`,
    `• Assigned by: ${cs.assigned_by ? `<@${cs.assigned_by}>` : "unknown"}`,
    `• Duty time tracked: ${hours}h (tracking started when this feature shipped — no history before that)`,
  ].join("\n");
}
