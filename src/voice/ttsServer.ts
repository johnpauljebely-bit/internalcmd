import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import path from "node:path";

const VOICE_DIR = path.join(process.cwd(), "voice");
const PYTHON = path.join(VOICE_DIR, ".venv", "bin", "python3");

// Same rationale as sttServer.ts: spawning the "piper" CLI fresh per response reloads the ONNX
// voice every time. Confirmed via direct timing: ~4s one-time load, then 0.5-2s per synthesis
// with a persistent process, vs. paying a full reload on every single dispatch response.
let proc: ChildProcessWithoutNullStreams | null = null;
let ready: Promise<void> | null = null;
const pending: Array<(line: string) => void> = [];

function start(): Promise<void> {
  if (proc && ready) return ready;

  proc = spawn(PYTHON, [path.join(VOICE_DIR, "tts_server.py")]);
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
      console.log("[tts-server] ready");
      readyResolve();
      return;
    }
    const next = pending.shift();
    next?.(line);
  });

  proc.stderr.on("data", (d) => console.error(`[tts-server] ${d.toString().trim()}`));

  proc.on("exit", (code) => {
    console.error(`[tts-server] exited unexpectedly with code ${code}`);
    if (!gotReady) readyReject(new Error(`tts_server.py exited with code ${code} before becoming ready`));
    proc = null;
    ready = null;
  });

  return ready;
}

export async function synthesizeSpeechPersistent(text: string, outputWavPath: string): Promise<void> {
  await start();
  if (!proc) throw new Error("TTS server is not running");

  return new Promise((resolve, reject) => {
    pending.push((line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.error) reject(new Error(`tts_server.py: ${parsed.error}`));
        else resolve();
      } catch (err) {
        reject(err);
      }
    });
    proc!.stdin.write(JSON.stringify({ text, output: outputWavPath }) + "\n");
  });
}

// Called at bot startup so the load cost happens once, not on the first response anyone's owed.
export function warmUpTtsServer(): void {
  start().catch((err) => console.error("[tts-server] failed to start", err));
}
