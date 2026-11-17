# Deploying for free, 24/7

- **Frontend** (`frontend/`): Firebase Hosting, free Spark plan
- **Backend + face recognition** (`backend/`): one Docker container on a Google Cloud **Always Free e2-micro** VM, behind Caddy for HTTPS
- **Database**: your MongoDB Atlas M0 cluster

Never paste passwords or tokens into chat.

## 1. Google Cloud project and billing

1. Go to https://console.cloud.google.com and sign in.
2. Top bar → project picker → **New Project** → name `attendance` → Create, then select it.
3. **Billing**: Menu → Billing → link a billing account (a card is required, but the e2-micro below stays inside the free tier).
4. **Budget alert** (so nothing surprises you): Billing → **Budgets & alerts** → Create budget → amount **$1** → keep the email alerts → Finish.
5. Menu → **Compute Engine** → click **Enable** for the API (takes a minute).

## 2. Create the free VM

Compute Engine → VM instances → **Create instance**. Set exactly these (anything else may cost money):

- Name: `attendance`
- Region: **us-central1** (or us-west1 / us-east1, only these 3 are free). Zone: any.
- Machine: series **E2**, type **e2-micro**
- Boot disk → **Change**: OS **Ubuntu**, version **Ubuntu 22.04 LTS (x86/64)**, disk type **Standard persistent disk**, size **30 GB** → Select
- Firewall: tick **Allow HTTP traffic** and **Allow HTTPS traffic**

Click **Create**. Copy the **External IP** shown in the list, e.g. `34.123.45.67`.

## 3. Let the VM reach Atlas

Atlas → **Network Access → Add IP Address** → enter the VM's External IP → Confirm.

## 4. Set up the VM

In the VM list click **SSH** (opens a terminal in your browser). Paste these blocks one at a time.

**Swap** (the VM has only 1 GB RAM; this adds 3 GB of disk-backed memory so the build and face model fit):
```bash
sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Docker:**
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

**Code** (the repo is private, so git asks for a username and password: enter `sardarusmanghanikhan09-art` and a GitHub token from https://github.com/settings/tokens → *Generate new token (classic)* → tick **repo**. The token is the password.):
```bash
git clone https://github.com/sardarusmanghanikhan09-art/attendance-web-app.git attendance
cd attendance
```

**Secrets** (same values as your local `backend/.env`):
```bash
nano backend/.env
```
Paste, fill in, then save with `Ctrl+O`, `Enter`, `Ctrl+X`:
```
MONGO_URI=your-atlas-uri-with-/attendance
JWT_SECRET=any-long-random-string
ADMIN_USERNAME=usman.ghani
ADMIN_PASSWORD=your-admin-password
```

**HTTPS address** (replace the IP with yours, dots become dashes):
```bash
echo "API_DOMAIN=api.34-123-45-67.sslip.io" > .env
```

**Start it** (the first build takes 20-40 minutes on this small VM):
```bash
docker compose up -d --build
docker compose logs -f backend
```
Wait for `Connected to MongoDB` and `Server running on port 7860`, then press `Ctrl+C` (the app keeps running).

**Test:** open `https://api.34-123-45-67.sslip.io/health` in your browser. You should see `{"ok":true,"db":true}`.

Containers restart on their own after crashes and VM reboots.

**Updating later** (after you `git push` new code):
```bash
cd ~/attendance && git pull && docker compose up -d --build
```

## 5. Deploy the frontend on Firebase Hosting

One-time setup:

1. Go to https://console.firebase.google.com → **Add project** → pick your `attendance` Google Cloud project (or make a new one). Skip Analytics.
2. Open `.firebaserc` and replace `YOUR-FIREBASE-PROJECT-ID` with the Project ID.
3. In cmd on your PC:
   ```
   npm install -g firebase-tools
   firebase login
   ```

Every deploy (cmd, replace the address with yours):

```
cd C:\Users\abdul\PROJECTS\attendance-web-app-main\frontend
set VITE_API_URL=https://api.34-123-45-67.sslip.io
npm run build
cd ..
firebase deploy --only hosting
```

Your app is then live at `https://<project-id>.web.app`. If the backend address changes, build and deploy again, because it is baked in at build time.

## Notes

- CORS already accepts any origin, so the Firebase domain needs no extra config.
- The External IP stays the same while the VM runs. If you ever **stop** the VM it may change; then update `.env` on the VM, Atlas, and redeploy the frontend. To pin it: VPC network → IP addresses → reserve the VM's IP as static.
- Free tier limits: 1 e2-micro in us-west1/us-central1/us-east1, 30 GB standard disk, 1 GB outbound traffic per month. The $1 budget alert emails you if anything starts costing money.
- The Android app uses the same `VITE_API_URL`: build with it set, then `npx cap sync`.
