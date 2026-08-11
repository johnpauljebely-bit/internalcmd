import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs");

function logFilePath(date: Date) {
  const day = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `events-${day}.log`);
}

export async function logRawEvent(headers: Record<string, unknown>, rawBody: Buffer) {
  const receivedAt = new Date();
  const entry = {
    receivedAt: receivedAt.toISOString(),
    headers,
    body: safeParseJson(rawBody),
  };

  const line = JSON.stringify(entry);
  console.log("[erlc-event]", line);

  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(logFilePath(receivedAt), line + "\n", "utf8");
}

function safeParseJson(rawBody: Buffer) {
  const text = rawBody.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return { unparsable: true, raw: text };
  }
}
