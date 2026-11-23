# Face recognition on the device

Face recognition now runs inside the web app and the Android app, not on the server.

## How it works

1. The app downloads three small models once (about 18 MB, then cached): `frontend/public/models/`
   - `scrfd_500m.onnx` finds the face and 5 landmarks
   - `arcface_mobilefacenet.onnx` turns the aligned face into a 512-number "face print"
   - `minifasnet.onnx` scores whether it is a real face or a photo/screen (liveness)
2. Code: `frontend/src/face/faceCore.js` (the maths, a port of InsightFace "buffalo_sc") and
   `frontend/src/face/faceEngine.js` (loads onnxruntime-web, reads images, caches models).
3. The app sends only the face print (`faceEmbedding`) and liveness score (`liveness`) to the server.
   `server.js` compares it with the stored prints (cosine similarity, threshold 0.40). No Python, no face server.

Checked against the old Python code: on the same images the browser's face prints match InsightFace's
with similarity 0.998 or higher (different people score about 0.05). A scan takes about 0.1 s after the
models load; the first scan on a device takes about 1 s plus the one-time download.

## One-time step after deploying: rebuild face data

Old face prints in MongoDB may come from a different model (the last server build used `buffalo_l`),
which would never match the new ones. After deploying, log in as admin and press
**Rebuild Face Data** (sidebar, under Add Employee). It reads each employee's stored photos, computes new
face prints in your browser and saves them. Keep the tab open until it finishes (roughly 1-2 minutes for
50 employees). Employees with fewer than 4 photos are skipped; add photos for them in their profile.

Adding or removing photos in an employee's profile, adding an employee, and editing photos now
recompute the face print on the admin's device automatically.

## Settings (backend/.env, optional)

- `FACE_MATCH_THRESHOLD` (default `0.40`): higher is stricter.
- `LIVENESS_MIN` (default `0.35`): minimum real-face score for scans. Set to `0` to switch the liveness
  check off if it rejects real people on poor cameras.

## Security tradeoff

The server can no longer see the face, it only trusts what the app sends. Someone who modifies the
app (or calls the API directly) could send a fake liveness score, or replay a face print they captured
earlier. The old Python check could be fooled too, but this makes it easier for a technical attacker.
For an office of about 50 people this is usually acceptable; the geofence/VPN checks, rate limits and
admin approval still apply. If it ever matters, the fix is to run the liveness model on the server again
for scans only (it is small: 1.7 MB).

## Developer notes

- `npm install` in `frontend/` adds `onnxruntime-web`. It is loaded only on pages that scan faces.
- Firebase serves `/models/**` and `/assets/**` with a 1-year cache (`firebase.json`). If you replace a
  model file, bump `MODEL_VERSION` in `faceEngine.js`.
- In the Android app the models ship inside the APK (`npx cap sync` copies `dist/`), so they work offline.
- `backend/face_service.py`, `recognition.py`, `extract_embedding.py`, `utils/faceRecognition.js`,
  `api/*.py` and `biometric_microservice/` are no longer used. They are left in place; delete them when
  you are happy with the new flow.
