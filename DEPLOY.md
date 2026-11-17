# Deploying for free, 24/7

- **Frontend** (`frontend/`): Firebase Hosting, free Spark plan
- **Backend + face recognition** (`backend/`): one Docker container on a free Hugging Face Space (CPU basic), kept awake by UptimeRobot
- **Database**: your MongoDB Atlas M0 cluster (the `MONGO_URI` already in `backend/.env`)

The steps below are the ones only you can do, because they need your accounts. Never paste passwords or tokens into chat.

## 1. Let Hugging Face reach Atlas

Hugging Face servers have no fixed IP, so Atlas must accept any IP (your database password still protects it).

Atlas → **Network Access → Add IP Address → Allow access from anywhere** (`0.0.0.0/0`) → Confirm.

## 2. Create the Space

1. Sign up / log in at https://huggingface.co.
2. Go to https://huggingface.co/new-space.
   - Space name: e.g. `attendance-api`
   - SDK: **Docker** → template **Blank**
   - Hardware: **CPU basic (free)**
   - Visibility: **Public** (a private Space blocks the app from calling it)
3. Click **Create Space**.

## 3. Add the secrets

In the Space: **Settings → Variables and secrets → New secret**. Add each of these (same values as your local `backend/.env`):

| Name | Value |
|---|---|
| `MONGO_URI` | your Atlas URI (with `/attendance` before the `?`) |
| `JWT_SECRET` | a long random string, e.g. from https://www.random.org/strings or `openssl rand -hex 32` |
| `ADMIN_USERNAME` | `usman.ghani` |
| `ADMIN_PASSWORD` | the admin password |

## 4. Upload the backend

1. Make a write token: https://huggingface.co/settings/tokens → **Create new token** → type **Write** → copy it.
2. On your PC, in PowerShell:
   ```powershell
   pip install -U huggingface_hub
   hf auth login
   ```
   Paste the token when it asks (it stays on your PC). If it asks about adding it as a git credential, answer `n`.
3. Upload the `backend` folder. This sends only committed files, so `.env` and other local files can never leak (replace `YOUR-HF-USERNAME`):
   ```powershell
   cd C:\Users\abdul\PROJECTS\attendance-web-app-main
   Remove-Item $env:TEMP\hf-backend -Recurse -Force -ErrorAction SilentlyContinue
   git archive --format=zip -o $env:TEMP\backend.zip HEAD:backend
   Expand-Archive $env:TEMP\backend.zip $env:TEMP\hf-backend
   hf upload YOUR-HF-USERNAME/attendance-api $env:TEMP\hf-backend . --repo-type space --exclude "*.onnx"
   ```

The Space starts building. Watch it in the Space's **Logs** tab: the first build takes about 10-15 minutes (it compiles the face library and bakes the face model in). It is ready when the log shows `Connected to MongoDB` and `Server running on port 7860`.

**Updating later:** commit your changes, then run the same five lines again. Only changed files are sent, then the Space rebuilds.

## 5. Test it

Open `https://YOUR-HF-USERNAME-attendance-api.hf.space/health` in a browser. You should see `{"ok":true,"db":true}`.
(The exact address is also under the Space's **⋮ → Embed this Space → Direct URL**.)

`"db":false` means Atlas refused the connection: re-check step 1 and the `MONGO_URI` secret.

## 6. Keep it awake with UptimeRobot

Free Spaces go to sleep after 48 hours without visitors. A ping every 5 minutes keeps it running.

1. Sign up free at https://uptimerobot.com.
2. **Add New Monitor** → type **HTTP(s)** → URL `https://YOUR-HF-USERNAME-attendance-api.hf.space/health` → interval **5 minutes** → Create.

## 7. Deploy the frontend on Firebase Hosting

One-time setup:

1. Go to https://console.firebase.google.com → **Add project**. Skip Google Analytics. The free Spark plan is enough (no card needed).
2. Copy the **Project ID** (shown under the project name, e.g. `attendance-1a2b3`) and put it in `.firebaserc` in place of `YOUR-FIREBASE-PROJECT-ID`.
3. On your PC:
   ```powershell
   npm install -g firebase-tools
   firebase login
   ```

Every deploy (from the project folder, in PowerShell):

```powershell
cd frontend
$env:VITE_API_URL="https://YOUR-HF-USERNAME-attendance-api.hf.space"   # no trailing slash
npm run build
cd ..
firebase deploy --only hosting
```

Your app is then live at `https://<project-id>.web.app`. If the backend address changes, build and deploy again, because it is baked in at build time.

## Android app

The Capacitor app uses the same `VITE_API_URL`. Build it with the variable set, then `npx cap sync`, so it talks to the Space.

## Notes

- CORS already accepts any origin, so the Firebase domain needs no extra config.
- Hugging Face restarts Spaces now and then (updates, maintenance). The app comes back on its own in about a minute.
- Free CPU basic is 2 vCPU / 16 GB RAM. A face scan takes a second or two.

## Alternative: Oracle Cloud VM

`docker-compose.yml` + `Caddyfile` run the same backend image on any Linux VM with HTTPS. Put the secrets in `backend/.env`, set `API_DOMAIN` in `./.env` (see `.env.example`; `api.<ip-with-dashes>.sslip.io` works without buying a domain), open ports 80/443, whitelist the VM IP in Atlas, then `docker compose up -d --build`.
