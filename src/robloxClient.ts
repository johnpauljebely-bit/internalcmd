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
