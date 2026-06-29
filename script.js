/*
 * Quantum-Inspired Signal Loss (QSL) Simulator
 * Author  : Vivek Mishra
 * Paper   : "Quantum-Inspired Signal Loss (QSL): A Probabilistic
 *            Exponential-Decay Model for Deep-Space Communication Coherence"
 * DOI     : https://doi.org/10.5281/zenodo.16919283
 *
 * Core equation  : QSL  = 1 - e^(-λ·Δ)                        [Paper §2]
 * Complementary  : QSU  = e^(-λ·Δ)                            [Paper §2]
 * Delay          : Δ    = D / c                                [Paper §2]
 * Attenuation    : Ceff = QSU · e^(-μ·D)                      [Paper §4]
 * Localization   : Ddist = [D1·ln(1-Q2) - D2·ln(1-Q1)]
 *                          / [ln(1-Q2) - ln(1-Q1)]            [Paper §9]
 *
 * λ = (3.6 ± 0.2) × 10⁻⁷  calibrated from Voyager-2 DSN     [Paper §3]
 * Dcrit ≈ 8.0 × 10⁹ km  at QSL_crit = 0.99                  [Paper §7]
 *
 * NOTE on λ scope [Paper §3]:
 *   λ is valid for Voyager-2 operating conditions (deep interstellar).
 *   For Mars-range spacecraft (MRO, MAVEN), the paper provides OBSERVED
 *   QSL values from DSN power budgets, not from this same λ.
 *   Paper Table §5: MRO observed QSL ≈ 0.084 at D = 2.3×10⁸ km.
 *   We honour this by showing BOTH the model QSL(λ) AND the paper
 *   observed QSL for context.
 */

"use strict";

/* ============================================================
   SECTION 1 — PHYSICAL CONSTANTS
   ============================================================ */

const C           = 299792.458;   // Speed of light (km/s)
const LAMBDA      = 3.6e-7;      // Calibrated λ [Paper §3] — Voyager-2 regime
const LAMBDA_ERR  = 0.2e-7;      // 1σ uncertainty on λ [Paper §6]
const MU          = 1e-14;       // Path-loss coefficient μ [Paper §4]
const D_CRIT      = 8.0e9;      // Critical distance km [Paper §7]
const AU_TO_KM    = 149597870.7; // 1 AU in km
const SIGNAL_FREQ = 8.4e9;      // DSN X-band Hz

/*
 * Paper Table §5 — OBSERVED QSL values from DSN power budgets
 * These are the ground-truth reference values from the paper.
 * They are NOT computed from λ — they are empirically measured.
 */
const PAPER_TABLE = {
    MRO:      { D_km: 2.3e8,   QSL_obs: 0.084,  label: "MRO (Mars)  [Paper §5]" },
    TGO:      { D_km: 9.1e9,   QSL_obs: 0.902,  label: "TGO (Deep)  [Paper §5]" },
    VOYAGER2: { D_km: 2.47e10, QSL_obs: 0.978,  label: "Voyager-2   [Paper §5]" }
};

/* ============================================================
   SECTION 2 — NASA JPL HORIZONS DATA CACHE
   ============================================================ */

let NASA_DATA = { voyager1: null, voyager2: null, new_horizons: null };
let NASA_LAST_FETCH = 0;
const NASA_CACHE_MS = 3600000; // 1 hour

// Physics fallback (JPL ephemeris mid-2026 baselines)
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
        console.warn("[QSL] Horizons fallback:", e.message);
    }
}

function probeDistance(key)  { return NASA_DATA[key]?.distance_km   || fallbackDistance(key); }
function probeVelocity(key)  { return Math.abs(NASA_DATA[key]?.velocity_km_s || FALLBACK[key].vel); }
function probeLightTime(key) { return NASA_DATA[key]?.light_time_sec || probeDistance(key) / C; }

/* ============================================================
   SECTION 3 — CORE QSL EQUATIONS  (paper-exact)
   ============================================================ */

// QSL = 1 − e^(−λ·Δ),  Δ = D/c  [Paper §2]
function computeQSL(D_km, lambda = LAMBDA) {
    return 1 - Math.exp(-lambda * (D_km / C));
}

// QSU = e^(−λ·Δ)  [Paper §2]
function computeQSU(D_km, lambda = LAMBDA) {
    return Math.exp(-lambda * (D_km / C));
}

// Ceff = QSU · e^(−μ·D)  [Paper §4]
function computeCeff(D_km) {
    return computeQSU(D_km) * Math.exp(-MU * D_km);
}

// QSL bounds from λ ± σ  [Paper §6]
function computeQSLBounds(D_km) {
    return {
        nominal: computeQSL(D_km, LAMBDA),
        upper:   computeQSL(D_km, LAMBDA + LAMBDA_ERR),
        lower:   computeQSL(D_km, LAMBDA - LAMBDA_ERR)
    };
}

// dQSL/dt gradient  [Paper §8]
function computeGradient(Q1, T1, Q2, T2) {
    const dT = T2 - T1;
    return Math.abs(dT) < 1e-9 ? 0 : (Q2 - Q1) / dT;
}

/*
 * Localization estimator  [Paper §9]
 * Ddist = [D1·ln(1−Q2) − D2·ln(1−Q1)] / [ln(1−Q2) − ln(1−Q1)]
 *
 * IMPORTANT: This formula is degenerate when both probes follow
 * the same λ (which they do here since λ is a single constant).
 * In that case ln(1−Q) = −λ·D/c, so Ddist = D1 always.
 * Real use case: two probes with DIFFERENT observed QSL values
 * (e.g. one in solar plasma, one in clear interstellar medium).
 * We therefore use the paper's worked example values from §9
 * when real cross-spacecraft differential data is available,
 * and show a meaningful result only when |ln1 − ln2| is large
 * enough to be physically meaningful (not just numerical noise).
 */
function computeDdist(D1, Q1, D2, Q2) {
    if (Q1 >= 0.999999 || Q2 >= 0.999999) return null;
    if (Q1 <= 0 || Q2 <= 0) return null;
    const ln1 = Math.log(1 - Q1);
    const ln2 = Math.log(1 - Q2);
    const den  = ln2 - ln1;
    // Guard: denominaor must be physically meaningful (not degenerate)
    // If |den| < 0.01 the two signals are too similar to localize
    if (Math.abs(den) < 0.01) return null;
    const result = (D1 * ln2 - D2 * ln1) / den;
    // Physical sanity: Ddist must be between 0 and max(D1,D2)
    const maxD = Math.max(D1, D2);
    if (result < 0 || result > maxD * 1.5) return null;
    return result;
}

// 2D triangulation  [Paper §9 extension]
function triangulate(p1, p2, p3, r1, r2, r3) {
    const A = 2*(p2.x-p1.x), B = 2*(p2.y-p1.y);
    const C_ = r1*r1-r2*r2-p1.x*p1.x+p2.x*p2.x-p1.y*p1.y+p2.y*p2.y;
    const D_ = 2*(p3.x-p2.x), E = 2*(p3.y-p2.y);
    const F  = r2*r2-r3*r3-p2.x*p2.x+p3.x*p3.x-p2.y*p2.y+p3.y*p3.y;
    const det = A*E - B*D_;
    if (Math.abs(det) < 1e-6) return null;
    return { x: (C_*E-B*F)/det, y: (A*F-C_*D_)/det };
}

/* ============================================================
   SECTION 4 — NASA DSN REAL-TIME FEED  [Paper Ref 1]
   Source: https://eyes.nasa.gov/dsn/data/dsn.json
   ============================================================ */
/*
 * NASA's dsn.json IS directly fetchable from the browser —
 * confirmed CORS-open. No proxy needed.
 *
 * Real JSON structure (verified live):
 * {
 *   "time": 1782725408,
 *   "dishes": {
 *     "54": {
 *       "sigs": [{ "active":true, "band":"X", "dir":"down",
 *                  "pwr":-130, "rate":39820, "tgt":"MRO" }],
 *       "tgts": {
 *         "MRO": { "rng": 316000000, "rtlt": "NaN" }
 *       }
 *     }, ...
 *   }
 * }
 *
 * Known spacecraft codes from live feed:
 *   MRO  = Mars Reconnaissance Orbiter
 *   TGO  = ExoMars Trace Gas Orbiter
 *   M01O = Mars Odyssey
 *   EMM  = Emirates Mars Mission (Hope)
 *   MAVEN= Mars Atmosphere and Volatile EvolutioN
 */

const DSN_URL     = "https://eyes.nasa.gov/dsn/data/dsn.json";
const MARS_CODES  = new Set(['mro','tgo','m01o','emm','maven','mcs','m20','ingenuity']);
const MARS_NAMES  = { MRO:'Mars Recon. Orbiter', TGO:'ExoMars TGO',
                      M01O:'Mars Odyssey', EMM:'Emirates Mars Mission',
                      MAVEN:'MAVEN', M20:'Perseverance' };

let DSN_CACHE      = null;
let DSN_LAST_FETCH = 0;
const DSN_CACHE_MS = 5000; // DSN JSON updates every ~5 s

async function fetchDSN() {
    const now = Date.now();
    if (now - DSN_LAST_FETCH < DSN_CACHE_MS && DSN_CACHE) return DSN_CACHE;
    try {
        // Direct browser fetch — NASA dsn.json has open CORS
        const res  = await fetch(DSN_URL + "?r=" + now);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        DSN_CACHE      = json;
        DSN_LAST_FETCH = now;
        return json;
    } catch (e) {
        console.warn("[QSL] DSN fetch failed:", e.message);
        return DSN_CACHE; // return last good cache
    }
}

/*
 * Parse real dsn.json structure.
 * Returns best Mars spacecraft found, with real distance & power.
 * Priority: first one with a valid numeric rng value.
 */
function parseDSN(data) {
    if (!data || !data.dishes) return null;

    let best = null;
    let bestPriority = 99;

    for (const [dishId, dish] of Object.entries(data.dishes)) {
        if (!dish.tgts) continue;

        for (const [tgtCode, tgtData] of Object.entries(dish.tgts)) {
            const code = tgtCode.toLowerCase();
            if (!MARS_CODES.has(code)) continue;

            const rng = parseFloat(tgtData.rng);
            if (isNaN(rng) || rng <= 0) continue;

            // Find signal power from sigs array
            let power = NaN;
            let band  = 'X';
            if (Array.isArray(dish.sigs)) {
                const sig = dish.sigs.find(s =>
                    s.tgt?.toLowerCase() === code && s.dir === 'down' && s.active);
                if (sig) { power = sig.pwr; band = sig.band || 'X'; }
            }

            // Priority: MRO first, then TGO, then others
            const pri = tgtCode === 'MRO' ? 0 : tgtCode === 'TGO' ? 1 : 2;
            if (pri < bestPriority) {
                bestPriority = pri;
                best = {
                    spacecraft:  MARS_NAMES[tgtCode] || tgtCode,
                    code:        tgtCode,
                    distance_km: rng,
                    power_dB:    power,
                    band:        band,
                    dish_id:     dishId
                };
            }
        }
    }
    return best;
}

/* ============================================================
   SECTION 5 — MARS ZONE
   ============================================================ */

const EARTH_MARS_AVG = 225000000; // km average
const MARS_VEL       = 24.07;     // km/s Mars orbital velocity

async function getMarsOrbiterData() {
    const dsn  = await fetchDSN();
    const live = parseDSN(dsn);

    let D_km, spacecraft, power_dB, dataSource, freq;

    if (live) {
        D_km       = live.distance_km;
        spacecraft = live.spacecraft;
        power_dB   = live.power_dB.toFixed(2) + " dB";
        freq       = live.freq_hz;
        dataSource = "✅ NASA DSN Live Feed (eyes.nasa.gov/dsn)";
    } else {
        // Orbital mechanics estimate — clearly labelled
        D_km       = EARTH_MARS_AVG + Math.sin(Date.now() / 5000000) * 5000000;
        spacecraft = "MRO";
        power_dB   = "N/A";
        freq       = SIGNAL_FREQ;
        dataSource = "⚠️ Physics estimate — DSN proxy unavailable";
    }

    // Paper §2 equations — λ fixed
    const delta  = D_km / C;
    const qsl    = computeQSL(D_km);
    const qsu    = computeQSU(D_km);
    const ceff   = computeCeff(D_km);
    const bounds = computeQSLBounds(D_km);

    // Paper Table §5 reference for MRO: QSL_obs = 0.084 at 2.3×10⁸ km
    // NOTE: This observed value comes from DSN power budget, not from λ.
    // The model QSL at Mars range is very small because λ was calibrated
    // at Voyager-2 scale. This is documented in Paper §3 (scope of λ).
    const paperRef = PAPER_TABLE.MRO;
    const paperNote = `Paper §5 observed: ${paperRef.QSL_obs} at ${(paperRef.D_km/1e8).toFixed(1)}×10⁸ km`;

    // Doppler
    const vel_eff     = MARS_VEL + Math.sin(Date.now() / 5000000) * 0.5;
    const freq_rx     = freq * (1 - vel_eff / C);
    const deltaF      = freq_rx - freq;

    // Status per paper §11
    const coherence = qsl > 0.9
        ? "⚠️ High Coherence Loss (QSL > 0.9)"
        : qsl > 0.084  // paper MRO threshold
        ? "🟡 Moderate Loss"
        : "✅ Signal Coherent (within MRO range)";

    const critStatus = D_km >= D_CRIT
        ? `⛔ Beyond D_crit — coherence collapse zone`
        : `✅ Within coherent range (D_crit = ${(D_CRIT/1e9).toFixed(0)} B km)`;

    document.getElementById("mars-data").innerHTML = `
        🛰️ <strong>Spacecraft:</strong> ${spacecraft}<br>
        📡 <strong>Data Source:</strong> ${dataSource}<br>
        📏 <strong>Distance (D):</strong> ${D_km.toFixed(2)} km<br>
        ⏳ <strong>Delay (Δ = D/c):</strong> ${delta.toFixed(4)} s<br>
        🔬 <strong>λ (calibrated):</strong> ${LAMBDA.toExponential(1)} ± ${LAMBDA_ERR.toExponential(1)}<br>
        💠 <strong>QSL = 1−e<sup>−λΔ</sup>:</strong> ${qsl.toFixed(8)}<br>
        🧿 <strong>QSU = e<sup>−λΔ</sup>:</strong> ${qsu.toFixed(8)}<br>
        🔬 <strong>C<sub>eff</sub> = QSU·e<sup>−μD</sup>:</strong> ${ceff.toExponential(6)}<br>
        📊 <strong>QSL bounds (λ±σ):</strong> [${bounds.lower.toFixed(6)}, ${bounds.upper.toFixed(6)}]<br>
        📋 <strong>${paperNote}</strong><br>
        📶 <strong>Signal Power:</strong> ${power_dB}<br>
        📈 <strong>Doppler Δf:</strong> ${deltaF.toFixed(0)} Hz<br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Coherence:</strong> ${coherence}<br>
        🎯 <strong>D_crit status:</strong> ${critStatus}
    `;
}

/* ============================================================
   SECTION 6 — DEEP SPACE ZONE  (Voyager 1, real NASA data)
   ============================================================ */

let _prevQSL = null, _prevTime = null;

function deepSpaceProbeData() {
    const D     = probeDistance("voyager1");
    const delta = probeLightTime("voyager1");
    const vel   = probeVelocity("voyager1");

    // Paper §2 — fixed λ
    const qsl    = computeQSL(D);
    const qsu    = computeQSU(D);
    const ceff   = computeCeff(D);
    const bounds = computeQSLBounds(D);

    // Gradient [Paper §8]
    const now = Date.now() / 1000;
    let gradText = "N/A (first reading)";
    if (_prevQSL !== null) {
        const g = computeGradient(_prevQSL, _prevTime, qsl, now);
        gradText = g.toExponential(4) + " s⁻¹";
    }
    _prevQSL  = qsl;
    _prevTime = now;

    // Localization [Paper §9] — V1 vs V2
    // These have very different QSL values only because DSN power varies;
    // with fixed λ they differ only by distance. Guard in computeDdist
    // handles the degenerate case and returns null with clear message.
    const D2    = probeDistance("voyager2");
    const Q1    = qsl;
    const Q2    = computeQSL(D2);
    const Ddist = computeDdist(D, Q1, D2, Q2);

    // Paper §9 worked example for reference
    const paperEx_Ddist = computeDdist(1.0e9, 0.40, 2.47e10, 0.97);

    // Doppler (real velocity from NASA)
    const freq_rx = SIGNAL_FREQ * (1 - vel / C);
    const deltaF  = freq_rx - SIGNAL_FREQ;

    // Paper §7 critical check
    const critFlag = D >= D_CRIT
        ? "⛔ BEYOND D_crit — coherence collapse zone [Paper §7]"
        : "✅ Within coherent range";

    // Paper §11 status
    const anomaly = qsl > 0.9
        ? "⚠️ Signal Disruption — QSL > 0.9 [Paper §11]"
        : qsl > 0.85
        ? "🟡 High Loss — monitor closely"
        : "✅ Signal Stable";

    // Paper §5 reference comparison
    const v2ref = PAPER_TABLE.VOYAGER2;

    const dataTag = NASA_DATA.voyager1
        ? "✅ NASA JPL Horizons — Real Ephemeris"
        : "⚠️ Physics fallback (Horizons unavailable)";

    // Ddist display — clear when degenerate
    let ddistText;
    if (Ddist) {
        ddistText = `${Ddist.toExponential(4)} km = ${(Ddist/1e9).toFixed(3)} B km`;
    } else {
        ddistText = `Degenerate (V1 & V2 on same λ path — need cross-mission observed QSL)`;
    }

    document.getElementById("deep-space-data").innerHTML = `
        📡 <strong>Data Source:</strong> ${dataTag}<br>
        📏 <strong>Distance (D):</strong> ${D.toFixed(2)} km | ${(D/AU_TO_KM).toFixed(3)} AU<br>
        ⏳ <strong>Delay (Δ = D/c):</strong> ${delta.toFixed(2)} s (${(delta/3600).toFixed(2)} hr)<br>
        🔬 <strong>λ (calibrated):</strong> ${LAMBDA.toExponential(1)} ± ${LAMBDA_ERR.toExponential(1)} [Paper §3]<br>
        💠 <strong>QSL = 1−e<sup>−λΔ</sup>:</strong> ${qsl.toFixed(8)}<br>
        🧿 <strong>QSU = e<sup>−λΔ</sup>:</strong> ${qsu.toFixed(8)}<br>
        🔬 <strong>C<sub>eff</sub> = QSU·e<sup>−μD</sup>:</strong> ${ceff.toExponential(6)}<br>
        📊 <strong>QSL bounds (λ±σ):</strong> [${bounds.lower.toFixed(6)}, ${bounds.upper.toFixed(6)}]<br>
        📋 <strong>Paper §5 ref (V2):</strong> QSL_obs=${v2ref.QSL_obs} at ${(v2ref.D_km/1e10).toFixed(2)}×10¹⁰ km<br>
        📉 <strong>dQSL/dt:</strong> ${gradText} [Paper §8]<br>
        🎯 <strong>D_crit check:</strong> ${critFlag}<br>
        🌀 <strong>Velocity:</strong> ${vel.toFixed(3)} km/s<br>
        📈 <strong>Doppler Δf:</strong> ${deltaF.toFixed(0)} Hz<br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
        <hr>
        🧭 <strong>Localization — Paper §9:</strong><br>
        &nbsp;&nbsp;V1: D₁=${(D/1e9).toFixed(3)} B km, Q₁=${Q1.toFixed(6)}<br>
        &nbsp;&nbsp;V2: D₂=${(D2/1e9).toFixed(3)} B km, Q₂=${Q2.toFixed(6)}<br>
        &nbsp;&nbsp;<strong>D<sub>dist</sub> = ${ddistText}</strong><br>
        &nbsp;&nbsp;📋 Paper §9 worked example: D<sub>dist</sub> ≈ ${paperEx_Ddist ? (paperEx_Ddist/1e9).toFixed(2)+' B km' : 'N/A'} (TGO Q=0.40 vs V2 Q=0.97)
    `;
}

/* ============================================================
   SECTION 7 — INTERVALS + THEME
   ============================================================ */

updateNASAData();
setInterval(updateNASAData, NASA_CACHE_MS);
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);

document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("themeToggle");
    const theme  = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", theme);
    toggle.innerText = theme === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";

    toggle.addEventListener("click", () => {
        const t = document.documentElement.getAttribute("data-theme") === "dark"
            ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", t);
        toggle.innerText = t === "dark" ? "☀️ Light Mode" : "🌙 Dark Mode";
        localStorage.setItem("theme", t);
    });

    getMarsOrbiterData();
    deepSpaceProbeData();
});

/* ============================================================
   SECTION 8 — ADVANCED LOCALIZATION ENGINE
   ============================================================ */

const LOC_AU_TO_KM   = AU_TO_KM;
const LOC_PROBE_KEYS = ["voyager1", "voyager2", "new_horizons"];
let   locSelectedProbe = 0;

// Real heliocentric trajectory angles (JPL published)
const LOC_PROBES = [
    { name:'Voyager 1',    color:'#4fc3f7', angleXY:255*Math.PI/180, angleZ: 34.9*Math.PI/180 },
    { name:'Voyager 2',    color:'#81c784', angleXY:289*Math.PI/180, angleZ:-31.0*Math.PI/180 },
    { name:'New Horizons', color:'#f48fb1', angleXY: 23*Math.PI/180, angleZ:  2.5*Math.PI/180 }
];

// QSL with paper-fixed λ
function locQSL(D_km) { return computeQSL(D_km, LAMBDA); }

function locProbeDistance(idx) { return probeDistance(LOC_PROBE_KEYS[idx]); }

function loc3D(probe, dist) {
    return {
        x: dist * Math.cos(probe.angleZ) * Math.cos(probe.angleXY),
        y: dist * Math.cos(probe.angleZ) * Math.sin(probe.angleXY),
        z: dist * Math.sin(probe.angleZ)
    };
}

// Uncertainty from λ propagation [Paper §6]: ΔD = (σ_λ/λ)·D
function locUncertainty(D_km) { return (LAMBDA_ERR / LAMBDA) * D_km; }

function locFmt(n) {
    if (n === null || isNaN(n)) return 'N/A';
    if (Math.abs(n) >= 1e9)    return (n/1e9).toFixed(3) + ' B km';
    if (Math.abs(n) >= 1e6)    return (n/1e6).toFixed(3) + ' M km';
    return n.toFixed(2) + ' km';
}

function locSelectProbe(i) {
    locSelectedProbe = i;
    document.querySelectorAll('.loc-probe-tab').forEach((t, idx) =>
        t.classList.toggle('active', idx === i));
}

function locDrawMap() {
    const canvas = document.getElementById('locSolarMap');
    if (!canvas) return;
    const W  = canvas.parentElement.clientWidth || 700;
    canvas.width = W; canvas.height = 340;
    const ctx = canvas.getContext('2d');
    const cx = W/2, cy = 170;

    const maxD  = Math.max(locProbeDistance(0), locProbeDistance(1), locProbeDistance(2));
    const SCALE = (W/2 - 40) / maxD;

    // Background
    ctx.fillStyle = '#030b1a';
    ctx.fillRect(0, 0, W, 340);

    // Stars
    for (let i = 0; i < 130; i++) {
        const sx = (Math.sin(i*137.508)*0.5+0.5)*W;
        const sy = (Math.cos(i*97.31)  *0.5+0.5)*340;
        ctx.beginPath();
        ctx.arc(sx, sy, i%7===0?1.2:0.6, 0, Math.PI*2);
        ctx.fillStyle = `rgba(255,255,255,${0.25+(i%4)*0.1})`;
        ctx.fill();
    }

    // D_crit ring — red dashed [Paper §7]
    const critR = D_CRIT * SCALE;
    if (critR < W/2 - 5) {
        ctx.beginPath();
        ctx.arc(cx, cy, critR, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(255,80,80,0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5,4]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,100,100,0.8)';
        ctx.font = '9px sans-serif';
        ctx.fillText('D_crit = 8×10⁹ km [Paper §7]', cx - critR + 4, cy - critR + 12);
    }

    // Heliosphere ~100 AU
    const helioR = Math.min(1.496e10 * SCALE, W*0.46);
    ctx.beginPath();
    ctx.arc(cx, cy, helioR, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(60,100,200,0.05)'; ctx.fill();
    ctx.strokeStyle = 'rgba(100,150,255,0.12)';
    ctx.lineWidth = 1; ctx.setLineDash([4,6]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(120,160,255,0.5)';
    ctx.font = '9px sans-serif';
    ctx.fillText('Heliosphere', cx-28, cy-helioR+12);

    // Sun
    const sg = ctx.createRadialGradient(cx,cy,0,cx,cy,14);
    sg.addColorStop(0,'#fffde7'); sg.addColorStop(0.4,'#FFD700'); sg.addColorStop(1,'#FF8C00');
    ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.fillStyle=sg; ctx.fill();
    const gl = ctx.createRadialGradient(cx,cy,8,cx,cy,24);
    gl.addColorStop(0,'rgba(255,215,0,0.3)'); gl.addColorStop(1,'rgba(255,215,0,0)');
    ctx.beginPath(); ctx.arc(cx,cy,24,0,Math.PI*2); ctx.fillStyle=gl; ctx.fill();

    // Probes
    LOC_PROBES.forEach((probe, i) => {
        const dist   = locProbeDistance(i);
        const coords = loc3D(probe, dist);
        const px = cx + coords.x * SCALE;
        const py = cy - coords.y * SCALE;
        const unc = locUncertainty(dist);
        const uR  = Math.max(6, unc * SCALE);
        const qsl = locQSL(dist);

        // Trail
        ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(px,py);
        ctx.strokeStyle=probe.color+'28'; ctx.lineWidth=0.8;
        ctx.setLineDash([3,5]); ctx.stroke(); ctx.setLineDash([]);

        // Uncertainty disc [Paper §6]
        ctx.beginPath(); ctx.arc(px,py,uR,0,Math.PI*2);
        ctx.fillStyle=probe.color+'1a'; ctx.fill();
        ctx.strokeStyle=probe.color+'50'; ctx.lineWidth=0.5;
        ctx.setLineDash([2,3]); ctx.stroke(); ctx.setLineDash([]);

        // Probe dot
        const sel = locSelectedProbe===i;
        ctx.beginPath(); ctx.arc(px,py,sel?7:4,0,Math.PI*2);
        ctx.fillStyle=probe.color; ctx.fill();
        if (sel) { ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.stroke(); }

        // Label
        let lx=px+10, ly=py-9;
        if (lx>W-95) lx=px-100;
        if (ly<14)   ly=py+20;
        ctx.fillStyle=probe.color;
        ctx.font=`${sel?'600':'400'} 11px sans-serif`;
        ctx.fillText(probe.name,lx,ly);
        ctx.fillStyle=probe.color+'aa'; ctx.font='9px sans-serif';
        ctx.fillText((dist/LOC_AU_TO_KM).toFixed(1)+' AU',lx,ly+12);
        ctx.fillStyle= qsl>0.9?'#ff6b6b':probe.color+'cc';
        ctx.fillText(`QSL=${qsl.toFixed(4)}`,lx,ly+23);
    });

    // Scale bar
    let skm=5e9, spx=skm*SCALE;
    if (spx>100){skm=2e9;spx=skm*SCALE;}
    ctx.beginPath(); ctx.moveTo(14,328); ctx.lineTo(14+spx,328);
    ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1.5; ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,0.45)'; ctx.font='9px sans-serif';
    ctx.fillText((skm/1e9).toFixed(0)+' B km',14,324);
}

function locUpdatePanel() {
    const probe  = LOC_PROBES[locSelectedProbe];
    const dist   = locProbeDistance(locSelectedProbe);
    const coords = loc3D(probe, dist);
    const qsl    = locQSL(dist);
    const qsu    = 1 - qsl;
    const ceff   = computeCeff(dist);
    const bounds = computeQSLBounds(dist);
    const delta  = probeLightTime(LOC_PROBE_KEYS[locSelectedProbe]);
    const unc    = locUncertainty(dist);

    const setT = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    setT('locProbeName', probe.name);
    setT('locX', locFmt(coords.x));
    setT('locY', locFmt(coords.y));
    setT('locZ', locFmt(coords.z));
    setT('locR', (dist/LOC_AU_TO_KM).toFixed(4)+' AU');
    setT('locUncertaintyVal', locFmt(unc)+'  [= σ_λ/λ · D, Paper §6]');
    setT('locQslVal', qsl.toFixed(8));
    setT('locQsuVal', qsu.toFixed(8));
    const qslBar=document.getElementById('locQslBar');
    const qsuBar=document.getElementById('locQsuBar');
    if (qslBar) qslBar.style.width=Math.min(qsl*100,100).toFixed(3)+'%';
    if (qsuBar) qsuBar.style.width=Math.min(qsu*100,100).toFixed(3)+'%';

    // Cross-probe localization — use other two probes as references
    const otherKeys = LOC_PROBE_KEYS.filter((_,i)=>i!==locSelectedProbe);
    const D2  = probeDistance(otherKeys[0]);
    const D3  = probeDistance(otherKeys[1]);
    const Q1  = qsl;
    const Q2  = locQSL(D2);
    const Q3  = locQSL(D3);
    const D12 = computeDdist(dist, Q1, D2, Q2);
    const D13 = computeDdist(dist, Q1, D3, Q3);
    const terr= (D12&&D13) ? Math.abs(D12-D13)*0.01 : null;

    setT('locD1',   locFmt(dist));
    setT('locD2',   locFmt(D2));
    setT('locD3',   locFmt(D3));
    setT('locD12',  D12 ? locFmt(D12) : 'Degenerate — same λ path');
    setT('locD23',  D13 ? locFmt(D13) : 'Degenerate — same λ path');
    setT('locTerr', terr ? '±'+locFmt(terr) : 'N/A');

    const dataTag = NASA_DATA[LOC_PROBE_KEYS[locSelectedProbe]]
        ? '✅ NASA JPL Horizons' : '⚠️ Physics fallback';

    const tel = document.getElementById('locRawTelemetry');
    if (tel) tel.textContent = [
        `━━ QSL RESEARCH TELEMETRY ━━━━━━━━━━━━━━━━━━━━`,
        `PROBE          : ${probe.name}`,
        `DATA SOURCE    : ${dataTag}`,
        `TIMESTAMP      : ${new Date().toISOString()}`,
        ``,
        `━━ DISTANCES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `D (km)         : ${dist.toExponential(6)}`,
        `D (AU)         : ${(dist/LOC_AU_TO_KM).toFixed(6)}`,
        `Δ = D/c (s)    : ${delta.toFixed(4)}`,
        ``,
        `━━ QSL MODEL  [Paper §2] ━━━━━━━━━━━━━━━━━━━━━`,
        `λ              : ${LAMBDA.toExponential(1)} ± ${LAMBDA_ERR.toExponential(1)}`,
        `QSL = 1-e^-λΔ  : ${qsl.toFixed(8)}`,
        `QSU = e^-λΔ    : ${qsu.toFixed(8)}`,
        `Ceff = QSU·e^-μD: ${ceff.toExponential(6)}`,
        `QSL lower (λ-σ) : ${bounds.lower.toFixed(8)}`,
        `QSL upper (λ+σ) : ${bounds.upper.toFixed(8)}`,
        ``,
        `━━ 3D HELIOCENTRIC COORDS ━━━━━━━━━━━━━━━━━━━━`,
        `X (km)         : ${coords.x.toExponential(5)}`,
        `Y (km)         : ${coords.y.toExponential(5)}`,
        `Z (km)         : ${coords.z.toExponential(5)}`,
        ``,
        `━━ UNCERTAINTY  [Paper §6] ━━━━━━━━━━━━━━━━━━━`,
        `ΔD = σ_λ/λ · D : ±${unc.toExponential(4)} km  (~${(LAMBDA_ERR/LAMBDA*100).toFixed(1)}% of D)`,
        ``,
        `━━ LOCALIZATION  [Paper §9] ━━━━━━━━━━━━━━━━━━`,
        `D1,Q1          : ${dist.toExponential(4)} km, ${Q1.toFixed(6)}`,
        `D2,Q2          : ${D2.toExponential(4)} km, ${Q2.toFixed(6)}`,
        `D3,Q3          : ${D3.toExponential(4)} km, ${Q3.toFixed(6)}`,
        `Ddist (1↔2)    : ${D12 ? D12.toExponential(5)+' km' : 'Degenerate'}`,
        `Ddist (1↔3)    : ${D13 ? D13.toExponential(5)+' km' : 'Degenerate'}`,
        `Note           : Localization needs cross-mission QSL_obs (diff λ)`,
        `Paper §9 eg.   : TGO Q=0.40 + V2 Q=0.97 → Ddist≈3.0 B km`,
        ``,
        `━━ STATUS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `D_crit check   : ${dist>=D_CRIT?'⚠ BEYOND Dcrit (8×10⁹ km)':'✓ Within coherent range'}`,
        `Coherence      : ${qsl>0.9?'⚠ NEAR-TOTAL LOSS':qsl>0.85?'HIGH LOSS':'✓ NOMINAL'}`
    ].join('\n');
}

function locLoop() { locDrawMap(); locUpdatePanel(); }

document.addEventListener('DOMContentLoaded', () => {
    locLoop();
    setInterval(locLoop, 2000);
    window.addEventListener('resize', locDrawMap);
    setTimeout(locLoop, 100);
});
