import express, { type Express } from "express";
import { timingSafeEqual } from "node:crypto";
import { announcePA } from "./erlcClient.js";
import { speakToActiveDispatcher } from "./voice/activeDispatcherRegistry.js";

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
    if (!secret) {
      console.error("[internal-api] INTERNAL_API_SECRET is not set — rejecting all requests");
      res.status(500).json({ ok: false, error: "server not configured" });
      return;
    }

    // Reject on a bad/missing secret before touching anything else.
    const provided = req.get("X-Internal-Secret");
    if (!provided || !secretsMatch(provided, secret)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const message = (req.body as { message?: unknown })?.message;
    if (typeof message !== "string" || message.trim().length === 0) {
      res.status(400).json({ ok: false, error: "message (non-empty string) is required" });
      return;
    }

    Promise.all([announcePA(message), speakToActiveDispatcher(message)])
      .then(([sent]) => {
        // ER:LC PA success/failure still drives the HTTP response — the voice dispatcher is a
        // best-effort bonus channel (frequently not enabled at all), not something a caller
        // should get a 502 over if voice happens to be off.
        if (sent) {
          res.status(200).json({ ok: true });
        } else {
          res.status(502).json({ ok: false, error: "ER:LC announcement failed — check bot logs" });
        }
      })
      .catch((err) => {
        console.error("[internal-api] announce threw", err);
        res.status(502).json({ ok: false, error: "ER:LC announcement failed — check bot logs" });
      });
  });

  console.log("[internal-api] POST /internal/announce registered");
}
