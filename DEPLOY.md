# Deploying for free, 24/7

- **Frontend** (`frontend/`): Vercel free tier
- **Backend + face recognition** (`backend/`): one Docker container on an Oracle Cloud Always Free VM, behind Caddy for HTTPS
- **Database**: your MongoDB Atlas M0 cluster (the `MONGO_URI` already in `backend/.env`)

The steps below are the ones only you can do, because they need your accounts.

## 1. Create the Oracle VM

1. Sign up at https://signup.oraclecloud.com (needs a card for identity check; Always Free resources are not charged). Pick a home region close to your users. You cannot change it later.
2. Console → **Compute → Instances → Create instance**.
   - Image: **Ubuntu 22.04** (or 24.04).
   - Shape: **Ampere → VM.Standard.A1.Flex**, 2 OCPU and 12 GB RAM (free limit is 4 OCPU / 24 GB total).
   - Networking: keep "Assign a public IPv4 address" on.
   - SSH keys: download the generated private key (or paste your own public key).
   - If you get "Out of capacity", try another availability domain or try again later.
3. Note the instance's **Public IP**, e.g. `129.10.20.30`.

## 2. Open ports 80 and 443

Oracle blocks them in two places.

1. **Cloud firewall**: Instance page → Subnet → Default Security List → **Add Ingress Rules**: Source CIDR `0.0.0.0/0`, TCP, destination ports `80,443`.
2. **VM firewall**: SSH in (`ssh -i your-key.key ubuntu@129.10.20.30`) and run:
   ```bash
   sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## 3. Whitelist the VM in Atlas

Atlas → **Network Access → Add IP Address** → enter the VM's public IP (`129.10.20.30/32`). Keep your own IP too so local dev still works.

## 4. Run the backend on the VM

On the VM:

```bash
# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# Code: clone your repo, or copy the folder up with scp from your PC
git clone <your-repo-url> attendance && cd attendance
```

Create the two env files (they are git-ignored, never commit them):

```bash
nano backend/.env
```
```
MONGO_URI=<your Atlas URI, same as local>
JWT_SECRET=<a long random string, e.g. output of: openssl rand -hex 32>
ADMIN_USERNAME=usman.ghani
ADMIN_PASSWORD=<admin password>
```

```bash
cp .env.example .env && nano .env
```
Set `API_DOMAIN` to your IP with dashes plus `.sslip.io`, e.g. `API_DOMAIN=api.129-10-20-30.sslip.io`. sslip.io is a free DNS name that points at your IP, so Caddy can get a real HTTPS certificate without you buying a domain. If you own a domain, point an A record at the VM and use that instead.

Start it:

```bash
docker compose up -d --build     # first build takes ~10-15 min on ARM (insightface compiles)
docker compose logs -f backend   # expect "Connected to MongoDB" and "Server running on port 5000"
```

Check `https://api.129-10-20-30.sslip.io/api/time` in a browser. The first face scan is slow while the face model (~300 MB) downloads; after that it is cached in a Docker volume.

Containers restart on their own after crashes and VM reboots.

**Updating later:** `git pull && docker compose up -d --build`.

## 5. Deploy the frontend on Vercel

1. Push the project to a GitHub repo (private is fine) and sign in at https://vercel.com with GitHub.
2. **Add New → Project** → import the repo.
   - **Root Directory: `frontend`** (Vercel then detects Vite; build `npm run build`, output `dist`).
   - **Environment Variables**: `VITE_API_URL` = `https://api.129-10-20-30.sslip.io` (no trailing slash).
3. Deploy. Your app is at `https://<project>.vercel.app`.

If you change `VITE_API_URL` later, redeploy, because it is baked in at build time.

## Android app

The Capacitor app uses the same `VITE_API_URL`. Build it with the variable set (`VITE_API_URL=https://api... npm run build && npx cap sync`) so it talks to the VM.

## Notes

- Oracle may reclaim Always Free VMs that sit almost idle for 7 days (CPU under ~20%). Upgrading the account to Pay As You Go (still free within limits) avoids this.
- CORS already accepts any origin, so the Vercel domain needs no extra config.
