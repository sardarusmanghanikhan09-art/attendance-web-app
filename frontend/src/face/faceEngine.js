// On-device face recognition for the web app and the Capacitor Android app.
// The three ONNX models (~18 MB total) live in /public/models and are downloaded once, then cached.
// The backend only receives the 512-d embedding (plus a liveness score) and does the matching.
import { detectFaces, alignFace, embedAligned, livenessScore, l2normalize } from './faceCore';

// Bump when a model file changes so browsers fetch the new one
const MODEL_VERSION = '1';
const MODEL_FILES = {
  det: 'scrfd_500m.onnx',
  rec: 'arcface_mobilefacenet.onnx',
  fas: 'minifasnet.onnx',
};
const CACHE_NAME = `face-models-v${MODEL_VERSION}`;

let ort = null; // onnxruntime-web, loaded on first use so pages without face scanning stay light
let sessionsPromise = null;

async function fetchModel(file) {
  const url = `${import.meta.env.BASE_URL}models/${file}?v=${MODEL_VERSION}`;
  // Cache Storage keeps the models across visits even if the HTTP cache is cleared
  let cache = null;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open(CACHE_NAME);
  } catch { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) return new Uint8Array(await hit.arrayBuffer());
    } catch { /* fall through to network */ }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download face model ${file} (HTTP ${res.status})`);
  if (cache) {
    try { await cache.put(url, res.clone()); } catch { /* quota or opaque response: ignore */ }
  }
  return new Uint8Array(await res.arrayBuffer());
}

function loadSessions() {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      if (!ort) {
        ort = await import('onnxruntime-web/wasm');
        ort.env.wasm.numThreads = 1; // threaded wasm needs cross-origin isolation, which Firebase/Capacitor do not set
      }
      // logSeverityLevel 3: hide the detector's harmless dynamic-shape warnings
      const opts = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 };
      const [det, rec, fas] = await Promise.all(
        [MODEL_FILES.det, MODEL_FILES.rec, MODEL_FILES.fas].map(async f => ort.InferenceSession.create(await fetchModel(f), opts))
      );
      return { det, rec, fas };
    })();
    sessionsPromise.catch(() => { sessionsPromise = null; }); // allow a retry after a failed download
  }
  return sessionsPromise;
}

// Start downloading/compiling the models early (e.g. when the scan page opens) so the first scan is fast
export function preloadFaceModels() {
  return loadSessions().then(() => true).catch(err => { console.warn('Face model preload failed', err); return false; });
}

async function toImageData(src) {
  let blob = src;
  if (typeof src === 'string') blob = await (await fetch(src)).blob(); // data: URL or http URL
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width, h = bitmap.height;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  if (bitmap.close) bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  return { data, width: w, height: h };
}

// Analyse one image (Blob, File or data URL). Returns null when no face is found.
export async function analyzeFace(src, { liveness = false } = {}) {
  const { det, rec, fas } = await loadSessions();
  const img = await toImageData(src);
  const faces = await detectFaces(ort, det, img);
  if (!faces.length) return null;
  const face = faces[0]; // highest detector score, same as InsightFace's faces[0]
  const embedding = await embedAligned(ort, rec, alignFace(img, face.kps));
  const live = liveness ? await livenessScore(ort, fas, img, face.box) : null;
  return { embedding, liveness: live, box: face.box, score: face.score };
}

const round = v => Math.round(v * 1e6) / 1e6;

// Enrolment: average the embeddings of every photo that has a face, then re-normalise.
// Returns the fields to merge into the request body.
export async function enrollmentFields(photos) {
  const list = Array.isArray(photos) ? photos : [photos];
  const embs = [];
  for (const p of list) {
    const r = await analyzeFace(p);
    if (r) embs.push(r.embedding);
  }
  if (!embs.length) throw new Error('No face detected in the selected photos. Use clear, front-facing photos.');
  const avg = new Array(embs[0].length).fill(0);
  for (const e of embs) e.forEach((v, i) => { avg[i] += v; });
  return { faceEmbedding: l2normalize(avg).map(round), facePhotosWithFace: embs.length };
}

// Live scan: embedding from the last frame, liveness = best score over the captured frames.
export async function scanFields(...frames) {
  const valid = frames.filter(Boolean);
  let best = null;
  let livenessMax = 0;
  for (const f of valid) {
    const r = await analyzeFace(f, { liveness: true });
    if (!r) continue;
    livenessMax = Math.max(livenessMax, r.liveness);
    best = r; // keep the last frame with a face (frameB), like the server used to
  }
  if (!best) throw new Error('No face detected. Look straight at the camera in good light and try again.');
  return { faceEmbedding: best.embedding.map(round), liveness: Math.round(livenessMax * 1000) / 1000 };
}

// Recompute one employee's embedding on this device from the photos stored on the server and save it.
// `fetchFn` is the caller's authenticated fetch. Returns false when the employee has fewer than 4 photos.
export async function rebuildEmployeeFace(apiBase, employeeId, fetchFn, headers = {}) {
  const id = encodeURIComponent(employeeId);
  const res = await fetchFn(`${apiBase}/api/employees/${id}/photos?_t=${Date.now()}`, { credentials: 'include', headers });
  if (!res.ok) throw new Error(`Could not load photos (HTTP ${res.status})`);
  const photos = (await res.json())
    .filter(p => typeof p === 'string' && p.length > 100 && !p.startsWith('data:image/svg'))
    .map(p => (p.startsWith('data:') || p.startsWith('http') ? p : `data:image/jpeg;base64,${p}`));
  if (photos.length < 4) return false;
  const { faceEmbedding } = await enrollmentFields(photos);
  const save = await fetchFn(`${apiBase}/api/employees/${id}/face-embedding`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ faceEmbedding }),
  });
  if (!save.ok) {
    let msg = `HTTP ${save.status}`;
    try { msg = (await save.json()).error || msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return true;
}
