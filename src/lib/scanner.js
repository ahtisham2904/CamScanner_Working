    /* ============================================================
    scanner.js  — professional document pipeline
    - ensureOpenCV(): lazy-loads OpenCV.js (WASM)
    - detectDocument(canvas): finds the document QUADRILATERAL
        (4 independent corners, handles tilt/perspective)
    - magicColorPro(data,w,h): shadow removal + auto white-balance
    - warpBilinear(srcCanvas, corners): smooth perspective de-skew
    ============================================================ */

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    /* ---------- OpenCV loader (robust across builds) ---------- */
    let cvPromise = null;
export function ensureOpenCV() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const deadline = Date.now() + 20000; // 20s max, then give up
    const ready = () => {
      if (window.cv && window.cv.Mat) return resolve(window.cv);
      if (Date.now() > deadline) { cvPromise = null; return reject(new Error("OpenCV load timed out")); }
      setTimeout(ready, 50);
    };
    let s = document.getElementById("opencv-js");
    if (!s) {
      s = document.createElement("script");
      s.id = "opencv-js";
      s.async = true;
      s.src = "https://docs.opencv.org/4.9.0/opencv.js";
      s.onerror = () => { cvPromise = null; reject(new Error("Failed to load OpenCV.js")); };
      s.onload = () => {
        if (window.cv && typeof window.cv.then === "function") {
          window.cv.then((c) => { window.cv = c; resolve(c); });
        } else ready();
      };
      document.body.appendChild(s);
    } else ready();
  });
  return cvPromise;
}

    /* order 4 points -> [TL, TR, BR, BL] (classic sum/diff method) */
    function orderCorners(pts) {
    const sum = pts.map((p) => p.x + p.y);
    const diff = pts.map((p) => p.y - p.x);
    return [
        pts[sum.indexOf(Math.min(...sum))],   // TL
        pts[diff.indexOf(Math.min(...diff))], // TR
        pts[sum.indexOf(Math.max(...sum))],   // BR
        pts[diff.indexOf(Math.max(...diff))], // BL
    ];
}

    /* ---------- document detection (the professional part) ---------- */
    /* Returns 4 ordered corners in canvas pixel coords, or null. */
    export async function detectDocument(canvas) {
    let cv;
    try { cv = await ensureOpenCV(); } catch { return null; }

    const W = canvas.width, H = canvas.height;
    let src, small, gray, edges, kernel, contours, hierarchy;
    try {
        src = cv.imread(canvas);
        // downscale for speed + noise reduction
        const scale = 600 / Math.max(W, H);
        small = new cv.Mat();
        cv.resize(src, small, new cv.Size(Math.round(W * scale), Math.round(H * scale)));

        gray = new cv.Mat();
        cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

        edges = new cv.Mat();
        cv.Canny(gray, edges, 60, 180);
        kernel = cv.Mat.ones(5, 5, cv.CV_8U);
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel); // close gaps in the border

        contours = new cv.MatVector();
        hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        const imgArea = small.rows * small.cols;
        let bestPts = null, bestArea = 0;

        for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const peri = cv.arcLength(c, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * peri, true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const area = cv.contourArea(approx);
            if (area > bestArea && area > imgArea * 0.18) {
            bestArea = area;
            bestPts = [];
            for (let k = 0; k < 4; k++)
                bestPts.push({ x: approx.data32S[k * 2] / scale, y: approx.data32S[k * 2 + 1] / scale });
            }
        }
        approx.delete(); c.delete();
        }
        return bestPts ? orderCorners(bestPts) : null;
    } catch {
        return null;
    } finally {
        [src, small, gray, edges, kernel, contours, hierarchy].forEach((m) => m && m.delete && m.delete());
    }
}

    /* ---------- smooth perspective de-skew (bilinear) ---------- */
    function solveLinear(A, b) {
    const n = b.length;
    for (let i = 0; i < n; i++) A[i].push(b[i]);
    for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++)
        if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        [A[col], A[piv]] = [A[piv], A[col]];
        const d = A[col][col];
        if (Math.abs(d) < 1e-12) continue;
        for (let j = col; j <= n; j++) A[col][j] /= d;
        for (let r = 0; r < n; r++) {
        if (r === col) continue;
        const f = A[r][col]; if (!f) continue;
        for (let j = col; j <= n; j++) A[r][j] -= f * A[col][j];
        }
    }
    return A.map((row) => row[n]);
}
function perspectiveCoeffs(srcPts, dstPts) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
        const { x, y } = srcPts[i], { x: u, y: v } = dstPts[i];
        A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
        A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
    }
    return solveLinear(A, b);
}

export function warpBilinear(srcCanvas, corners, maxDim = 1600) {
    const [tl, tr, br, bl] = corners;
    let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
    let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
    const s = Math.min(1, maxDim / Math.max(outW, outH));
    outW = Math.max(1, Math.round(outW * s));
    outH = Math.max(1, Math.round(outH * s));

    const rect = [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }];
    const H = perspectiveCoeffs(rect, corners);

    const sctx = srcCanvas.getContext("2d");
    const sd = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height).data;
    const sw = srcCanvas.width, sh = srcCanvas.height;

    const out = document.createElement("canvas");
    out.width = outW; out.height = outH;
    const octx = out.getContext("2d");
    const oImg = octx.createImageData(outW, outH);
    const od = oImg.data;

    const sample = (x, y, c) => {
        if (x < 0 || y < 0 || x >= sw || y >= sh) return 255;
        return sd[(y * sw + x) * 4 + c];
    };

    for (let y = 0; y < outH; y++) {
        for (let x = 0; x < outW; x++) {
        const den = H[6] * x + H[7] * y + 1;
        const fx = (H[0] * x + H[1] * y + H[2]) / den;
        const fy = (H[3] * x + H[4] * y + H[5]) / den;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const ax = fx - x0, ay = fy - y0;
        const o = (y * outW + x) * 4;
        for (let c = 0; c < 3; c++) {
            const top = sample(x0, y0, c) * (1 - ax) + sample(x0 + 1, y0, c) * ax;
            const bot = sample(x0, y0 + 1, c) * (1 - ax) + sample(x0 + 1, y0 + 1, c) * ax;
            od[o + c] = top * (1 - ay) + bot * ay;
        }
        od[o + 3] = 255;
        }
    }
    octx.putImageData(oImg, 0, 0);
    return out;
}

    /* ---------- professional "Magic Color" ----------
    Removes uneven lighting/shadows and color cast by dividing each
    channel by its large-radius blurred background (the trick that
    makes phone photos look like flatbed scans), then mild contrast
    + saturation. Pure JS, no OpenCV needed.                       */
    function boxBlurChannel(src, w, h, ch, r) {
    const iw = w + 1;
    const integ = new Float64Array(iw * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
        row += src[(y * w + x) * 4 + ch];
        integ[(y + 1) * iw + (x + 1)] = integ[y * iw + (x + 1)] + row;
        }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
        const x2 = Math.min(w - 1, x + r), y2 = Math.min(h - 1, y + r);
        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum =
            integ[(y2 + 1) * iw + (x2 + 1)] - integ[y1 * iw + (x2 + 1)] -
            integ[(y2 + 1) * iw + x1] + integ[y1 * iw + x1];
        out[y * w + x] = sum / area;
        }
    return out;
}

    export function magicColorPro(d, w, h) {
    const r = Math.max(12, Math.round(Math.max(w, h) / 12));
    const bg = [boxBlurChannel(d, w, h, 0, r), boxBlurChannel(d, w, h, 1, r), boxBlurChannel(d, w, h, 2, r)];
    const contrast = 1.18; // gentle text deepening
    const sat = 1.12;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
        const ch = [d[i], d[i + 1], d[i + 2]].map((v, c) => {
        let nv = (v / Math.max(bg[c][p], 1)) * 235;          // normalize toward white
        nv = ((nv / 255 - 0.5) * contrast + 0.5) * 255;       // contrast
        return clamp(nv, 0, 255);
        });
        const lum = 0.299 * ch[0] + 0.587 * ch[1] + 0.114 * ch[2];
        d[i] = clamp(lum + (ch[0] - lum) * sat, 0, 255);
        d[i + 1] = clamp(lum + (ch[1] - lum) * sat, 0, 255);
        d[i + 2] = clamp(lum + (ch[2] - lum) * sat, 0, 255);
    }
}
