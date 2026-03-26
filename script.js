/*
 * Quantum Signal Loss (QSL) Simulator
 * Real Voyager + 3 Probe Localization (Final)
 */

// === CONSTANTS ===
const LIGHT_SPEED = 299792.458;
const EARTH_MARS_AVG_DISTANCE = 225000000;
const MARS_ATMOSPHERIC_LOSS = 0.04;
const MARS_VELOCITY = 24;
const PROBE_VELOCITY = 15;
const SIGNAL_FREQUENCY = 8.4e9;

const BASE_LAMBDA = 3.6e-7;

// === REAL DATA ===
let REAL_DISTANCE = null;

// === FETCH VOYAGER ===
async function updateVoyagerDistance() {
    try {
        const res = await fetch("/api/voyager");
        const data = await res.json();
        if (data.distance) REAL_DISTANCE = data.distance;
    } catch {
        console.warn("Voyager fetch failed");
    }
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

// === FALLBACK ===
function getFallbackDistance() {
    const baseDistance = 2.47e10;
    const velocity = 17;
    const t = (Date.now() - 1700000000000) / 1000;

    let distance = baseDistance + velocity * t;
    let perturb = Math.abs(Math.sin(t / 50000)) * 5e5;

    return distance + perturb;
}

// === DISTANCE ===
function getRealProbeDistance() {
    return REAL_DISTANCE || getFallbackDistance();
}

// === QSL ===
function getQSL(distance) {
    let interference = getControlledNoise();
    let lambda = computeLambda(distance, interference);
    let delay = distance / LIGHT_SPEED;
    return 1 - Math.exp(-lambda * delay);
}

// === YOUR EQUATION ===
function computeDdist(D1, Q1, D2, Q2) {
    if (Q1 >= 0.999999 || Q2 >= 0.999999) return null;

    const ln1 = Math.log(1 - Q1);
    const ln2 = Math.log(1 - Q2);

    const num = (D1 * ln2) - (D2 * ln1);
    const den = ln2 - ln1;

    if (Math.abs(den) < 1e-12) return null;

    return Math.abs(num / den);
}

// === TRIANGULATION ===
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

// === MARS ===
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

// === DEEP SPACE + LOCALIZATION ===
function deepSpaceProbeData() {

    let D1 = getRealProbeDistance();
    let D2 = D1 * 0.92;
    let D3 = D1 * 1.05;

    let Q1 = getQSL(D1);
    let Q2 = getQSL(D2);
    let Q3 = getQSL(D3);

    let D12 = computeDdist(D1, Q1, D2, Q2);
    let D23 = computeDdist(D2, Q2, D3, Q3);

    const p1 = { x: D1, y: 0 };
    const p2 = { x: D2, y: 5e9 };
    const p3 = { x: D3, y: -5e9 };

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

    let signalDelay = D1 / LIGHT_SPEED;

    document.getElementById("deep-space-data").innerHTML = `
        📡 <strong>Distance:</strong> ${D1.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalDelay.toFixed(6)} sec <br>
        💠 <strong>QSL:</strong> ${Q1.toFixed(6)} <br>
        📊 <strong>Status:</strong> Active <br>
        <hr>
        🧭 <strong>Localization:</strong><br> ${locText}
    `;
}

// === INIT ===
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 5000);
setInterval(updateVoyagerDistance, 10000);

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
