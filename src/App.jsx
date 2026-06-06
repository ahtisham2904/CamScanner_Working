import "./App.css";
import { jsPDF } from "jspdf";
import { detectDocument, magicColorPro, warpBilinear, ensureOpenCV } from "./lib/scanner";
import Camera from "./Camera";
import JSZip from "jszip";
import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Camera as CameraIcon, Upload, Image as ImageIcon, FileText, FileDown, Trash2,
  RotateCw, Check, X, Crop, Wand2, Sparkles,
  ChevronLeft, ChevronRight, Sun, Contrast, ScanLine, Files, Loader2, Square,
} from "lucide-react";

const MAX_IMPORT_DIM = 2000;
const MAX_WARP_DIM = 1600;

const uid = () => Math.random().toString(36).slice(2, 9);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

async function fileToScaledDataURL(file) {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);
  let { width: w, height: h } = img;
  const scale = Math.min(1, MAX_IMPORT_DIM / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", 0.92);
}

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

function perspectiveCoeffs(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  return solveLinear(A, b);
}

function warpToCanvas(srcCanvas, corners) {
  const [tl, tr, br, bl] = corners;
  let outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  let outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const s = Math.min(1, MAX_WARP_DIM / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * s));
  outH = Math.max(1, Math.round(outH * s));
  const rect = [
    { x: 0, y: 0 }, { x: outW, y: 0 },
    { x: outW, y: outH }, { x: 0, y: outH },
  ];
  const H = perspectiveCoeffs(rect, corners);
  const sctx = srcCanvas.getContext("2d");
  const sData = sctx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
  const sd = sData.data, sw = srcCanvas.width, sh = srcCanvas.height;
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const octx = out.getContext("2d");
  const oData = octx.createImageData(outW, outH);
  const od = oData.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const den = H[6] * x + H[7] * y + 1;
      const sx = (H[0] * x + H[1] * y + H[2]) / den;
      const sy = (H[3] * x + H[4] * y + H[5]) / den;
      const ix = sx | 0, iy = sy | 0;
      const o = (y * outW + x) * 4;
      if (ix >= 0 && ix < sw && iy >= 0 && iy < sh) {
        const si = (iy * sw + ix) * 4;
        od[o] = sd[si]; od[o + 1] = sd[si + 1];
        od[o + 2] = sd[si + 2]; od[o + 3] = 255;
      } else { od[o + 3] = 255; od[o] = od[o + 1] = od[o + 2] = 255; }
    }
  }
  octx.putImageData(oData, 0, 0);
  return out;
}

function applyAdjust(d, brightness, contrast) {
  const c = (contrast / 100) + 1;
  const inter = 128 * (1 - c);
  for (let i = 0; i < d.length; i += 4)
    for (let k = 0; k < 3; k++)
      d[i + k] = clamp(d[i + k] * c + inter + brightness, 0, 255);
}

function toGrayscale(d) {
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
  }
}

function adaptiveBW(data, w, h) {
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++)
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const iw = w + 1;
  const integ = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integ[(y + 1) * iw + (x + 1)] = integ[y * iw + (x + 1)] + rowSum;
    }
  }
  const r = Math.max(8, Math.floor(Math.max(w, h) / 24));
  const C = 12;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
      const x2 = Math.min(w - 1, x + r), y2 = Math.min(h - 1, y + r);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integ[(y2 + 1) * iw + (x2 + 1)] - integ[y1 * iw + (x2 + 1)] -
        integ[(y2 + 1) * iw + x1] + integ[y1 * iw + x1];
      const mean = sum / area;
      const v = gray[y * w + x] > mean - C ? 255 : 0;
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
  }
}

function magicColor(d) {
  let max = 1;
  for (let i = 0; i < d.length; i += 4)
    max = Math.max(max, d[i], d[i + 1], d[i + 2]);
  const g = 255 / max;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * g, gr = d[i + 1] * g, b = d[i + 2] * g;
    const lum = 0.299 * r + 0.587 * gr + 0.114 * b;
    const sat = 1.25;
    r = clamp(lum + (r - lum) * sat, 0, 255);
    gr = clamp(lum + (gr - lum) * sat, 0, 255);
    b = clamp(lum + (b - lum) * sat, 0, 255);
    d[i] = r; d[i + 1] = gr; d[i + 2] = b;
  }
}

async function getBaseCanvas(page) {
  const img = await loadImage(page.original);
  const rot = page.rotation % 360;
  const swap = rot === 90 || rot === 270;
  const c = document.createElement("canvas");
  c.width = swap ? img.height : img.width;
  c.height = swap ? img.width : img.height;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}

async function processPage(page) {
  const base = await getBaseCanvas(page);
  const corners = page.corners || [
    { x: 0, y: 0 }, { x: base.width, y: 0 },
    { x: base.width, y: base.height }, { x: 0, y: base.height },
  ];
  const warped = warpBilinear(base, corners);
  const ctx = warped.getContext("2d");
  const imgData = ctx.getImageData(0, 0, warped.width, warped.height);
  const d = imgData.data;
  if (page.filter === "grayscale") { applyAdjust(d, page.brightness, page.contrast); toGrayscale(d); }
  else if (page.filter === "bw") { applyAdjust(d, page.brightness, page.contrast); adaptiveBW(d, warped.width, warped.height); }
  else if (page.filter === "magic") { magicColorPro(d, warped.width, warped.height); applyAdjust(d, page.brightness, page.contrast); }
  else { applyAdjust(d, page.brightness, page.contrast); }
  ctx.putImageData(imgData, 0, 0);
  return warped.toDataURL("image/jpeg", 0.92);
}

/* ============================================================
   IMPROVED AUTO-CROP: Sobel edge detection + projection scoring
   Works on varied/textured backgrounds, not just solid colors.
   ============================================================ */
async function autoCorners(page) {
  const base = await getBaseCanvas(page);
  return await detectDocument(base);
}

/* ============================================================
   UI
   ============================================================ */
const FILTERS = [
  { id: "original", label: "Original", icon: ImageIcon },
  { id: "magic", label: "Magic Color", icon: Sparkles },
  { id: "grayscale", label: "Grayscale", icon: Contrast },
  { id: "bw", label: "B & W", icon: ScanLine },
];

export default function App() {
  const [pages, setPages] = useState([]);
  const [view, setView] = useState("gallery");
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700;800&family=Spline+Sans:wght@400;500;600&display=swap";
    document.head.appendChild(l);
  }, []);

  const editPage = pages.find((p) => p.id === editId);

  async function handleFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;
    setBusy("Importing…");
    for (const f of files) {
      const original = await fileToScaledDataURL(f);
      const page = {
        id: uid(), original, rotation: 0, corners: null,
        filter: "original", brightness: 0, contrast: 0, thumb: original,
      };
      page.thumb = await processPage(page);
      setPages((prev) => [...prev, page]);
    }
    setBusy("");
    setView("gallery");
  }

  async function exportPDF() {
    if (!pages.length) return;
    setBusy("Building PDF…");
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      for (let i = 0; i < pages.length; i++) {
        const data = pages[i].thumb || (await processPage(pages[i]));
        const img = await loadImage(data);
        const ratio = Math.min(pw / img.width, ph / img.height);
        const w = img.width * ratio, h = img.height * ratio;
        if (i) doc.addPage();
        doc.addImage(data, "JPEG", (pw - w) / 2, (ph - h) / 2, w, h);
      }
      doc.save("scan.pdf");
    } catch (e) { alert("PDF export failed: " + e.message); }
    setBusy("");
  }

  async function exportImages() {
    if (!pages.length) return;
    setBusy("Zipping images…");
    try {
      const zip = new JSZip();
      for (let i = 0; i < pages.length; i++) {
        const data = pages[i].thumb || (await processPage(pages[i]));
        zip.file(`scan_${String(i + 1).padStart(2, "0")}.jpg`, data.split(",")[1], { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "scans.zip");
    } catch (e) { alert("Image export failed: " + e.message); }
    setBusy("");
  }

  async function exportWord() {
    if (!pages.length) return;
    setBusy("Building Word doc…");
    let imgs = "";
    for (const p of pages) {
      const data = p.thumb || (await processPage(p));
      imgs += `<p><img src="${data}" style="width:100%;max-width:620px"/></p>`;
    }
    const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office'
      xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>Scan</title></head><body>${imgs}</body></html>`;
    downloadBlob(new Blob([html], { type: "application/msword" }), "scan.doc");
    setBusy("");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function toggleSel(id) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function batchFilter(filterId) {
    const ids = selected.size ? selected : new Set(pages.map((p) => p.id));
    setBusy("Applying to batch…");
    for (const p of pages) {
      if (!ids.has(p.id)) continue;
      const np = { ...p, filter: filterId };
      np.thumb = await processPage(np);
      setPages((prev) => prev.map((x) => (x.id === p.id ? np : x)));
    }
    setBusy("");
  }

  function deleteSelected() {
    const ids = selected.size ? selected : null;
    if (!ids) return;
    setPages((prev) => prev.filter((p) => !ids.has(p.id)));
    setSelected(new Set());
  }

  function movePage(id, dir) {
    setPages((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
  }

  return (
    <div className="app-shell">
      <div className="app-bg">
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-header-logo">
              <ScanLine size={20} />
            </div>
            <div className="app-header-text">
              <h1 className="app-header-title">PaperPress</h1>
              <p className="app-header-sub">{pages.length} page{pages.length !== 1 && "s"} · client-side scanner</p>
            </div>
            {view === "gallery" && pages.length > 0 && (
              <span className="app-header-hint">
                {selected.size ? `${selected.size} selected` : "tap to select"}
              </span>
            )}
          </div>
        </header>

        <main className="app-main">
          {busy && (
            <div className="busy-overlay">
              <div className="busy-box">
                <Loader2 size={20} className="spin" />
                <span>{busy}</span>
              </div>
            </div>
          )}

          {view === "edit" && editPage
            ? <Editor page={editPage} onClose={() => { setView("gallery"); setEditId(null); }}
                onSave={(np) => { setPages((prev) => prev.map((p) => p.id === np.id ? np : p)); }} />
            : <Gallery
                pages={pages} selected={selected} toggleSel={toggleSel}
                onEdit={(id) => { setEditId(id); setView("edit"); }}
                onAdd={() => fileRef.current?.click()}
                movePage={movePage}
              />}
        </main>

        {view === "gallery" && (
          <div className="action-bar">
            <div className="action-bar-inner">
              {pages.length > 0 && (
                <div className="action-bar-filters">
                  {FILTERS.map((f) => (
                    <button key={f.id} onClick={() => batchFilter(f.id)} className="filter-chip">
                      <f.icon size={14} />{f.label}
                    </button>
                  ))}
                  <button onClick={deleteSelected} className="filter-chip filter-chip-delete">
                    <Trash2 size={14} />Delete
                  </button>
                </div>
              )}
              <div className="action-bar-row">
                <button onClick={() => fileRef.current?.click()} className="btn-primary">
                  <Upload size={16} />Add pages
                </button>
                <ExportMenu disabled={!pages.length} onPDF={exportPDF} onImages={exportImages} onWord={exportWord} />
              </div>
            </div>
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" multiple capture="environment"
          className="hidden-file-input" onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
      </div>
    </div>
  );
}

/* ---------- Gallery ---------- */
function Gallery({ pages, selected, toggleSel, onEdit, onAdd, movePage }) {
  if (!pages.length)
    return (
      <div className="gallery-empty">
        <div className="gallery-empty-icon"><Files size={36} /></div>
        <h2 className="gallery-empty-title">Scan something</h2>
        <p className="gallery-empty-desc">
          Snap a photo or pick images. Edges get straightened, then export as PDF, images, or Word.
        </p>
        <button onClick={onAdd} className="gallery-empty-btn">
          <CameraIcon size={16} />Capture / Upload
        </button>
      </div>
    );

  return (
    <div className="gallery-grid">
      {pages.map((p, i) => {
        const isSel = selected.has(p.id);
        return (
          <div key={p.id} className={`gallery-card${isSel ? " selected" : ""}`}>
            <button onClick={() => toggleSel(p.id)} className="gallery-card-thumb">
              <img src={p.thumb} alt="" />
            </button>
            <div className={`gallery-card-badge${isSel ? " selected-badge" : ""}`}>
              {isSel ? <Check size={14} /> : i + 1}
            </div>
            <div className="gallery-card-footer">
              <div className="gallery-card-moves">
                <button onClick={() => movePage(p.id, -1)} className="gallery-card-move-btn"><ChevronLeft size={14} /></button>
                <button onClick={() => movePage(p.id, 1)} className="gallery-card-move-btn"><ChevronRight size={14} /></button>
              </div>
              <button onClick={() => onEdit(p.id)} className="gallery-card-edit-btn">
                <Crop size={12} />Edit
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Export Menu ---------- */
function ExportMenu({ disabled, onPDF, onImages, onWord }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="export-menu-wrap">
      <button disabled={disabled} onClick={() => setOpen((o) => !o)} className="btn-outline">
        <FileDown size={16} />Export
      </button>
      {open && !disabled && (
        <>
          <div className="export-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="export-menu-dropdown">
            {[
              { l: "PDF document", i: FileText, fn: onPDF },
              { l: "Images (.zip)", i: ImageIcon, fn: onImages },
              { l: "Word (.doc)", i: FileDown, fn: onWord },
            ].map((o) => (
              <button key={o.l} onClick={() => { setOpen(false); o.fn(); }} className="export-menu-item">
                <o.i size={16} />{o.l}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ============================================================
   IMPROVED EDITOR — larger handles, overlay mask, active highlight
   ============================================================ */
function Editor({ page, onClose, onSave }) {
  const [local, setLocal] = useState(page);
  const [base, setBase] = useState(null);
  const [corners, setCorners] = useState(null);
  const [preview, setPreview] = useState(page.thumb);
  const [drag, setDrag] = useState(-1);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef(null);
  const [stageW, setStageW] = useState(0);

  // build rotated base canvas
  useEffect(() => {
    let alive = true;
    (async () => {
      const b = await getBaseCanvas(local);
      if (!alive) return;
      setBase(b);
      setCorners(local.corners || defaultCorners(b));
    })();
    return () => { alive = false; };
  }, [local.rotation, local.original]); // eslint-disable-line

  const imgRef = useRef(null);
  const [imgBox, setImgBox] = useState({ w: 0, h: 0 });
  const baseUrl = base ? base.toDataURL("image/jpeg", 0.85) : null;
  const scale = base && imgBox.w ? imgBox.w / base.width : 1;
  useEffect(() => {
    const measure = () => {
      if (imgRef.current) setImgBox({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (imgRef.current) ro.observe(imgRef.current);
    window.addEventListener("orientationchange", measure);
    return () => { ro.disconnect(); window.removeEventListener("orientationchange", measure); };
  }, [base, baseUrl]); // eslint-disable-line

  // recompute preview
  useEffect(() => {
    if (!base || !corners) return;
    let alive = true;
    setBusy(true);
    processPage({ ...local, corners }).then((d) => { if (alive) { setPreview(d); setBusy(false); } });
    return () => { alive = false; };
  }, [local.filter, local.brightness, local.contrast, corners, base]); // eslint-disable-line

  function defaultCorners(b) {
    const pad = Math.min(b.width, b.height) * 0.08;
    return [
      { x: pad, y: pad }, { x: b.width - pad, y: pad },
      { x: b.width - pad, y: b.height - pad }, { x: pad, y: b.height - pad },
    ];
  }

  // ---- pointer-based dragging (works for mouse AND touch) ----
  function startDrag(e, idx) {
    e.preventDefault();
    setDrag(idx);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }
  function moveDrag(e) {
    if (drag < 0 || !base || !stageRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / scale, 0, base.width);
    const y = clamp((e.clientY - rect.top) / scale, 0, base.height);
    setCorners((c) => c.map((p, i) => (i === drag ? { x, y } : p)));
  }
  function endDrag(e) {
    setDrag(-1);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }

  async function doAuto() {
    setBusy(true);
    const ac = await autoCorners({ ...local }).catch(() => null);
    if (ac) setCorners(ac);
    else alert("Couldn't detect edges — adjust the corners manually.");
    setBusy(false);
  }
  function resetCorners() {
    if (!base) return;
    setCorners([{ x: 0, y: 0 }, { x: base.width, y: 0 }, { x: base.width, y: base.height }, { x: 0, y: base.height }]);
  }
  async function save() {
    const np = { ...local, corners };
    np.thumb = await processPage(np);
    onSave(np); onClose();
  }

  const sc = corners && scale ? corners.map((p) => ({ x: p.x * scale, y: p.y * scale })) : null;
  const ptsStr = sc ? sc.map((p) => `${p.x},${p.y}`).join(" ") : "";
  const HANDLE_R = 16, HIT_R = 30;

  return (
    <div className="editor-wrap">
      <div className="editor-header">
        <button onClick={onClose} className="editor-cancel"><X size={16} />Cancel</button>
        <h2 className="editor-title">Edit page</h2>
        <button onClick={save} className="editor-done"><Check size={16} />Done</button>
      </div>

      <div className="editor-stage-wrap">
        <div className="editor-stage" ref={stageRef} style={{ touchAction: "none" }}>
          {baseUrl ? (
            <>
              <img ref={imgRef} src={baseUrl} alt="" className="editor-stage-img" draggable={false}
                onLoad={() => imgRef.current && setImgBox({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight })} />
              <svg className="editor-stage-svg" width={imgBox.w} height={imgBox.h}
                style={{ touchAction: "none", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
                onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {sc && (
                  <>
                    <defs>
                      <mask id="cropMask">
                        <rect width="100%" height="100%" fill="white" />
                        <polygon points={ptsStr} fill="black" />
                      </mask>
                    </defs>
                    <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#cropMask)" />
                    <polygon points={ptsStr} fill="none" stroke="#f0c987" strokeWidth="2" strokeDasharray="6 3" />
                    {sc.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r={HIT_R} fill="transparent"
                          style={{ cursor: "grab", touchAction: "none" }}
                          onPointerDown={(e) => startDrag(e, i)}
                          onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} />
                        <circle cx={p.x} cy={p.y} r={HANDLE_R + 4}
                          fill={drag === i ? "rgba(240,201,135,0.35)" : "rgba(240,201,135,0.15)"} style={{ pointerEvents: "none" }} />
                        <circle cx={p.x} cy={p.y} r={HANDLE_R} fill={drag === i ? "#f0c987" : "#1c1814"}
                          stroke="#f0c987" strokeWidth={drag === i ? 3 : 2} style={{ pointerEvents: "none" }} />
                        <circle cx={p.x} cy={p.y} r={4} fill={drag === i ? "#1c1814" : "#f0c987"} style={{ pointerEvents: "none" }} />
                      </g>
                    ))}
                  </>
                )}
              </svg>
            </>
          ) : (
            <div className="editor-stage-loading"><Loader2 size={32} className="spin" /></div>
          )}
        </div>
        <div className="editor-stage-controls">
          <EditBtn onClick={doAuto} icon={Wand2} label="Auto detect" />
          <EditBtn onClick={resetCorners} icon={Square} label="Full image" />
          <EditBtn onClick={() => setLocal((l) => ({ ...l, rotation: (l.rotation + 90) % 360, corners: null }))} icon={RotateCw} label="Rotate" />
        </div>
      </div>

      <p className="editor-crop-hint">Drag the corner handles to adjust the crop</p>

      <div className="editor-preview-section">
        <p className="editor-preview-label">Result preview {busy && "…"}</p>
        <div className="editor-preview-frame">{preview && <img src={preview} alt="" />}</div>
      </div>

      <div className="editor-filters">
        {FILTERS.map((f) => {
          const on = local.filter === f.id;
          return (
            <button key={f.id} onClick={() => setLocal((l) => ({ ...l, filter: f.id }))}
              className={`editor-filter-btn${on ? " active" : ""}`}>
              <f.icon size={14} />{f.label}
            </button>
          );
        })}
      </div>

      <Slider icon={Sun} label="Brightness" value={local.brightness} min={-80} max={80}
        onChange={(v) => setLocal((l) => ({ ...l, brightness: v }))} />
      <Slider icon={Contrast} label="Contrast" value={local.contrast} min={-60} max={80}
        onChange={(v) => setLocal((l) => ({ ...l, contrast: v }))} />
    </div>
  );
}

function EditBtn({ onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className="edit-action-btn">
      <Icon size={14} />{label}
    </button>
  );
}

function Slider({ icon: Icon, label, value, min, max, onChange }) {
  return (
    <div className="slider-row">
      <Icon size={16} className="slider-icon" />
      <span className="slider-label">{label}</span>
      <input type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="slider-input" />
      <span className="slider-value">{value}</span>
    </div>
  );
}
