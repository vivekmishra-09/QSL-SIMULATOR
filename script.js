/*
 * Quantum-Inspired Signal Loss (QSL) Simulator
 * Author  : Vivek Mishra
 * Paper   : "Quantum-Inspired Signal Loss (QSL): A Probabilistic
 *            Exponential-Decay Model for Deep-Space Communication Coherence"
 * DOI     : https://doi.org/10.5281/zenodo.16919283
 *
 * Core equation  : QSL  = 1 - e^(-λ·Δ)       [Paper §2]
 * Complementary  : QSU  = e^(-λ·Δ)            [Paper §2]
 * Delay          : Δ    = D / c                [Paper §2]
 * Attenuation    : Ceff = QSU · e^(-μ·D)      [Paper §4]
 * Localization   : Ddist = [D1·ln(1-Q2) - D2·ln(1-Q1)]
 *                          / [ln(1-Q2) - ln(1-Q1)]     [Paper §9]
 *
 * λ calibrated from Voyager-2 DSN telemetry: λ = (3.6 ± 0.2) × 10⁻⁷  [Paper §3]
 * Critical distance Dcrit ≈ 8.0 × 10⁹ km at QSL = 0.99               [Paper §7]
 */

"use strict";

/* ============================================================
   SECTION 1 — PHYSICAL CONSTANTS  (all SI-compatible, km-based)
   ============================================================ */

const C           = 299792.458;          // Speed of light (km/s)
const LAMBDA      = 3.6e-7;             // Empirical attenuation constant [Paper §3]
const LAMBDA_ERR  = 0.2e-7;             // 1σ uncertainty on λ           [Paper §6]
const MU          = 1e-14;              // Path-loss attenuation coeff μ  [Paper §4]
const D_CRIT      = 8.0e9;             // Critical distance (km)         [Paper §7]
const AU_TO_KM    = 149597870.7;        // 1 AU in km
const SIGNAL_FREQ = 8.4e9;             // DSN X-band frequency (Hz)

/* ============================================================
   SECTION 2 — NASA JPL HORIZONS REAL DATA CACHE
   ============================================================ */

let NASA_DATA = {
    voyager1:     null,   // { distance_km, velocity_km_s, light_time_sec, distance_au }
    voyager2:     null,
    new_horizons: null
};
let NASA_LAST_FETCH  = 0;
const NASA_CACHE_MS  = 3600000; // refresh every 1 hour (Horizons is daily-updated)

// Physics-based fallback — used ONLY when NASA API is unavailable
// Base distances from JPL published ephemeris, mid-2026
const FALLBACK = {
    voyager1:     { baseD: 2.574e10, vel: 17.038, t0: 1700000000000 },
    voyager2:     { baseD: 2.140e10, vel: 15.390, t0: 1700000000000 },
    new_horizons: { baseD: 9.10e9,   vel: 14.020, t0: 1700000000000 }
};

function fallbackDistance(key) {
    const p = FALLBACK[key];
    const t = (Date.now() - p.t0) / 1000;
    return p.baseD + p.vel * t;
}

async function updateNASAData() {
    const now = Date.now();
    if (now - NASA_LAST_FETCH < NASA_CACHE_MS) return;
    try {
        const res  = await fetch("/api/voyager");
        const json = await res.json();
        if (json.probes) {
            NASA_DATA       = json.probes;
            NASA_LAST_FETCH = now;
            console.info("[QSL] NASA Horizons updated:", json.timestamp);
        }
    } catch (e) {
        console.warn("[QSL] Horizons unavailable — physics fallback active:", e.message);
    }
}

function probeDistance(key)  {
    return NASA_DATA[key]?.distance_km  || fallbackDistance(key);
}
function probeVelocity(key)  {
    return Math.abs(NASA_DATA[key]?.velocity_km_s || FALLBACK[key].vel);
}
function probeLightTime(key) {
    return NASA_DATA[key]?.light_time_sec || probeDistance(key) / C;
}

/* ============================================================
   SECTION 3 — CORE QSL EQUATIONS   (paper-exact)
   ============================================================ */

/*
 * QSL = 1 - e^(-λ·Δ)    where Δ = D/c
 * λ is FIXED at calibrated value — NOT varied by noise.
 * Paper §3: λ = 3.6×10⁻⁷ ± 0.2×10⁻⁷
 */
function computeQSL(D_km, lambda = LAMBDA) {
    const delta = D_km / C;               // Δ = D/c  [Paper §2]
    return 1 - Math.exp(-lambda * delta);
}

function computeQSU(D_km, lambda = LAMBDA) {
    const delta = D_km / C;
    return Math.exp(-lambda * delta);     // QSU = e^(-λ·Δ)  [Paper §2]
}

/*
 * Effective signal coherence with path-loss term  [Paper §4]
 * Ceff = QSU · e^(-μ·D)
 */
function computeCeff(D_km) {
    return computeQSU(D_km) * Math.exp(-MU * D_km);
}

/*
 * QSL localization estimator  [Paper §9]
 * Ddist = [D1·ln(1-Q2) - D2·ln(1-Q1)] / [ln(1-Q2) - ln(1-Q1)]
 *
 * Returns radial distance of the disturbance, or null if degenerate.
 */
function computeDdist(D1, Q1, D2, Q2) {
    if (Q1 >= 0.999999 || Q2 >= 0.999999) return null;
    const ln1 = Math.log(1 - Q1);
    const ln2 = Math.log(1 - Q2);
    const den  = ln2 - ln1;
    if (Math.abs(den) < 1e-12) return null;
    return Math.abs((D1 * ln2 - D2 * ln1) / den);
}

/*
 * QSL gradient (coherence rate of change)  [Paper §8]
 * dQSL/dt = (Q2 - Q1) / (T2 - T1)
 */
function computeGradient(Q1, T1, Q2, T2) {
    const dT = T2 - T1;
    if (Math.abs(dT) < 1e-9) return 0;
    return (Q2 - Q1) / dT;
}

/*
 * Propagated λ uncertainty  [Paper §6]
 * Computes QSL bounds from λ ± σ
 */
function computeQSLBounds(D_km) {
    return {
        nominal: computeQSL(D_km, LAMBDA),
        upper:   computeQSL(D_km, LAMBDA + LAMBDA_ERR),
        lower:   computeQSL(D_km, LAMBDA - LAMBDA_ERR)
    };
}

/*
 * 2D triangulation (least-squares linear system)  [Paper §9 extension]
 * Given 3 receiver points p1,p2,p3 and QSL-derived radii r1,r2,r3
 */
function triangulate(p1, p2, p3, r1, r2, r3) {
    const A = 2*(p2.x - p1.x), B = 2*(p2.y - p1.y);
    const C_ = r1*r1 - r2*r2 - p1.x*p1.x + p2.x*p2.x - p1.y*p1.y + p2.y*p2.y;
    const D_ = 2*(p3.x - p2.x), E = 2*(p3.y - p2.y);
    const F  = r2*r2 - r3*r3 - p2.x*p2.x + p3.x*p3.x - p2.y*p2.y + p3.y*p3.y;
    const det = A*E - B*D_;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (C_*E - B*F)/det, y: (A*F - C_*D_)/det };
}

/* ============================================================
   SECTION 4 — DSN JSON REAL-TIME TELEMETRY (Mars Zone)
   Uses: https://eyes.nasa.gov/dsn/data/dsn.json  [Paper Ref 1]
   ============================================================ */

let DSN_CACHE     = null;
let DSN_LAST_FETCH = 0;
const DSN_CACHE_MS = 5000;  // DSN JSON updates every 5 s

async function fetchDSN() {
    const now = Date.now();
    if (now - DSN_LAST_FETCH < DSN_CACHE_MS) return DSN_CACHE;
    try {
        // Use a CORS proxy or server-side route to avoid CORS block
        const res  = await fetch("/api/dsn");
        const json = await res.json();
        DSN_CACHE      = json;
        DSN_LAST_FETCH = now;
        return json;
    } catch {
        return DSN_CACHE; // return last good cache silently
    }
}

// Parse DSN JSON and find Mars-related spacecraft (MRO, MAVEN, TGO)
function parseDSN(dsn) {
    if (!dsn || !dsn.dsn) return null;
    const dishes = dsn.dsn.dish || [];
    for (const dish of dishes) {
        const targets = Array.isArray(dish.target) ? dish.target : [dish.target];
        for (const t of targets) {
            if (!t) continue;
            const name = (t['@name'] || '').toLowerCase();
            if (name.includes('mro') || name.includes('maven') || name.includes('tgo')) {
                return {
                    spacecraft: t['@name'],
                    uplegRange: parseFloat(t['@uplegRange'] || 0),
                    downlegRange: parseFloat(t['@downlegRange'] || 0),
                    signalPower: parseFloat(t['@power'] || 0),
                    frequency:  parseFloat(t['@frequency'] || SIGNAL_FREQ)
                };
            }
        }
    }
    return null;
}

/* ============================================================
   SECTION 5 — MARS ZONE DISPLAY
   ============================================================ */

const EARTH_MARS_AVG_DISTANCE = 225000000; // km
const MARS_VELOCITY = 24;                  // km/s orbital velocity (approximate)

async function getMarsOrbiterData() {
    const dsn    = await fetchDSN();
    const live   = parseDSN(dsn);

    // Use real DSN distance if available, else orbital mechanics estimate
    let distance;
    let spacecraft = "MRO (estimated)";
    let signalPower = "N/A";
    let dataSource  = "⚠️ Physics estimate (DSN API unavailable)";

    if (live && live.downlegRange > 0) {
        distance    = live.downlegRange;
        spacecraft  = live.spacecraft;
        signalPower = live.signalPower.toFixed(2) + " dB";
        dataSource  = "✅ NASA DSN Live Feed";
    } else {
        // Orbital mechanics: Earth-Mars distance varies sinusoidally
        distance = EARTH_MARS_AVG_DISTANCE + (Math.sin(Date.now() / 5000000) * 5000000);
    }

    // Paper equations — λ is FIXED at calibrated value
    const delta      = distance / C;                        // Δ = D/c  [Paper §2]
    const qsl        = computeQSL(distance);                // QSL = 1 - e^(-λΔ)
    const qsu        = computeQSU(distance);                // QSU = e^(-λΔ)
    const ceff       = computeCeff(distance);               // Ceff = QSU·e^(-μD) [Paper §4]
    const bounds     = computeQSLBounds(distance);

    // Doppler shift (real physics)
    const dynamicVelocity = MARS_VELOCITY + Math.sin(Date.now() / 5000000) * 0.5;
    const receivedFreq    = SIGNAL_FREQ * (1 - dynamicVelocity / C);
    const deltaF          = receivedFreq - SIGNAL_FREQ;

    // Paper §11: QSL > 0.9 → near-total coherence degradation flag
    const coherenceStatus = qsl > 0.9
        ? "⚠️ High Coherence Loss (QSL > 0.9)"
        : qsl > 0.5
        ? "🟡 Moderate Loss"
        : "✅ Signal Coherent";

    // Critical distance check [Paper §7]
    const critStatus = distance >= D_CRIT
        ? `⛔ Beyond D_crit (${(D_CRIT/1e9).toFixed(1)} B km) — coherence collapse zone`
        : `✅ Within coherent range`;

    document.getElementById("mars-data").innerHTML = `
        🛰️ <strong>Spacecraft:</strong> ${spacecraft} <br>
        📡 <strong>Data Source:</strong> ${dataSource} <br>
        📏 <strong>Distance (D):</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Delay (Δ = D/c):</strong> ${delta.toFixed(4)} s <br>
        💠 <strong>QSL = 1−e<sup>−λΔ</sup>:</strong> ${qsl.toFixed(8)} <br>
        🧿 <strong>QSU = e<sup>−λΔ</sup>:</strong> ${qsu.toFixed(8)} <br>
        🔬 <strong>C<sub>eff</sub> = QSU·e<sup>−μD</sup>:</strong> ${ceff.toExponential(6)} <br>
        📊 <strong>QSL bounds (λ±σ):</strong> [${bounds.lower.toFixed(6)}, ${bounds.upper.toFixed(6)}] <br>
        📶 <strong>Signal Power:</strong> ${signalPower} <br>
        📈 <strong>Doppler Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()} <br>
        🔵 <strong>Coherence:</strong> ${coherenceStatus} <br>
        🎯 <strong>D_crit status:</strong> ${critStatus}
    `;
}

/* ============================================================
   SECTION 6 — DEEP SPACE ZONE (Voyager 1 — real NASA data)
   ============================================================ */

// Keep two consecutive QSL readings for gradient computation [Paper §8]
let _prevQSL  = null;
let _prevTime = null;

function deepSpaceProbeData() {
    const D      = probeDistance("voyager1");          // Real NASA distance (km)
    const delta  = probeLightTime("voyager1");         // Real NASA Δ (s) = LT
    const vel    = probeVelocity("voyager1");          // Real NASA velocity (km/s)

    // Paper §2: core equations with fixed λ
    const qsl   = computeQSL(D);
    const qsu   = computeQSU(D);
    const ceff  = computeCeff(D);
    const bounds = computeQSLBounds(D);

    // QSL gradient [Paper §8]
    const now = Date.now() / 1000;
    let gradText = "N/A";
    if (_prevQSL !== null) {
        const grad = computeGradient(_prevQSL, _prevTime, qsl, now);
        gradText   = grad.toExponential(4) + " s⁻¹";
    }
    _prevQSL  = qsl;
    _prevTime = now;

    // Localization via two spacecraft [Paper §9]
    // Use Voyager-2 as second reference point
    const D2 = probeDistance("voyager2");
    const Q1 = qsl;
    const Q2 = computeQSL(D2);
    const Ddist = computeDdist(D, Q1, D2, Q2);

    // Doppler (real physics, real velocity from NASA)
    const receivedFreq = SIGNAL_FREQ * (1 - vel / C);
    const deltaF       = receivedFreq - SIGNAL_FREQ;

    // Critical distance check [Paper §7]
    const critFlag = D >= D_CRIT
        ? "⛔ BEYOND D_crit — coherence collapse zone"
        : "✅ Coherent zone";

    // Paper §11 status
    const anomaly = (qsl > 0.9 && Math.abs(deltaF) > 5e4)
        ? "⚠️ Signal Disruption Detected (QSL > 0.9)"
        : qsl > 0.85
        ? "🟡 High Loss — monitor closely"
        : "✅ Signal Stable";

    const dataTag = NASA_DATA.voyager1
        ? "✅ NASA JPL Horizons — Real Data"
        : "⚠️ Physics fallback (Horizons unavailable)";

    document.getElementById("deep-space-data").innerHTML = `
        📡 <strong>Data Source:</strong> ${dataTag} <br>
        📏 <strong>Distance (D):</strong> ${D.toFixed(2)} km &nbsp;|&nbsp; ${(D/AU_TO_KM).toFixed(3)} AU <br>
        ⏳ <strong>Delay (Δ = D/c):</strong> ${delta.toFixed(2)} s &nbsp;(${(delta/3600).toFixed(2)} hr) <br>
        🔬 <strong>λ (calibrated):</strong> ${LAMBDA.toExponential(1)} ± ${LAMBDA_ERR.toExponential(1)} <br>
        💠 <strong>QSL = 1−e<sup>−λΔ</sup>:</strong> ${qsl.toFixed(8)} <br>
        🧿 <strong>QSU = e<sup>−λΔ</sup>:</strong> ${qsu.toFixed(8)} <br>
        🔬 <strong>C<sub>eff</sub> = QSU·e<sup>−μD</sup>:</strong> ${ceff.toExponential(6)} <br>
        📊 <strong>QSL bounds (λ±σ):</strong> [${bounds.lower.toFixed(6)}, ${bounds.upper.toFixed(6)}] <br>
        📉 <strong>dQSL/dt (gradient):</strong> ${gradText} <br>
        🎯 <strong>D_crit (8×10⁹ km):</strong> ${critFlag} <br>
        🧭 <strong>Ddist (V1↔V2):</strong> ${Ddist ? Ddist.toExponential(4)+' km' : 'N/A'} <br>
        🌀 <strong>Velocity:</strong> ${vel.toFixed(3)} km/s <br>
        📈 <strong>Doppler Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()} <br>
        🔵 <strong>Status:</strong> ${anomaly}
        <hr>
        🧭 <strong>Localization (Ddist — Paper §9):</strong><br>
        &nbsp;&nbsp;V1 D₁ = ${(D/1e9).toFixed(3)} B km, Q₁ = ${Q1.toFixed(6)}<br>
        &nbsp;&nbsp;V2 D₂ = ${(D2/1e9).toFixed(3)} B km, Q₂ = ${Q2.toFixed(6)}<br>
        &nbsp;&nbsp;D<sub>dist</sub> = ${Ddist ? (Ddist/1e9).toFixed(3)+' B km' : 'N/A'}
    `;
}

/* ============================================================
   SECTION 7 — INIT INTERVALS
   ============================================================ */

// Fetch NASA data immediately and every hour
updateNASAData();
setInterval(updateNASAData, NASA_CACHE_MS);

// Mars: every 5s, Deep Space: every 15s
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);

/* ============================================================
   SECTION 8 — THEME TOGGLE
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    const toggle       = document.getElementById("themeToggle");
    const currentTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", currentTheme);
    toggle.innerText = currentTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

    toggle.addEventListener("click", () => {
        const newTheme = document.documentElement.getAttribute("data-theme") === "dark"
            ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", newTheme);
        toggle.innerText = newTheme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
        localStorage.setItem("theme", newTheme);
    });

    // Fire first readings immediately
    getMarsOrbiterData();
    deepSpaceProbeData();
});

/* ============================================================
   SECTION 9 — ADVANCED LOCALIZATION ENGINE
   ============================================================ */

const LOC_AU_TO_KM   = AU_TO_KM;
const LOC_PROBE_KEYS = ["voyager1", "voyager2", "new_horizons"];
let   locSelectedProbe = 0;

// Real heliocentric angles from published JPL/NASA trajectory data
const LOC_PROBES = [
    {
        name:    'Voyager 1',
        color:   '#4fc3f7',
        angleXY: 255.0 * Math.PI / 180,  // ecliptic longitude ~255° (toward Ophiuchus)
        angleZ:   34.9 * Math.PI / 180   // heliographic latitude +34.9°N
    },
    {
        name:    'Voyager 2',
        color:   '#81c784',
        angleXY: 289.0 * Math.PI / 180,  // ecliptic longitude ~289° (toward Pavo/Indus)
        angleZ:  -31.0 * Math.PI / 180   // heliographic latitude -31° S
    },
    {
        name:    'New Horizons',
        color:   '#f48fb1',
        angleXY:  23.0 * Math.PI / 180,  // heading toward Sagittarius
        angleZ:    2.5 * Math.PI / 180   // nearly in ecliptic plane
    }
];

/* --- QSL with paper-fixed λ (no fake noise) --- */
function locQSL(D_km) {
    return computeQSL(D_km, LAMBDA);      // λ is always calibrated constant
}

/* --- Real probe distance from NASA cache --- */
function locProbeDistance(idx) {
    return probeDistance(LOC_PROBE_KEYS[idx]);
}

/* --- 3D heliocentric coordinates from distance + real angles --- */
function loc3D(probe, dist) {
    return {
        x: dist * Math.cos(probe.angleZ) * Math.cos(probe.angleXY),
        y: dist * Math.cos(probe.angleZ) * Math.sin(probe.angleXY),
        z: dist * Math.sin(probe.angleZ)
    };
}

/*
 * Uncertainty radius [Paper §6]
 * Derived from λ uncertainty: ΔD = (c/λ²) · σ_λ · Δ
 * σ_λ = 0.2×10⁻⁷, so ΔD ≈ (c·σ_λ/λ²) · (D/c) = (σ_λ/λ) · D
 */
function locUncertainty(D_km) {
    return (LAMBDA_ERR / LAMBDA) * D_km;   // ΔD = (σ_λ/λ)·D [Paper §6]
}

function locFmt(n) {
    if (n === null || isNaN(n)) return 'N/A';
    if (Math.abs(n) >= 1e9)    return (n / 1e9).toFixed(3) + ' B km';
    if (Math.abs(n) >= 1e6)    return (n / 1e6).toFixed(3) + ' M km';
    return n.toFixed(2) + ' km';
}

function locSelectProbe(i) {
    locSelectedProbe = i;
    document.querySelectorAll('.loc-probe-tab').forEach((tab, idx) => {
        tab.classList.toggle('active', idx === i);
    });
}

/* --- Solar system map on canvas --- */
function locDrawMap() {
    const canvas = document.getElementById('locSolarMap');
    if (!canvas) return;
    const W  = canvas.parentElement.clientWidth || 700;
    canvas.width  = W;
    canvas.height = 340;
    const ctx = canvas.getContext('2d');
    const cx  = W / 2, cy = 170;

    // Scale: outermost probe (~25 B km) fits in W/2 - margin
    const maxDist = Math.max(
        locProbeDistance(0), locProbeDistance(1), locProbeDistance(2)
    );
    const SCALE = (W / 2 - 40) / maxDist;

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

    /* Critical distance ring — D_crit = 8×10⁹ km [Paper §7] */
    const critR = D_CRIT * SCALE;
    if (critR < W / 2) {
        ctx.beginPath();
        ctx.arc(cx, cy, critR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,80,80,0.35)';
        ctx.lineWidth   = 1;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,80,80,0.7)';
        ctx.font      = '9px sans-serif';
        ctx.fillText('D_crit = 8×10⁹ km  [Paper §7]', cx - critR + 4, cy - critR + 12);
    }

    /* Heliosphere boundary ~100 AU = 1.496×10¹⁰ km */
    const helio  = 1.496e10;
    const helioR = Math.min(helio * SCALE, W * 0.46);
    ctx.beginPath();
    ctx.arc(cx, cy, helioR, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(60,100,200,0.05)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(100,150,255,0.12)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120,160,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.fillText('Heliosphere', cx - 30, cy - helioR + 12);

    /* Sun */
    const sunG = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
    sunG.addColorStop(0, '#fffde7');
    sunG.addColorStop(0.4, '#FFD700');
    sunG.addColorStop(1,   '#FF8C00');
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fillStyle = sunG;
    ctx.fill();
    const sunGlow = ctx.createRadialGradient(cx, cy, 8, cx, cy, 24);
    sunGlow.addColorStop(0, 'rgba(255,215,0,0.3)');
    sunGlow.addColorStop(1, 'rgba(255,215,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = sunGlow;
    ctx.fill();

    /* Probes */
    LOC_PROBES.forEach((probe, i) => {
        const dist   = locProbeDistance(i);
        const coords = loc3D(probe, dist);
        const px     = cx + coords.x * SCALE;
        const py     = cy - coords.y * SCALE;

        // Uncertainty from paper §6: ΔD = (σ_λ/λ)·D ≈ 5.56% of D
        const unc = locUncertainty(dist);
        const uR  = Math.max(6, unc * SCALE);

        /* trail from Sun */
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.strokeStyle = probe.color + '28';
        ctx.lineWidth   = 0.8;
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        /* uncertainty disc [Paper §6] */
        ctx.beginPath();
        ctx.arc(px, py, uR, 0, Math.PI * 2);
        ctx.fillStyle = probe.color + '1a';
        ctx.fill();
        ctx.strokeStyle = probe.color + '50';
        ctx.lineWidth   = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        /* probe dot */
        const sel = locSelectedProbe === i;
        ctx.beginPath();
        ctx.arc(px, py, sel ? 7 : 4, 0, Math.PI * 2);
        ctx.fillStyle = probe.color;
        ctx.fill();
        if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }

        /* label */
        let lx = px + 10, ly = py - 9;
        if (lx > W - 90) lx = px - 95;
        if (ly < 14)      ly = py + 20;
        ctx.fillStyle = probe.color;
        ctx.font = `${sel ? '600' : '400'} 11px sans-serif`;
        ctx.fillText(probe.name, lx, ly);
        ctx.fillStyle = probe.color + 'aa';
        ctx.font = '9px sans-serif';
        ctx.fillText((dist / LOC_AU_TO_KM).toFixed(1) + ' AU', lx, ly + 12);

        // QSL value label on map
        const qsl = locQSL(dist);
        ctx.fillStyle = qsl > 0.9 ? '#ff6b6b' : probe.color + 'cc';
        ctx.fillText(`QSL=${qsl.toFixed(4)}`, lx, ly + 23);
    });

    /* Scale bar */
    let scaleKm = 5e9, scalePx = scaleKm * SCALE;
    if (scalePx > 100) { scaleKm = 2e9; scalePx = scaleKm * SCALE; }
    ctx.beginPath();
    ctx.moveTo(14, 328); ctx.lineTo(14 + scalePx, 328);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '9px sans-serif';
    ctx.fillText((scaleKm / 1e9).toFixed(0) + ' B km', 14, 324);
}

/* --- Data panel --- */
function locUpdatePanel() {
    const probe  = LOC_PROBES[locSelectedProbe];
    const dist   = locProbeDistance(locSelectedProbe);
    const coords = loc3D(probe, dist);

    // Paper equations — all with fixed λ
    const qsl    = locQSL(dist);
    const qsu    = 1 - qsl;
    const ceff   = computeCeff(dist);
    const bounds = computeQSLBounds(dist);
    const delta  = probeLightTime(LOC_PROBE_KEYS[locSelectedProbe]);
    const unc    = locUncertainty(dist);     // from Paper §6

    const setT = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    setT('locProbeName', probe.name);
    setT('locX', locFmt(coords.x));
    setT('locY', locFmt(coords.y));
    setT('locZ', locFmt(coords.z));
    setT('locR', (dist / LOC_AU_TO_KM).toFixed(4) + ' AU');
    setT('locUncertaintyVal', locFmt(unc) + '  (= σ_λ/λ · D)');

    setT('locQslVal', qsl.toFixed(8));
    setT('locQsuVal', qsu.toFixed(8));
    const qslBar = document.getElementById('locQslBar');
    const qsuBar = document.getElementById('locQsuBar');
    if (qslBar) qslBar.style.width = Math.min(qsl * 100, 100).toFixed(3) + '%';
    if (qsuBar) qsuBar.style.width = Math.min(qsu * 100, 100).toFixed(3) + '%';

    // Localization: compare selected probe vs the other two [Paper §9]
    const keys   = LOC_PROBE_KEYS.filter((_, i) => i !== locSelectedProbe);
    const D2     = probeDistance(keys[0]);
    const D3     = probeDistance(keys[1]);
    const Q1     = qsl;
    const Q2     = locQSL(D2);
    const Q3     = locQSL(D3);
    const D12    = computeDdist(dist, Q1, D2, Q2);
    const D13    = computeDdist(dist, Q1, D3, Q3);
    const terrKm = (D12 && D13) ? Math.abs(D12 - D13) : null;

    setT('locD1',   locFmt(dist));
    setT('locD2',   locFmt(D2));
    setT('locD3',   locFmt(D3));
    setT('locD12',  D12 ? locFmt(D12) : 'N/A');
    setT('locD23',  D13 ? locFmt(D13) : 'N/A');
    setT('locTerr', terrKm ? '±' + locFmt(terrKm * 0.01) : 'N/A');

    const dataTag = NASA_DATA[LOC_PROBE_KEYS[locSelectedProbe]]
        ? '✅ NASA JPL Horizons' : '⚠️ Physics fallback';

    /* Raw telemetry — research grade */
    const tel = document.getElementById('locRawTelemetry');
    if (tel) {
        tel.textContent = [
            `━━ QSL RESEARCH TELEMETRY ━━━━━━━━━━━━━━━━━━`,
            `PROBE         : ${probe.name}`,
            `DATA SOURCE   : ${dataTag}`,
            `TIMESTAMP     : ${new Date().toISOString()}`,
            ``,
            `━━ DISTANCES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `D (km)        : ${dist.toExponential(6)}`,
            `D (AU)        : ${(dist / LOC_AU_TO_KM).toFixed(6)}`,
            `Δ = D/c (s)   : ${delta.toFixed(4)}`,
            ``,
            `━━ QSL MODEL [Paper §2] ━━━━━━━━━━━━━━━━━━━`,
            `λ (calibrated): ${LAMBDA.toExponential(1)} ± ${LAMBDA_ERR.toExponential(1)}`,
            `QSL = 1-e^-λΔ : ${qsl.toFixed(8)}`,
            `QSU = e^-λΔ   : ${qsu.toFixed(8)}`,
            `Ceff = QSU·e^-μD : ${ceff.toExponential(6)}`,
            `QSL lower (λ-σ): ${bounds.lower.toFixed(8)}`,
            `QSL upper (λ+σ): ${bounds.upper.toFixed(8)}`,
            ``,
            `━━ 3D COORDINATES ━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `X (km)        : ${coords.x.toExponential(5)}`,
            `Y (km)        : ${coords.y.toExponential(5)}`,
            `Z (km)        : ${coords.z.toExponential(5)}`,
            ``,
            `━━ UNCERTAINTY [Paper §6] ━━━━━━━━━━━━━━━━━`,
            `ΔD = σ_λ/λ·D  : ±${unc.toExponential(4)} km`,
            ``,
            `━━ LOCALIZATION [Paper §9] ━━━━━━━━━━━━━━━━`,
            `D1, Q1        : ${dist.toExponential(4)} km, ${Q1.toFixed(6)}`,
            `D2, Q2        : ${D2.toExponential(4)} km, ${Q2.toFixed(6)}`,
            `D3, Q3        : ${D3.toExponential(4)} km, ${Q3.toFixed(6)}`,
            `Ddist (1↔2)   : ${D12 ? D12.toExponential(5)+' km' : 'N/A'}`,
            `Ddist (1↔3)   : ${D13 ? D13.toExponential(5)+' km' : 'N/A'}`,
            ``,
            `━━ STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `D_crit check  : ${dist >= D_CRIT ? '⚠ BEYOND Dcrit' : '✓ Within range'}`,
            `Coherence     : ${qsl > 0.9 ? '⚠ NEAR-TOTAL LOSS (QSL > 0.9)' : qsl > 0.85 ? 'HIGH LOSS' : '✓ NOMINAL'}`
        ].join('\n');
    }
}

function locLoop() {
    locDrawMap();
    locUpdatePanel();
}

document.addEventListener('DOMContentLoaded', () => {
    locLoop();
    setInterval(locLoop, 2000);
    window.addEventListener('resize', locDrawMap);
    setTimeout(locLoop, 100);
});
