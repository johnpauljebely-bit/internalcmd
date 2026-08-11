import "dotenv/config";
import express from "express";
import { createErlcSignatureVerifier } from "./verifySignature.js";
import { logRawEvent } from "./eventLogger.js";
import { parseIncomingEvents } from "./parseEvent.js";
import { routeChatEvent } from "./chatCommands.js";
import { startBot } from "./discordBot.js";
import { startCallsignDutyTracking } from "./callsignDutyTracker.js";
import { startComplianceMonitor } from "./complianceMonitor.js";
import { startCallDispatch } from "./callDispatch.js";
import { startJoinReminder } from "./joinReminder.js";
import { startRoleplayHints } from "./roleplayHints.js";
import { startModCallDetector } from "./modCallDetector.js";
import { warmUpSttServer } from "./voice/sttServer.js";
import { warmUpTtsServer } from "./voice/ttsServer.js";
import { initDb } from "./db.js";
import { registerInternalApi } from "./internalApi.js";

const PORT = Number(process.env.PORT ?? 3000);
const WEBHOOK_PUBLIC_KEY = process.env.ERLC_WEBHOOK_PUBLIC_KEY;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;

if (!WEBHOOK_PUBLIC_KEY) {
  throw new Error("ERLC_WEBHOOK_PUBLIC_KEY is not set — check .env against .env.example");
}
if (!DISCORD_BOT_TOKEN || !DISCORD_APPLICATION_ID) {
  throw new Error("DISCORD_BOT_TOKEN / DISCORD_APPLICATION_ID not set — check .env against .env.example");
}

const app = express();

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", uptimeSeconds: process.uptime() });
});

// ER:LC's dashboard does a GET probe against the saved webhook URL to validate it before
// accepting it — without this, it 404s ("Cannot GET /webhook/erlc") and the dashboard flags the
// webhook as broken, even though real event deliveries are always POST per the docs.
app.get("/webhook/erlc", (_req, res) => {
  res.status(200).send("ok");
});

// Raw body is required for Ed25519 verification — must run before any JSON body parsing.
app.post(
  "/webhook/erlc",
  express.raw({ type: "*/*", limit: "1mb" }),
  createErlcSignatureVerifier(WEBHOOK_PUBLIC_KEY),
  async (req, res) => {
    const rawBody = req.body as Buffer;
    try {
      await logRawEvent(req.headers, rawBody);
      res.status(200).send("ok");
    } catch (err) {
      console.error("[erlc-event] failed to log event", err);
      res.status(500).send("logging failed");
      return;
    }

    try {
      const bodyText = rawBody.toString("utf8");
      const events = parseIncomingEvents(JSON.parse(bodyText));
      for (const event of events) {
        if (event.kind === "chat") {
          await routeChatEvent(event);
        } else if (event.kind === "unknown") {
          console.warn("[erlc-event] unrecognized event shape — see logs/ to help calibrate parseEvent.ts");
        }
        // "probe" events (ER:LC's periodic webhook validation check) need no response beyond
        // the 200 already sent above.
      }
    } catch (err) {
      console.error("[erlc-event] failed to route event", err);
    }
  },
);

async function main() {
  await initDb();
  registerInternalApi(app);
  await startBot(DISCORD_BOT_TOKEN!, DISCORD_APPLICATION_ID!);
  startCallsignDutyTracking();
  startComplianceMonitor();
  startCallDispatch();
  startJoinReminder();
  startRoleplayHints();
  startModCallDetector();
  warmUpSttServer();
  warmUpTtsServer();

  app.listen(PORT, () => {
    console.log(`Delta City Dispatch (Phase 1) listening on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Webhook endpoint: http://localhost:${PORT}/webhook/erlc`);
  });
}

main().catch((err) => {
  console.error("[startup] fatal error", err);
  process.exit(1);
});
