/* ============================================================
Camera.jsx — high-quality live capture
- getUserMedia rear camera at highest available resolution
- captures a full-resolution STILL via ImageCapture.takePhoto()
    (much sharper than grabbing a video frame); falls back to a
    canvas frame grab where ImageCapture isn't supported
- continuous autofocus + optional torch
NOTE: getUserMedia requires a secure context. localhost is fine.
To test on a real phone over your LAN you must serve over HTTPS.
============================================================ */
import React, { useEffect, useRef, useState } from "react";
import { X, Camera as Cam, Zap, ZapOff, Loader2 } from "lucide-react";

export default function Camera({ onCapture, onClose }) {
const videoRef = useRef(null);
const streamRef = useRef(null);
const [err, setErr] = useState("");
const [ready, setReady] = useState(false);
const [torchOn, setTorchOn] = useState(false);
const [hasTorch, setHasTorch] = useState(false);
const [shooting, setShooting] = useState(false);

useEffect(() => {
let alive = true;
(async () => {
    try {
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 4096 },
        height: { ideal: 2160 },
        },
    });
    if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
    streamRef.current = stream;
    if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
    }
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
        track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    }
    setHasTorch(!!caps.torch);
    setReady(true);
    } catch (e) {
    setErr("Camera unavailable: " + e.message + ". On a phone you must use HTTPS.");
    }
})();
return () => {
    alive = false;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
};
}, []);

async function toggleTorch() {
const track = streamRef.current?.getVideoTracks()[0];
if (!track) return;
try {
    await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
    setTorchOn((v) => !v);
} catch {}
}

async function snap() {
const track = streamRef.current?.getVideoTracks()[0];
if (!track) return;
setShooting(true);
let blob = null;
// Preferred: full-resolution still
if (window.ImageCapture) {
    try {
    const ic = new ImageCapture(track);
    blob = await ic.takePhoto();
    } catch { blob = null; }
}
// Fallback: grab current video frame
if (!blob) {
    const v = videoRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
}
setShooting(false);
if (blob) onCapture(blob);
}

const wrap = {
position: "fixed", inset: 0, zIndex: 60, background: "#000",
display: "flex", flexDirection: "column",
};
const topBar = {
position: "absolute", top: 0, left: 0, right: 0, zIndex: 2,
display: "flex", justifyContent: "space-between", alignItems: "center",
padding: "16px", background: "linear-gradient(180deg,rgba(0,0,0,0.6),transparent)",
};
const iconBtn = {
width: 44, height: 44, borderRadius: "9999px", border: "none",
background: "rgba(0,0,0,0.45)", color: "#fff",
display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};
const bottomBar = {
position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 2,
display: "flex", justifyContent: "center", alignItems: "center",
padding: "28px", background: "linear-gradient(0deg,rgba(0,0,0,0.6),transparent)",
};
const shutter = {
width: 74, height: 74, borderRadius: "9999px",
border: "5px solid rgba(255,255,255,0.9)", background: "#f0c987", cursor: "pointer",
display: "flex", alignItems: "center", justifyContent: "center",
};

return (
<div style={wrap}>
    <div style={topBar}>
    <button style={iconBtn} onClick={onClose} aria-label="Close"><X size={22} /></button>
    {hasTorch && (
        <button style={iconBtn} onClick={toggleTorch} aria-label="Torch">
        {torchOn ? <Zap size={22} color="#f0c987" /> : <ZapOff size={22} />}
        </button>
    )}
    </div>

    <video
    ref={videoRef}
    playsInline
    muted
    style={{ flex: 1, width: "100%", height: "100%", objectFit: "cover", background: "#000" }}
    />

    {/* framing guide */}
    {ready && (
    <div style={{
        position: "absolute", inset: "12% 8%", zIndex: 1, pointerEvents: "none",
        border: "2px dashed rgba(240,201,135,0.7)", borderRadius: 12,
    }} />
    )}

    {!ready && !err && (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", gap: 10 }}>
        <Loader2 className="spin" size={22} /> Starting camera…
    </div>
    )}
    {err && (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", padding: 24, textAlign: "center", gap: 14 }}>
        <p style={{ fontSize: 14, lineHeight: 1.5 }}>{err}</p>
        <button style={{ ...iconBtn, width: "auto", padding: "8px 16px", borderRadius: 10 }} onClick={onClose}>Close</button>
    </div>
    )}

    <div style={bottomBar}>
    <button style={shutter} onClick={snap} disabled={!ready || shooting} aria-label="Capture">
        {shooting ? <Loader2 className="spin" size={26} color="#1c1814" /> : <Cam size={26} color="#1c1814" />}
    </button>
    </div>
</div>
);
}