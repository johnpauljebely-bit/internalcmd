// AI fallback for the voice dispatcher — only consulted when the rules engine in radioIntents.ts
// can't match an utterance at all. Never on the hot path for a recognized command (status
// updates, plate checks, handshakes, etc. never touch this), so it can't add latency to the
// common case. Runs a small model locally via Ollama rather than a paid API — free, but
// meaningfully slower/less reliable than a hosted model, which is an accepted tradeoff (see
// NEEDS_HUMAN_VERIFICATION.md). Always resolves to `string | null`, never throws — any failure
// (Ollama not running, timeout, bad response) falls back to the existing "10-9, please repeat."

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
// Small on purpose — this machine already runs Vosk (STT) + Piper (TTS) + Node concurrently on
// 8GB of RAM. A 1B model is the safe default; bump to llama3.2:3b via OLLAMA_MODEL if quality
// isn't good enough and headroom allows (confirm live, watch for swapping/slowdowns elsewhere).
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2:1b";
// This is a fallback of last resort, already replacing a dead-end ("please repeat") — a few
// seconds here is a strict improvement over that, but it can't hang forever on a busy machine.
const TIMEOUT_MS = 8_000;

export interface DispatchGameContext {
  activeCalls: { id: string; description: string; postal: string }[];
  onlineUnits: { label: string; team: string | null }[];
}

const SYSTEM_PROMPT = `You are the AI radio dispatcher for "Delta Roleplay," an ER:LC (Emergency Response: Liberty County) Roblox police/EMS/fire roleplay server. Your identity: calm, efficient, professional — a real dispatcher, never a chatbot, never mention being an AI. You know the full 10-code list (10-0 through 10-100, standard BC/RCMP-style) and general police/EMS/fire radio procedure.

An officer just said something over the radio that a rules-based command parser could not match. You get one shot at a smart, in-character reply using your own knowledge plus the live server context given to you. Reply with ONLY the spoken line dispatch would say back — one or two short sentences, no markdown, no lists, no stage directions, no quotation marks around it. If you genuinely cannot tell what they meant even with context, ask ONE short clarifying question instead of guessing wildly.`;

export async function generateAiFallback(
  transcript: string,
  spokenCallsign: string,
  gameContext: DispatchGameContext,
): Promise<string | null> {
  const contextLines = [
    `Speaking unit: ${spokenCallsign}.`,
    gameContext.activeCalls.length > 0
      ? `Active calls right now: ${gameContext.activeCalls
          .map((c) => `#${c.id} ${c.description} at postal ${c.postal}`)
          .join("; ")}.`
      : "No active calls right now.",
    gameContext.onlineUnits.length > 0
      ? `Units currently online: ${gameContext.onlineUnits
          .map((u) => `${u.label}${u.team ? ` (${u.team})` : ""}`)
          .join(", ")}.`
      : "No unit roster available right now.",
  ].join(" ");

  const prompt = `${contextLines}\n\nOfficer said: "${transcript}"\n\nDispatch's spoken reply:`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: SYSTEM_PROMPT,
        prompt,
        stream: false,
        options: { num_predict: 80, temperature: 0.4 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`[ai-fallback] Ollama responded ${res.status} — falling back to 'please repeat'`);
      return null;
    }

    const data = (await res.json()) as { response?: string };
    const text = data.response?.trim();
    return text ? text : null;
  } catch (err) {
    console.error("[ai-fallback] Ollama request failed (not running? model not pulled?) — falling back to 'please repeat'", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
