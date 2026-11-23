// Pure-JS face pipeline (no DOM), a port of InsightFace "buffalo_sc":
//   SCRFD-500M detection -> 5-point similarity alignment -> MobileFaceNet (w600k_mbf) 512-d embedding
// plus MiniFASNetV2 (Silent-Face 2.7_80x80) liveness.
// It mirrors insightface's SCRFD.detect / face_align.norm_crop / ArcFaceONNX.get_feat so the
// embeddings land in the same space as the Python service that produced the stored ones.
//
// Images are { data: Uint8ClampedArray RGBA, width, height }.
// `ort` is the onnxruntime module (onnxruntime-web in the app, onnxruntime-node in tests).

export const EMBEDDING_DIM = 512;
const DET_SIZE = 320;
const DET_THRESH = 0.5;
const NMS_THRESH = 0.4;
const STRIDES = [8, 16, 32];
const NUM_ANCHORS = 2;

// ArcFace canonical 112x112 landmark template (insightface face_align.arcface_dst)
const ARCFACE_DST = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

// ---------- image helpers ----------

// Bilinear resize matching cv2.INTER_LINEAR (half-pixel centres, edge clamp). Returns RGB Float32 planes? No: RGBA bytes.
export function resizeBilinear(img, outW, outH) {
  const { data, width: inW, height: inH } = img;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sx = inW / outW;
  const sy = inH / outH;
  for (let y = 0; y < outH; y++) {
    let fy = (y + 0.5) * sy - 0.5;
    if (fy < 0) fy = 0;
    let y0 = Math.floor(fy);
    if (y0 > inH - 1) y0 = inH - 1;
    const y1 = Math.min(y0 + 1, inH - 1);
    const wy = fy - y0;
    for (let x = 0; x < outW; x++) {
      let fx = (x + 0.5) * sx - 0.5;
      if (fx < 0) fx = 0;
      let x0 = Math.floor(fx);
      if (x0 > inW - 1) x0 = inW - 1;
      const x1 = Math.min(x0 + 1, inW - 1);
      const wx = fx - x0;
      const i00 = (y0 * inW + x0) * 4, i01 = (y0 * inW + x1) * 4;
      const i10 = (y1 * inW + x0) * 4, i11 = (y1 * inW + x1) * 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[i00 + c] * (1 - wx) + data[i01 + c] * wx;
        const bot = data[i10 + c] * (1 - wx) + data[i11 + c] * wx;
        out[o + c] = top * (1 - wy) + bot * wy + 0.5;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

// Inverse-mapped affine warp (like cv2.warpAffine, INTER_LINEAR, constant 0 border). M maps src -> dst.
function warpAffine(img, M, outW, outH) {
  const [[a, b, c], [d, e, f]] = M;
  const det = a * e - b * d;
  const ia = e / det, ib = -b / det, id = -d / det, ie = a / det;
  const ic = -(ia * c + ib * f), ifx = -(id * c + ie * f);
  const { data, width: W, height: H } = img;
  const out = new Uint8ClampedArray(outW * outH * 4);
  const px = (xx, yy, ch) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : data[(yy * W + xx) * 4 + ch]);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = ia * x + ib * y + ic;
      const sy = id * x + ie * y + ifx;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const wx = sx - x0, wy = sy - y0;
      const o = (y * outW + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = px(x0, y0, ch) * (1 - wx) + px(x0 + 1, y0, ch) * wx;
        const bot = px(x0, y0 + 1, ch) * (1 - wx) + px(x0 + 1, y0 + 1, ch) * wx;
        out[o + ch] = top * (1 - wy) + bot * wy + 0.5;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: outW, height: outH };
}

// Umeyama least-squares similarity transform (skimage SimilarityTransform.estimate), src -> dst, 2D.
function similarityTransform(src, dst) {
  const n = src.length;
  let msx = 0, msy = 0, mdx = 0, mdy = 0;
  for (let i = 0; i < n; i++) { msx += src[i][0]; msy += src[i][1]; mdx += dst[i][0]; mdy += dst[i][1]; }
  msx /= n; msy /= n; mdx /= n; mdy /= n;
  // covariance A = dst_c^T * src_c / n, and src variance
  let a00 = 0, a01 = 0, a10 = 0, a11 = 0, varS = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - msx, sy = src[i][1] - msy;
    const dx = dst[i][0] - mdx, dy = dst[i][1] - mdy;
    a00 += dx * sx; a01 += dx * sy; a10 += dy * sx; a11 += dy * sy;
    varS += sx * sx + sy * sy;
  }
  a00 /= n; a01 /= n; a10 /= n; a11 /= n; varS /= n;
  // For a 2D similarity, rotation+scale is [[p, -q],[q, p]] minimising the error:
  // p = (a00 + a11) * k, q = (a10 - a01) * k, with k = 1/varS (reflection never wins for face landmarks).
  const p = (a00 + a11) / varS;
  const q = (a10 - a01) / varS;
  const tx = mdx - (p * msx - q * msy);
  const ty = mdy - (q * msx + p * msy);
  return [[p, -q, tx], [q, p, ty]];
}

// insightface face_align.norm_crop(img, kps, 112)
export function alignFace(img, kps) {
  const M = similarityTransform(kps, ARCFACE_DST);
  return warpAffine(img, M, 112, 112);
}

// ---------- detection ----------

function nms(dets, thresh) {
  // dets: [{box:[x1,y1,x2,y2], score, kps}] sorted by score desc
  const keep = [];
  const suppressed = new Array(dets.length).fill(false);
  for (let i = 0; i < dets.length; i++) {
    if (suppressed[i]) continue;
    keep.push(dets[i]);
    const [x1, y1, x2, y2] = dets[i].box;
    const areaI = (x2 - x1 + 1) * (y2 - y1 + 1);
    for (let j = i + 1; j < dets.length; j++) {
      if (suppressed[j]) continue;
      const [u1, v1, u2, v2] = dets[j].box;
      const w = Math.max(0, Math.min(x2, u2) - Math.max(x1, u1) + 1);
      const h = Math.max(0, Math.min(y2, v2) - Math.max(y1, v1) + 1);
      const inter = w * h;
      const areaJ = (u2 - u1 + 1) * (v2 - v1 + 1);
      if (inter / (areaI + areaJ - inter) > thresh) suppressed[j] = true;
    }
  }
  return keep;
}

// Returns faces sorted by detector score (best first): [{box:[x1,y1,x2,y2], score, kps:[[x,y]*5]}]
export async function detectFaces(ort, detSession, img) {
  const imRatio = img.height / img.width;
  let newW, newH;
  if (imRatio > 1) { newH = DET_SIZE; newW = Math.floor(newH / imRatio); }
  else { newW = DET_SIZE; newH = Math.floor(newW * imRatio); }
  const detScale = newH / img.height;
  const resized = resizeBilinear(img, newW, newH);

  // blobFromImage(det_img, 1/128, size, (127.5,127.5,127.5), swapRB=True) on a zero-padded 320x320 canvas
  const plane = DET_SIZE * DET_SIZE;
  const input = new Float32Array(3 * plane).fill((0 - 127.5) / 128);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const s = (y * newW + x) * 4;
      const d = y * DET_SIZE + x;
      input[d] = (resized.data[s] - 127.5) / 128;
      input[plane + d] = (resized.data[s + 1] - 127.5) / 128;
      input[2 * plane + d] = (resized.data[s + 2] - 127.5) / 128;
    }
  }
  const feeds = { [detSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]) };
  const out = await detSession.run(feeds);
  const outs = detSession.outputNames.map(n => out[n].data);

  const dets = [];
  STRIDES.forEach((stride, idx) => {
    const scores = outs[idx];
    const bboxes = outs[idx + 3];
    const kpss = outs[idx + 6];
    const fw = Math.floor(DET_SIZE / stride);
    const fh = fw;
    for (let cy = 0; cy < fh; cy++) {
      for (let cx = 0; cx < fw; cx++) {
        for (let a = 0; a < NUM_ANCHORS; a++) {
          const i = (cy * fw + cx) * NUM_ANCHORS + a;
          const score = scores[i];
          if (score < DET_THRESH) continue;
          const ax = cx * stride, ay = cy * stride;
          const box = [
            (ax - bboxes[i * 4] * stride) / detScale,
            (ay - bboxes[i * 4 + 1] * stride) / detScale,
            (ax + bboxes[i * 4 + 2] * stride) / detScale,
            (ay + bboxes[i * 4 + 3] * stride) / detScale,
          ];
          const kps = [];
          for (let k = 0; k < 5; k++) {
            kps.push([
              (ax + kpss[i * 10 + k * 2] * stride) / detScale,
              (ay + kpss[i * 10 + k * 2 + 1] * stride) / detScale,
            ]);
          }
          dets.push({ box, score, kps });
        }
      }
    }
  });
  dets.sort((p, q) => q.score - p.score);
  return nms(dets, NMS_THRESH);
}

// ---------- recognition ----------

export async function embedAligned(ort, recSession, aligned) {
  // blobFromImage(aligned, 1/127.5, (112,112), (127.5,)*3, swapRB=True)
  const plane = 112 * 112;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    input[i] = (aligned.data[i * 4] - 127.5) / 127.5;
    input[plane + i] = (aligned.data[i * 4 + 1] - 127.5) / 127.5;
    input[2 * plane + i] = (aligned.data[i * 4 + 2] - 127.5) / 127.5;
  }
  const out = await recSession.run({ [recSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 112, 112]) });
  return l2normalize(Array.from(out[recSession.outputNames[0]].data));
}

export function l2normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---------- liveness (MiniFASNetV2, Silent-Face-Anti-Spoofing 2.7_80x80) ----------

// Silent-Face CropImage: box grown 2.7x around its centre, shifted to stay inside the frame, resized to 80x80.
function livenessCrop(img, box) {
  const [x1, y1, x2, y2] = box;
  const bw = x2 - x1, bh = y2 - y1;
  const srcW = img.width, srcH = img.height;
  const scale = Math.min((srcH - 1) / bh, (srcW - 1) / bw, 2.7);
  const nw = bw * scale, nh = bh * scale;
  const cx = x1 + bw / 2, cy = y1 + bh / 2;
  let lx = cx - nw / 2, ly = cy - nh / 2, rx = cx + nw / 2, ry = cy + nh / 2;
  if (lx < 0) { rx -= lx; lx = 0; }
  if (ly < 0) { ry -= ly; ly = 0; }
  if (rx > srcW - 1) { lx -= rx - srcW + 1; rx = srcW - 1; }
  if (ry > srcH - 1) { ly -= ry - srcH + 1; ry = srcH - 1; }
  lx = Math.trunc(lx); ly = Math.trunc(ly); rx = Math.trunc(rx); ry = Math.trunc(ry);
  const cw = rx - lx + 1, ch = ry - ly + 1;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const srcRow = ((ly + y) * srcW + lx) * 4;
    crop.set(img.data.subarray(srcRow, srcRow + cw * 4), y * cw * 4);
  }
  return resizeBilinear({ data: crop, width: cw, height: ch }, 80, 80);
}

// Probability that the face is a live person (upstream label 1 = real; 0/2 = print/replay attacks).
export async function livenessScore(ort, fasSession, img, box) {
  const c = livenessCrop(img, box);
  const plane = 80 * 80;
  const input = new Float32Array(3 * plane);
  // Upstream feeds raw 0..255 BGR values (its to_tensor does not divide by 255)
  for (let i = 0; i < plane; i++) {
    input[i] = c.data[i * 4 + 2];
    input[plane + i] = c.data[i * 4 + 1];
    input[2 * plane + i] = c.data[i * 4];
  }
  const out = await fasSession.run({ [fasSession.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, 80, 80]) });
  const logits = Array.from(out[fasSession.outputNames[0]].data);
  const m = Math.max(...logits);
  const exps = logits.map(v => Math.exp(v - m));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps[1] / sum;
}
