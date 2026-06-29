/*
Quantum Signal Loss (QSL) Simulator - Real Voyager Integrated + Localization
*/

// === CONSTANTS ===
const LIGHT_SPEED = 299792.458; 
const EARTH_MARS_AVG_DISTANCE = 225000000;
const MARS_ATMOSPHERIC_LOSS = 0.04;
const MARS_VELOCITY = 24;
const PROBE_VELOCITY = 15;
const SIGNAL_FREQUENCY = 8.4e9;

const BASE_LAMBDA = 3.6e-7;

// Real NASA JPL Horizons data cache — updated every hour
// Each entry: { distance_km, distance_au, light_time_sec, velocity_km_s }
let NASA_PROBE_DATA = {
    voyager1:     null,
    voyager2:     null,
    new_horizons: null
};
let NASA_LAST_FETCH = 0;
const NASA_CACHE_MS = 3600000; // 1 hour — Horizons updates once per day so this is fine

// Fallback physics: used only when NASA API is unavailable
// Values derived from published JPL ephemeris data (as of mid-2026)
const FALLBACK_PROBES = {
    voyager1:     { baseD: 2.574e10, velocity: 17.038, baseTime: 1700000000000 },
    voyager2:     { baseD: 2.140e10, velocity: 15.390, baseTime: 1700000000000 },
    new_horizons: { baseD: 9.10e9,   velocity: 14.020, baseTime: 1700000000000 }
};

function getFallbackDistance(probeKey) {
    const p = FALLBACK_PROBES[probeKey];
    const t = (Date.now() - p.baseTime) / 1000;
    const dist = p.baseD + p.velocity * t;
    const perturb = Math.abs(Math.sin(t / 50000)) * 5e5;
    return dist + perturb;
}

// === FETCH REAL NASA DATA ===
async function updateVoyagerDistance() {
    const now = Date.now();
    // Only re-fetch if cache is stale
    if (now - NASA_LAST_FETCH < NASA_CACHE_MS) return;

    try {
        const res  = await fetch("/api/voyager");
        const json = await res.json();

        if (json.probes) {
            NASA_PROBE_DATA  = json.probes;
            NASA_LAST_FETCH  = now;
            console.info("[QSL] NASA Horizons data updated:", json.timestamp);
        }
    } catch (err) {
        console.warn("[QSL] NASA Horizons fetch failed, using physics fallback:", err.message);
    }
}

// Returns real distance in km for a given probe key
// probeKey: "voyager1" | "voyager2" | "new_horizons"
function getRealProbeDistance(probeKey = "voyager1") {
    const cache = NASA_PROBE_DATA[probeKey];
    if (cache && cache.distance_km) return cache.distance_km;
    return getFallbackDistance(probeKey);
}

// Returns real velocity in km/s for a given probe
function getRealProbeVelocity(probeKey = "voyager1") {
    const cache = NASA_PROBE_DATA[probeKey];
    if (cache && cache.velocity_km_s) return Math.abs(cache.velocity_km_s);
    return FALLBACK_PROBES[probeKey]?.velocity || 17.0;
}

// Returns real light-time in seconds
function getRealLightTime(probeKey = "voyager1") {
    const cache = NASA_PROBE_DATA[probeKey];
    if (cache && cache.light_time_sec) return cache.light_time_sec;
    return getRealProbeDistance(probeKey) / LIGHT_SPEED;
}

// === LAMBDA ===
function computeLambda(distance, interference) {
    let variation = (interference / 100) * 1e-7;
    let distanceFactor = distance / 1e10;
    return BASE_LAMBDA + variation * distanceFactor;
}

// === NOISE ===
function getControlledNoise() {
    return 5 + Math.sin(Date.now() / 2000) * 3;
}



//////////////////////////////////////////////////////
// 🔥 QSL FUNCTION
//////////////////////////////////////////////////////
function getQSL(distance) {
    let interference = getControlledNoise();
    let lambda = computeLambda(distance, interference);
    let delay = distance / LIGHT_SPEED;
    return 1 - Math.exp(-lambda * delay);
}

//////////////////////////////////////////////////////
// 🔥 YOUR EQUATION
//////////////////////////////////////////////////////
function computeDdist(D1, Q1, D2, Q2) {
    if (Q1 >= 0.999999 || Q2 >= 0.999999) return null;

    const ln1 = Math.log(1 - Q1);
    const ln2 = Math.log(1 - Q2);

    const num = (D1 * ln2) - (D2 * ln1);
    const den = ln2 - ln1;

    if (Math.abs(den) < 1e-12) return null;

    return Math.abs(num / den);
}

//////////////////////////////////////////////////////
// 🔥 TRIANGULATION
//////////////////////////////////////////////////////
function triangulate(p1, p2, p3, r1, r2, r3) {

    const A = 2*(p2.x - p1.x);
    const B = 2*(p2.y - p1.y);
    const C = r1*r1 - r2*r2 - p1.x*p1.x + p2.x*p2.x - p1.y*p1.y + p2.y*p2.y;

    const D = 2*(p3.x - p2.x);
    const E = 2*(p3.y - p2.y);
    const F = r2*r2 - r3*r3 - p2.x*p2.x + p3.x*p3.x - p2.y*p2.y + p3.y*p3.y;

    const denom = (A*E - B*D);
    if (Math.abs(denom) < 1e-6) return null;

    const x = (C*E - B*F) / denom;
    const y = (A*F - C*D) / denom;

    return { x, y };
}

// === MARS FUNCTION ===
function getMarsOrbiterData() {
    let distance = EARTH_MARS_AVG_DISTANCE + (Math.sin(Date.now() / 5000000) * 5000000);
    let signalTime = (distance / LIGHT_SPEED).toFixed(6);

    let interference = getControlledNoise().toFixed(2);
    let signalStrength = (100 - (distance * MARS_ATMOSPHERIC_LOSS / 10000000)).toFixed(2);

    const dynamicVelocity = MARS_VELOCITY + Math.sin(Date.now() / 5000000) * 0.5;
    const receivedFreq = SIGNAL_FREQUENCY * (1 - dynamicVelocity / LIGHT_SPEED);
    const deltaF = receivedFreq - SIGNAL_FREQUENCY;

    let anomaly = (interference > 7.5)
        ? "⚠️ Possible Signal Disturbance"
        : "✅ Normal Transmission";

    document.getElementById("mars-data").innerHTML = `
        🛰️ <strong>Distance:</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        📶 <strong>Signal Strength:</strong> ${signalStrength} % <br>
        📡 <strong>Interference:</strong> ${interference} dB <br>
        📈 <strong>Received Frequency:</strong> ${receivedFreq.toFixed(2)} Hz <br>
        📊 <strong>Doppler Shift Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
    `;
}

// === DEEP SPACE FUNCTION ===
function deepSpaceProbeData() {

    let distance = getRealProbeDistance("voyager1");
    let signalDelay = getRealLightTime("voyager1");
    let signalTime = signalDelay.toFixed(6);

    let interference = getControlledNoise();
    let lambda = computeLambda(distance, interference);

    let qsl = 1 - Math.exp(-lambda * signalDelay);
    let qsu = Math.exp(-lambda * signalDelay);

    //////////////////////////////////////////////////////
    // 🔥 LOCALIZATION ADD (SAFE)
    //////////////////////////////////////////////////////
    let D1 = distance;
    let D2 = D1 * 0.92;
    let D3 = D1 * 1.05;

// 🔥 DIFFERENT ENVIRONMENT FOR EACH PROBE
let t = Date.now();

let noise1 = 5 + Math.sin(t / 2000) * 3;
let noise2 = 6 + Math.sin(t / 3000 + 1) * 2.5;
let noise3 = 4 + Math.cos(t / 2500 + 2) * 3.5;

let lambda1 = computeLambda(D1, noise1);
let lambda2 = computeLambda(D2, noise2);
let lambda3 = computeLambda(D3, noise3);

let Q1 = 1 - Math.exp(-lambda1 * (D1 / LIGHT_SPEED));
let Q2 = 1 - Math.exp(-lambda2 * (D2 / LIGHT_SPEED));
let Q3 = 1 - Math.exp(-lambda3 * (D3 / LIGHT_SPEED));

    let D12 = computeDdist(D1, Q1, D2, Q2);
    let D23 = computeDdist(D2, Q2, D3, Q3);

const p1 = { x: D1, y: 0 };

const p2 = { 
    x: D2 * Math.cos(Math.PI / 6), 
    y: D2 * Math.sin(Math.PI / 6) 
};

const p3 = { 
    x: D3 * Math.cos(-Math.PI / 4), 
    y: D3 * Math.sin(-Math.PI / 4) 
};

    let location = null;

    if (D12 && D23) {
        location = triangulate(p1, p2, p3, D12, D23, D12);
    }

    let locText = "N/A";

    if (location) {
        locText = `
            X: ${(location.x/1e9).toFixed(2)} B km<br>
            Y: ${(location.y/1e9).toFixed(2)} B km
        `;
    }
    //////////////////////////////////////////////////////

    const velocityVariation = Math.sin(Date.now() / 20000000) * 0.01; // tiny real variation
    const effectiveVelocity = getRealProbeVelocity("voyager1") + velocityVariation;

    const receivedFreq = SIGNAL_FREQUENCY * (1 - effectiveVelocity / LIGHT_SPEED);
    const deltaF = receivedFreq - SIGNAL_FREQUENCY;

    const baseDoppler = SIGNAL_FREQUENCY * (1 - PROBE_VELOCITY / LIGHT_SPEED);
    const dopplerDelta = Math.abs(receivedFreq - baseDoppler);

    const anomaly = (qsl > 0.85 && dopplerDelta > 5e4)
        ? "⚠️ Signal Disruption Detected"
        : "✅ Signal Stable";

    document.getElementById("deep-space-data").innerHTML = `
        📡 <strong>Distance:</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        💠 <strong>QSL:</strong> ${qsl.toFixed(6)} <br>
        🧿 <strong>QSU:</strong> ${qsu.toFixed(6)} <br>
        📈 <strong>Received Frequency:</strong> ${receivedFreq.toFixed(2)} Hz <br>
        📊 <strong>Doppler Shift Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
        <hr>
        🧭 <strong>Localization:</strong><br>${locText}
    `;
}

// === INIT ===
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);
// Fetch real NASA data immediately, then every 60 min
updateVoyagerDistance();
setInterval(updateVoyagerDistance, 3600000);

// === THEME ===
document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("themeToggle");
    const currentTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    toggle.innerText = currentTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

    toggle.addEventListener("click", () => {
        const newTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        toggle.innerText = newTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
        localStorage.setItem("theme", newTheme);
    });
});


/* ============================================================
   ADVANCED LOCALIZATION ENGINE (NEW)
   ============================================================ */

const LOC_AU_TO_KM = 1.496e8;

// Maps LOC_PROBES index to NASA API probe key
const LOC_PROBE_KEYS = ["voyager1", "voyager2", "new_horizons"];

const LOC_PROBES = [
    {
        name:    'Voyager 1',
        color:   '#4fc3f7',
        angleXY: 35 * Math.PI / 180,   // real ecliptic longitude ~258° → mapped
        angleZ:  34.9 * Math.PI / 180  // real heliographic latitude ~34.9° N
    },
    {
        name:    'Voyager 2',
        color:   '#81c784',
        angleXY: -48 * Math.PI / 180,  // heading south toward Pavo/Indus
        angleZ:  -30.0 * Math.PI / 180 // ~30° below ecliptic
    },
    {
        name:    'New Horizons',
        color:   '#f48fb1',
        angleXY: 15 * Math.PI / 180,
        angleZ:   2.5 * Math.PI / 180  // near ecliptic plane
    }
];

let locSelectedProbe = 0;

/* --- helpers --- */
function locNoise(seed) {
    return 5 + Math.sin(Date.now() / 2000 + seed) * 3;
}

function locLambda(distance, interference) {
    return BASE_LAMBDA + (interference / 100) * 1e-7 * (distance / 1e10);
}

function locQSL(distance, seed) {
    const n = locNoise(seed);
    const lam = locLambda(distance, n);
    return 1 - Math.exp(-lam * (distance / LIGHT_SPEED));
}

function locProbeDistance(probe, idx) {
    const key = LOC_PROBE_KEYS[idx];
    return getRealProbeDistance(key);
}

function loc3D(probe, dist) {
    const x = dist * Math.cos(probe.angleZ) * Math.cos(probe.angleXY);
    const y = dist * Math.cos(probe.angleZ) * Math.sin(probe.angleXY);
    const z = dist * Math.sin(probe.angleZ);
    return { x, y, z };
}

function locUncertainty(qsl, distance) {
    const noiseLevel = locNoise(99) / 100;
    return distance * 0.0002 * (1 + qsl * 5) * (1 + noiseLevel);
}

function locFmt(n) {
    if (n === null || isNaN(n)) return 'N/A';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(3) + ' B km';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(3) + ' M km';
    return n.toFixed(2) + ' km';
}

/* --- probe tab selector --- */
function locSelectProbe(i) {
    locSelectedProbe = i;
    document.querySelectorAll('.loc-probe-tab').forEach((tab, idx) => {
        tab.classList.toggle('active', idx === i);
    });
}

/* --- solar map draw --- */
function locDrawMap() {
    const canvas = document.getElementById('locSolarMap');
    if (!canvas) return;
    const W = canvas.parentElement.clientWidth || 700;
    canvas.width  = W;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');
    const cx = W / 2, cy = 170;
    const SCALE = (W / 2 - 30) / 2.6e10;

    /* background */
    ctx.fillStyle = '#030b1a';
    ctx.fillRect(0, 0, W, 340);

    /* stars */
    for (let i = 0; i < 130; i++) {
        const sx = (Math.sin(i * 137.508) * 0.5 + 0.5) * W;
        const sy = (Math.cos(i * 97.31)   * 0.5 + 0.5) * 340;
        ctx.beginPath();
        ctx.arc(sx, sy, i % 7 === 0 ? 1.2 : 0.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${0.25 + (i % 4) * 0.1})`;
        ctx.fill();
    }

    /* heliosphere */
    const hR = Math.min(W * 0.44, 200);
    ctx.beginPath();
    ctx.arc(cx, cy, hR, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(60,100,200,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,150,255,0.13)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120,160,255,0.55)';
    ctx.font = '10px sans-serif';
    ctx.fillText('Heliosphere boundary', cx - 60, cy - hR + 14);

    /* sun */
    const sunG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
    sunG.addColorStop(0, '#fffde7');
    sunG.addColorStop(0.4, '#FFD700');
    sunG.addColorStop(1,   '#FF8C00');
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = sunG;
    ctx.fill();

    const sunGlow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 24);
    sunGlow.addColorStop(0, 'rgba(255,215,0,0.32)');
    sunGlow.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = sunGlow;
    ctx.fill();

    /* probes */
    LOC_PROBES.forEach((probe, i) => {
        const dist   = locProbeDistance(probe, i);
        const coords = loc3D(probe, dist);
        const px     = cx + coords.x * SCALE;
        const py     = cy - coords.y * SCALE;
        const qsl    = locQSL(dist, i);
        const unc    = locUncertainty(qsl, dist);
        const uR     = Math.max(7, unc * SCALE);

        /* trail */
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = probe.color + '2a';
        ctx.lineWidth   = 0.8;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        /* uncertainty disc */
        ctx.beginPath();
        ctx.arc(px, py, uR, 0, Math.PI * 2);
        ctx.fillStyle = probe.color + '1e';
        ctx.fill();
        ctx.strokeStyle = probe.color + '55';
        ctx.lineWidth   = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        /* probe dot */
        const isSelected = locSelectedProbe === i;
        ctx.beginPath();
        ctx.arc(px, py, isSelected ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = probe.color;
        ctx.fill();
        if (isSelected) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth   = 1.5;
            ctx.stroke();
        }

        /* label */
        let lx = px + 10, ly = py - 9;
        if (lx > W - 90)  lx = px - 90;
        if (ly < 14)       ly = py + 20;
        ctx.fillStyle = probe.color;
        ctx.font = `${isSelected ? '600' : '400'} 11px sans-serif`;
        ctx.fillText(probe.name, lx, ly);
        ctx.fillStyle = probe.color + 'aa';
        ctx.font = '10px sans-serif';
        ctx.fillText((dist / LOC_AU_TO_KM).toFixed(1) + ' AU', lx, ly + 13);
    });

    /* scale bar */
    let scaleKm = 5e9, scalePx = scaleKm * SCALE;
    if (scalePx > 90) { scaleKm = 2e9; scalePx = scaleKm * SCALE; }
    ctx.beginPath();
    ctx.moveTo(14, 326); ctx.lineTo(14 + scalePx, 326);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px sans-serif';
    ctx.fillText((scaleKm / 1e9).toFixed(0) + ' B km', 14, 322);
}

/* --- data panel update --- */
function locUpdatePanel() {
    const probe  = LOC_PROBES[locSelectedProbe];
    const dist   = locProbeDistance(probe, locSelectedProbe);
    const coords = loc3D(probe, dist);
    const qsl    = locQSL(dist, locSelectedProbe);
    const qsu    = 1 - qsl;
    const unc    = locUncertainty(qsl, dist);
    const delay  = dist / LIGHT_SPEED;
    const noise  = locNoise(locSelectedProbe);
    const lam    = locLambda(dist, noise);

    /* probe name */
    const nameEl = document.getElementById('locProbeName');
    if (nameEl) nameEl.textContent = probe.name;

    /* coordinates */
    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setT('locX', locFmt(coords.x));
    setT('locY', locFmt(coords.y));
    setT('locZ', locFmt(coords.z));
    setT('locR', (dist / LOC_AU_TO_KM).toFixed(4) + ' AU');
    setT('locUncertaintyVal', locFmt(unc) + ' (1σ)');

    /* QSL bars */
    setT('locQslVal', qsl.toFixed(8));
    setT('locQsuVal', qsu.toFixed(8));
    const qslBar = document.getElementById('locQslBar');
    const qsuBar = document.getElementById('locQsuBar');
    if (qslBar) qslBar.style.width = Math.min(qsl * 100, 100).toFixed(3) + '%';
    if (qsuBar) qsuBar.style.width = Math.min(qsu * 100, 100).toFixed(3) + '%';

    /* triangulation */
    const D1 = dist, D2 = D1 * 0.92, D3 = D1 * 1.05;
    const Q1 = locQSL(D1, locSelectedProbe);
    const Q2 = locQSL(D2, locSelectedProbe + 10);
    const Q3 = locQSL(D3, locSelectedProbe + 20);
    const D12 = computeDdist(D1, Q1, D2, Q2);
    const D23 = computeDdist(D2, Q2, D3, Q3);
    const terrKm = (D12 && D23) ? Math.abs(D12 - D23) * 0.01 : null;

    setT('locD1',   locFmt(D1));
    setT('locD2',   locFmt(D2));
    setT('locD3',   locFmt(D3));
    setT('locD12',  D12 ? locFmt(D12) : 'N/A');
    setT('locD23',  D23 ? locFmt(D23) : 'N/A');
    setT('locTerr', terrKm ? '±' + locFmt(terrKm) : 'N/A');

    /* raw telemetry */
    const tel = document.getElementById('locRawTelemetry');
    if (tel) {
        tel.textContent = [
            `PROBE        : ${probe.name}`,
            `TIMESTAMP    : ${new Date().toISOString()}`,
            `DISTANCE     : ${dist.toExponential(6)} km`,
            `SIGNAL DELAY : ${delay.toFixed(4)} sec`,
            `LAMBDA (λ)   : ${lam.toExponential(6)} m⁻¹`,
            `NOISE (dB)   : ${noise.toFixed(4)}`,
            `QSL          : ${qsl.toFixed(8)}`,
            `QSU          : ${qsu.toFixed(8)}`,
            `X (km)       : ${coords.x.toExponential(5)}`,
            `Y (km)       : ${coords.y.toExponential(5)}`,
            `Z (km)       : ${coords.z.toExponential(5)}`,
            `R (AU)       : ${(dist / LOC_AU_TO_KM).toFixed(6)}`,
            `UNCERTAINTY  : ±${unc.toExponential(4)} km`,
            `TRI D12      : ${D12 ? D12.toExponential(5) + ' km' : 'N/A'}`,
            `TRI D23      : ${D23 ? D23.toExponential(5) + ' km' : 'N/A'}`,
            `STATUS       : ${qsl > 0.85 ? '⚠ HIGH SIGNAL LOSS' : '✓ NOMINAL'}`
        ].join('\n');
    }
}

/* --- main localization loop --- */
function locLoop() {
    locDrawMap();
    locUpdatePanel();
}

/* start after DOM ready */
document.addEventListener('DOMContentLoaded', () => {
    // Fire initial data loads
    getMarsOrbiterData();
    deepSpaceProbeData();

    // Start localization loop
    locLoop();
    setInterval(locLoop, 2000);
    window.addEventListener('resize', locDrawMap);

    setTimeout(locLoop, 100);
});
