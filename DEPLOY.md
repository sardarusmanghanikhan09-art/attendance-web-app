# Deploying for free, 24/7

- **Frontend** (`frontend/`): Firebase Hosting, free Spark plan
- **Backend + face recognition** (`backend/`): one Docker container on an Oracle Cloud **Always Free Ampere A1** VM (ARM), behind Caddy for HTTPS
- **Database**: your MongoDB Atlas M0 cluster

Never paste passwords or tokens into chat.

## 1. Create the free VM

1. Go to https://cloud.oracle.com and sign in.
2. Menu (☰) → **Compute → Instances** → **Create instance**.
3. Name: `attendance`.
4. **Image and shape** → **Edit**:
   - Image → **Change image** → **Ubuntu** → **Canonical Ubuntu 22.04** (not the "Minimal" one) → Select image.
   - Shape → **Change shape** → **Ampere** → **VM.Standard.A1.Flex** → OCPUs **2**, Memory **12 GB** → Select shape. (Up to 4 OCPU / 24 GB in total is Always Free.)
5. **Networking**: keep the default new VCN and public subnet, and make sure **Assign a public IPv4 address** is on.
6. **Add SSH keys**: choose **Generate a key pair for me** → click **Save private key** (it downloads a `.key` file). Don't lose it, it's the only way into the VM.
7. Boot volume: leave default (50 GB, free up to 200 GB).
8. Click **Create**. When the state is **Running**, copy the **Public IP address**, e.g. `129.150.12.34`.

If you get **"Out of capacity"** (common in single-AD regions like Mumbai), use the other free shape instead: **Specialty and previous generation → VM.Standard.E2.1.Micro** (x86, 1 GB RAM). It works, but you must add the swap file in step 5. You can move to A1 later when capacity frees up.

## 2. Open ports 80 and 443 in Oracle's firewall

1. On the instance page click the **Subnet** link → **Security Lists** → **Default Security List**.
2. **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `80,443` → **Add Ingress Rules**.

## 3. Let the VM reach Atlas

Atlas → **Network Access → Add IP Address** → enter the VM's Public IP → Confirm.

## 4. Connect to the VM from your PC

In **cmd** (change the key filename to the one you downloaded):
```
mkdir %USERPROFILE%\.ssh
move %USERPROFILE%\Downloads\ssh-key-*.key %USERPROFILE%\.ssh\oracle.key
icacls %USERPROFILE%\.ssh\oracle.key /inheritance:r /grant:r "%USERNAME%:R"
ssh -i %USERPROFILE%\.ssh\oracle.key ubuntu@129.150.12.34
```
Type `yes` when asked. You are now on the VM; everything below runs there.

## 5. Set up the VM

Paste these blocks one at a time.

**Open the ports inside Ubuntu too** (Oracle's Ubuntu image blocks them by default):
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

**Swap** (only needed on the 1 GB E2.1.Micro; adds 4 GB of disk-backed memory so the build and face model fit):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```
`free -h` should show about 4.0Gi of Swap.

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
echo "API_DOMAIN=api.129-150-12-34.sslip.io" > .env
```

**Start it** (the first build takes 10-20 minutes on A1, 30-60 minutes on the Micro; the image is built on the VM, so it automatically matches its CPU type):
```bash
docker compose up -d --build
docker compose logs -f backend
```
Wait for `Connected to MongoDB` and `Server running on port 7860`, then press `Ctrl+C` (the app keeps running).

**Test:** open `https://api.129-150-12-34.sslip.io/health` in your browser. You should see `{"ok":true,"db":true}`.

Containers restart on their own after crashes and VM reboots.

**Updating later** (after you `git push` new code):
```bash
cd ~/attendance && git pull && docker compose up -d --build
```

## 6. Deploy the frontend on Firebase Hosting

One-time setup:

1. Go to https://console.firebase.google.com → **Add project** → name it `attendance`. Skip Analytics.
2. Open `.firebaserc` and replace `YOUR-FIREBASE-PROJECT-ID` with the Project ID.
3. In cmd on your PC:
   ```
   npm install -g firebase-tools
   firebase login
   ```

Every deploy (cmd, replace the address with yours):

```
cd C:\Users\abdul\PROJECTS\attendance-web-app-main\frontend
set VITE_API_URL=https://api.129-150-12-34.sslip.io
npm run build
cd ..
firebase deploy --only hosting
```

Your app is then live at `https://<project-id>.web.app`. If the backend address changes, build and deploy again, because it is baked in at build time.

## Notes

- CORS already accepts any origin, so the Firebase domain needs no extra config.
- The Public IP stays the same while the VM exists, even across reboots. If you terminate and recreate the VM, update `.env` on the VM, Atlas, and redeploy the frontend.
- Always Free limits: Ampere A1 up to 4 OCPU / 24 GB RAM in total, 200 GB block storage, 10 TB outbound traffic per month. Stay inside them and it costs nothing. To be safe: Billing → **Budgets** → create a $1 budget with an email alert.
- On a free-trial account, Oracle may reclaim idle Always Free VMs. Upgrading to Pay As You Go (still $0 inside the limits) stops that.
- The Android app uses the same `VITE_API_URL`: build with it set, then `npx cap sync`.
