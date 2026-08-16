// For !marketplace's "Claim Purchase" flow — Roblox's public inventory API, no auth/group perms
// needed (confirmed: this is a fully unauthenticated, public endpoint, same one third-party
// Roblox game-pass gates use). Returns null (not false) on a network/API failure so callers can
// tell "confirmed not owned" apart from "couldn't check right now" rather than treating both as a
// failed claim.
export async function checkOwnsGamepass(robloxUserId: string, gamepassId: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://inventory.roblox.com/v1/users/${robloxUserId}/items/GamePass/${gamepassId}/is-owned`,
    );
    if (!res.ok) {
      console.error(`[roblox] gamepass ownership check for user=${robloxUserId} pass=${gamepassId} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as boolean;
  } catch (err) {
    console.error(`[roblox] gamepass ownership check for user=${robloxUserId} pass=${gamepassId} errored`, err);
    return null;
  }
}

// The ER:LC webhook identifies chat command senders by numeric Roblox user ID (confirmed from a
// real captured event), not username, so /link needs to resolve the username the Discord user
// typed into a stable ID at link time.
export async function resolveUsername(username: string): Promise<{ id: string; name: string } | null> {
  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
    });
    if (!res.ok) {
      console.error(`[roblox] username lookup for "${username}" failed: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as { data?: Array<{ id: number; name: string }> };
    const match = data.data?.[0];
    return match ? { id: String(match.id), name: match.name } : null;
  } catch (err) {
    console.error(`[roblox] username lookup for "${username}" errored`, err);
    return null;
  }
}
