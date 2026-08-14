import express, { type Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { announcePA } from "./erlcClient.js";
import { announceToActiveDispatcher } from "./voice/activeDispatcherRegistry.js";
import { formatEmergencyCodesForSpeech } from "./speechFormat.js";

// Plain !== leaks timing information proportional to how many leading characters match — usually
// theoretical over a network (jitter dominates), but this endpoint shares the same public
// Cloudflare tunnel as the webhook route (see index.ts — one Express app, one port), so it's
// genuinely internet-reachable, not localhost-only. timingSafeEqual requires equal-length buffers
// or it throws, so the length check has to happen first — doing it as a real branch keeps this
// safe rather than wrapping the whole thing in a try/catch to swallow that.
function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Per BOT_SIDE_INSTRUCTIONS.md #4 in delta-city-cad: the CAD website's civilian 911 quick-form
// needs to trigger an in-game PA announcement, but the CAD has no ER:LC server key of its own —
// per the project brief, this bot owns the ER:LC integration exclusively. This is a thin,
// authenticated wrapper around the existing announcePA(), not a new integration surface.
//
// 2026-08-11 (BOT_SIDE_INSTRUCTIONS.md #8): also speaks through the voice dispatcher if one's
// active, not just ER:LC's in-game PA — same "both channels, always" pattern already established
// for every other announcement in this codebase (BOLO, pursuit, new-call, call-cleared). No flag
// to pick one or the other; keeping this endpoint's behavior uniform rather than adding a special
// case for CAD-originated messages specifically. speakToActiveDispatcher no-ops (returns false)
// if no voice session is enabled, so this is always safe to call.
export function registerInternalApi(app: Express): void {
  const secret = process.env.INTERNAL_API_SECRET;

  // Scoped express.json() here, not applied globally in index.ts — the webhook route needs the
  // raw, unparsed body for Ed25519 verification, so a global JSON parser would break it.
  app.post("/internal/announce", express.json(), (req, res) => {
    // Logs every hit, including rejections — added 2026-08-14 after a real debugging session
    // where "is the CAD even reaching this endpoint at all" was genuinely unanswerable from the
    // logs as they existed (this handler only ever logged the registered-at-startup line and a
    // couple of narrow failure paths; a rejected/malformed request left zero trace). Now that this
    // endpoint sits behind a public tunnel, it'll also see stray internet scanner traffic — that's
    // fine and expected, still worth being able to tell apart from a real misconfigured caller.
    console.log(`[internal-api] POST /internal/announce from ${req.ip}`);

    if (!secret) {
      console.error("[internal-api] INTERNAL_API_SECRET is not set — rejecting all requests");
      res.status(500).json({ ok: false, error: "server not configured" });
      return;
    }

    // Reject on a bad/missing secret before touching anything else.
    const provided = req.get("X-Internal-Secret");
    if (!provided || !secretsMatch(provided, secret)) {
      console.warn(`[internal-api] rejected — missing or invalid X-Internal-Secret (from ${req.ip})`);
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const body = req.body as { message?: unknown; spokenMessage?: unknown };
    const message = body?.message;
    if (typeof message !== "string" || message.trim().length === 0) {
      console.warn("[internal-api] rejected — message body missing/empty");
      res.status(400).json({ ok: false, error: "message (non-empty string) is required" });
      return;
    }

    // Optional pre-formatted spoken version — added 2026-08-14 so the CAD can send its own
    // properly-formatted speech text for things the bot can't infer from opaque free text (e.g. a
    // license plate that should be read with the NATO phonetic alphabet, matching how BOLO/traffic
    // stop already do it elsewhere in this codebase). Falls back to `message` if not given. Either
    // way, X11 emergency codes (911, 311, etc.) get digit-by-digit speech applied automatically —
    // confirmed live as a real bug: Piper read a bare "911" as "nine hundred eleven" instead of
    // "nine one one", since this endpoint never applied any of the number-formatting the bot's own
    // constructed announcements (BOLO, pursuit, calls) already do per-field.
    const spokenMessageInput = typeof body?.spokenMessage === "string" ? body.spokenMessage : message;
    const spokenMessage = formatEmergencyCodesForSpeech(spokenMessageInput);

    console.log(`[internal-api] announcing: "${message.slice(0, 120)}"`);

    Promise.all([announcePA(message), announceToActiveDispatcher(spokenMessage)])
      .then(([sent, spoken]) => {
        console.log(`[internal-api] result: PA sent=${sent}, spoken=${spoken}`);
        // Success if EITHER channel got the message through — critical fix (2026-08-14): this used
        // to key success purely off `sent` (ER:LC PA), which meant this endpoint returned a 502
        // for EVERY call while ER:LC's IP isn't allowlisted (a known, separate, already-documented
        // issue), even on calls where the voice announcement worked perfectly. Once the CAD added
        // retry-on-5xx logic, that false 502 caused a genuine duplicate broadcast — confirmed live
        // via these very logs, the exact same message announced twice a couple seconds apart. Only
        // report failure when BOTH channels genuinely failed.
        if (sent || spoken) {
          res.status(200).json({ ok: true, pa: sent, voice: spoken });
        } else {
          res.status(502).json({ ok: false, error: "announcement failed on both PA and voice — check bot logs" });
        }
      })
      .catch((err) => {
        console.error("[internal-api] announce threw", err);
        res.status(502).json({ ok: false, error: "announcement threw — check bot logs" });
      });
  });

  console.log("[internal-api] POST /internal/announce registered");
}
