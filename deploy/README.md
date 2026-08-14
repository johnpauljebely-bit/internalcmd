# Deploying to the Oracle Cloud VM

Written ahead of the VM existing — can't provision Oracle Cloud (needs a real card + personal
info, see NEEDS_HUMAN_VERIFICATION.md), so this is untested against the real target, but every
step is standard and each command's purpose is explained so it's easy to adjust if something
doesn't match your actual VM setup.

## 1. Provision the VM

Oracle Cloud console → Compute → Create Instance → Ampere A1 (ARM), Always Free shape. If ARM
capacity says "out of host capacity" in your home region, switch to Frankfurt or Singapore (per
BRIEF.md). Ubuntu is the simplest image to follow these steps with.

## 2. Base setup (on the VM, via SSH)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm python3 python3-venv ffmpeg unzip git

# create a dedicated non-root user to run the service
sudo useradd -r -m -d /opt/delta-city-dispatch -s /usr/sbin/nologin dispatch
```

Node from Ubuntu's apt repo is often older than what this project was built against (Node 24) —
if `node -v` comes back too old, install via NodeSource's setup script or nvm instead.

## 3. Postgres

Added 2026-08-10 for the shared `delta_city` database with the `delta-city-cad` website (see
CHANGELOG.md) — this step didn't exist in earlier versions of this file, which only covered
Vosk/Piper/Node.

```bash
sudo apt install -y postgresql
sudo systemctl enable --now postgresql   # survive reboots, same as the dev-machine requirement
                                          # flagged in NEEDS_HUMAN_VERIFICATION.md

sudo -u postgres createuser delta_city_app
sudo -u postgres createdb -O delta_city_app delta_city
```

This mirrors the local dev setup (trust auth, no password, `delta_city_app` role) — tighten this
if the VM is ever exposed beyond localhost/a private network. `DATABASE_URL` in `.env` (below)
should then read `postgres://delta_city_app@localhost:5432/delta_city`.

**Decide before this step**: is this VM's own local Postgres the one both the bot AND the CAD
website connect to (CAD's `DATABASE_URL` would need to point here, over the network, not
localhost — check with whatever's driving the CAD's own deployment), or does the CAD move
somewhere else that already has its own Postgres and this bot points at that instead? Either
works, but pick one rather than ending up with two separate `delta_city` databases that silently
diverge.

## 4. Deploy the code

```bash
sudo -u dispatch git clone <your-repo-url> /opt/delta-city-dispatch
cd /opt/delta-city-dispatch
sudo -u dispatch npm install            # full install — needed for the build step below
sudo -u dispatch npm run build          # compiles src/ -> dist/ (tsc)
sudo -u dispatch npm prune --omit=dev   # strips tsx/typescript/@types/* now dist/ exists — the
                                         # systemd service runs the compiled output, not tsx, so
                                         # none of this is needed at runtime (real savings on a
                                         # small/free-tier host — confirmed live 2026-08-14 that
                                         # `node dist/index.js` runs standalone)
sudo -u dispatch cp .env.example .env
sudo -u dispatch nano .env   # fill in real secrets, including DATABASE_URL from step 3

cd voice
sudo -u dispatch ./setup.sh   # Piper only (~60MB) — Vosk/STT was archived 2026-08-14 (see
                               # NEEDS_HUMAN_VERIFICATION.md), this bot is broadcast-only now
```

## 5. Cloudflare Tunnel (named, not quick — quick tunnels' URLs change on every restart, which
   caused real problems during local dev, see CHANGELOG.md)

```bash
# on the VM
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login          # opens a browser link — authenticate with your Cloudflare account
cloudflared tunnel create delta-dispatch
cloudflared tunnel route dns delta-dispatch dispatch.yourdomain.com
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: delta-dispatch
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: dispatch.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Update ER:LC's webhook URL to `https://dispatch.yourdomain.com/webhook/erlc` — this one won't
change on restart, unlike the quick tunnel used during dev.

## 6. Run the bot as a service

```bash
sudo cp deploy/delta-city-dispatch.service /etc/systemd/system/
sudo chown -R dispatch:dispatch /opt/delta-city-dispatch
sudo systemctl daemon-reload
sudo systemctl enable --now delta-city-dispatch
sudo systemctl status delta-city-dispatch
journalctl -u delta-city-dispatch -f   # tail logs
```

## 7. Verify

```bash
curl https://dispatch.yourdomain.com/health
```

Same checks as local dev: confirm ER:LC's dashboard shows no webhook error, confirm `/link` +
`;verify` works end to end, confirm `/dispatch start` joins a VC.
