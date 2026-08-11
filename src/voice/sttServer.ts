import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";

const VOICE_DIR = path.join(process.cwd(), "voice");
const PYTHON = path.join(VOICE_DIR, ".venv", "bin", "python3");

export interface TranscriptionResult {
  text: string;
  confidence: number | null;
}

// Keeps one long-lived Python process with the STT model loaded once, instead of paying a full
// model load (confirmed ~20s+ for the accurate lgraph model, vs. near-instant for the small one
// this replaced) on every single utterance. See stt_server.py for the line-based JSON protocol.
let proc: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
const pending: Array<(line: string) => void> = [];

function start(): Promise<void> {
  if (proc && ready) return ready;

  proc = spawn(PYTHON, [path.join(VOICE_DIR, "stt_server.py")]);
  const rl = readline.createInterface({ input: proc.stdout });

  let readyResolve!: () => void;
  let readyReject!: (err: Error) => void;
  ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let gotReady = false;
  rl.on("line", (line) => {
    if (!gotReady) {
      gotReady = true;
      console.log("[stt-server] ready");
      readyResolve();
      return;
    }
    const next = pending.shift();
    next?.(line);
  });

  proc.stderr.on("data", (d) => console.error(`[stt-server] ${d.toString().trim()}`));

  proc.on("exit", (code) => {
    console.error(`[stt-server] exited unexpectedly with code ${code}`);
    if (!gotReady) readyReject(new Error(`stt_server.py exited with code ${code} before becoming ready`));
    proc = null;
    ready = null;
  });

  return ready;
}

export async function transcribeWavPersistent(wavPath: string): Promise<TranscriptionResult> {
  await start();
  if (!proc) throw new Error("STT server is not running");

  return new Promise((resolve, reject) => {
    pending.push((line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) reject(new Error(`stt_server.py: ${parsed.error}`));
        else resolve(parsed as TranscriptionResult);
      } catch (err) {
        reject(err);
      }
    });
    proc!.stdin.write(wavPath + "\n");
  });
}

// Call during bot startup so the ~20s+ model load happens once, up front, instead of stalling
// the very first utterance anyone speaks.
export function warmUpSttServer(): void {
  start().catch((err) => console.error("[stt-server] failed to start", err));
}
