# Deploy everything on Vercel (free Hobby plan)

One Vercel project serves the website (`frontend/dist`) and the API (`api/index.js` runs `backend/server.js`
as a serverless function). Face recognition runs on each phone or browser, so the API stays light.

Never paste passwords or tokens into chat.

## 1. MongoDB Atlas: allow Vercel

Vercel's IP addresses change, so Atlas must accept any address (the password still protects it):
Atlas → **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`) → Confirm.

## 2. Make two random secrets (cmd)

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy the first as `JWT_SECRET` and the second as `CRON_SECRET`.

## 3. Push the code (cmd)

```
cd C:\Users\abdul\PROJECTS\attendance-web-app-main
git add -A
git commit -m "Deploy on Vercel"
git push
```

## 4. Import into Vercel

1. https://vercel.com/new → sign in with the GitHub account that owns the repo → **Import** the `attendance-web-app` repo.
2. **Framework Preset**: Other. **Root Directory**: leave as `./`. Leave the build settings alone (they come from `vercel.json`).
3. Open **Environment Variables** and add:

| Name | Value |
|---|---|
| `MONGO_URI` | your Atlas connection string (the one in `backend\.env`, ending in `/attendance?...`) |
| `JWT_SECRET` | first secret from step 2 |
| `CRON_SECRET` | second secret from step 2 |
| `ADMIN_USERNAME` | `usman.ghani` |
| `ADMIN_PASSWORD` | your admin password |
| `NODE_ENV` | `production` |

4. **Deploy**. When it finishes you get an address like `https://attendance-web-app-xxxx.vercel.app`.

Test: open `https://<your-address>/health`. It should show `{"ok":true,"db":true}` (the first request after a quiet
period can take a few seconds while the function starts).

Then log in as admin and press **Rebuild Face Data** once (see `FACE_ON_DEVICE.md`).

`VITE_API_URL` is **not** needed for the website: it calls the API on its own address.

## 5. Android app

The app has no web address of its own, so build it with your Vercel address (cmd):
```
cd C:\Users\abdul\PROJECTS\attendance-web-app-main\frontend
set VITE_API_URL=https://<your-address>
npm run build
npx cap sync
```
Then build the APK in Android Studio as before.

## What changed for serverless

- MongoDB: one cached connection per function instance, retried on the next request if it fails.
- Background timers don't run on Vercel. The daily "mark absent" job now runs from Vercel Cron
  (`/api/cron/auto-absent`, every day 00:00 Pakistan time, protected by `CRON_SECRET`). A 10-second
  "auto-accept" timer that never changed anything was removed.
- The face-match cache reloads when it is empty or older than 1 minute, because each instance has its own memory.
- Vercel rejects request bodies over 4.5 MB. Photos are already shrunk to 500 px JPEG in the browser
  (about 50 KB each), so adding an employee with 5 photos is well under the limit.
- Rate limits are counted per function instance, so they are looser than on a single server.
- The old Python files are excluded from the deployment by `.vercelignore`.
