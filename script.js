/*
 * Quantum Signal Loss (QSL) Simulator - Improved Version
 * Core logic by Vivek Mishra (unchanged)
 */

// === CONSTANTS ===
const LIGHT_SPEED = 299792.458; // km/s
const EARTH_MARS_AVG_DISTANCE = 225000000; // km
const MARS_ATMOSPHERIC_LOSS = 0.04;
const MARS_VELOCITY = 24; // km/s
const PROBE_VELOCITY = 15; // km/s
const SIGNAL_FREQUENCY = 8.4e9; // Hz

// === BASE QSL PARAMETER ===
const BASE_LAMBDA = 3.6e-7;

// === REAL DATA STORAGE ===
let DSN_DATA = null;

// === FETCH NASA DSN DATA ===
async function fetchDSNData() {
    try {
        const res = await fetch("https://eyes.nasa.gov/dsn/data/dsn.json");
        const data = await res.json();
        DSN_DATA = data;
    } catch (err) {
        console.warn("DSN fetch failed, using fallback simulation");
    }
}

// === DYNAMIC LAMBDA FUNCTION ===
function computeLambda(distance, interference) {
    let variation = (interference / 100) * 1e-7;
    let distanceFactor = distance / 1e10;
    return BASE_LAMBDA + variation * distanceFactor;
}

// === CONTROLLED NOISE ===
function getControlledNoise() {
    return 5 + Math.sin(Date.now() / 2000) * 3;
}

// === REALISTIC PROBE DISTANCE MODEL ===
function getRealProbeDistance() {
    const baseDistance = 2.47e10; // Voyager-like distance (km)
    const velocity = 17; // km/s

    const timeSeconds = Date.now() / 1000;

    let distance = baseDistance + (velocity * timeSeconds);

    // small perturbation
    distance += Math.sin(timeSeconds / 50000) * 5e6;

    return distance;
}

// === MARS ORBITER FUNCTION ===
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

    let dataHTML = `
        🛰️ <strong>Distance:</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        📶 <strong>Signal Strength:</strong> ${signalStrength} % <br>
        📡 <strong>Interference:</strong> ${interference} dB <br>
        📈 <strong>Received Frequency:</strong> ${receivedFreq.toFixed(2)} Hz <br>
        📊 <strong>Doppler Shift Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
    `;
    document.getElementById("mars-data").innerHTML = dataHTML;
}

// === DEEP SPACE FUNCTION (REAL PHYSICS - REFINED) ===
function deepSpaceProbeData() {

    // === REAL DISTANCE ===
    let distance = getRealProbeDistance();
    let signalDelay = distance / LIGHT_SPEED;
    let signalTime = signalDelay.toFixed(6);

    // === CONTROLLED INTERFERENCE (PHYSICS-LIKE) ===
    let interference = getControlledNoise();

    // === DYNAMIC LAMBDA ===
    let lambda = computeLambda(distance, interference);

    // === QSL CALCULATION ===
    let qsl = 1 - Math.exp(-lambda * signalDelay);
    let qsu = Math.exp(-lambda * signalDelay);

    // === REALISTIC DOPPLER (SMALL VARIATION ONLY) ===
    const velocityVariation = Math.sin(Date.now() / 20000000) * 0.5; // very small drift
    const effectiveVelocity = PROBE_VELOCITY + velocityVariation;

    const receivedFreq = SIGNAL_FREQUENCY * (1 - effectiveVelocity / LIGHT_SPEED);
    const deltaF = receivedFreq - SIGNAL_FREQUENCY;

    // === BASELINE COMPARISON ===
    const baseDoppler = SIGNAL_FREQUENCY * (1 - PROBE_VELOCITY / LIGHT_SPEED);
    const dopplerDelta = Math.abs(receivedFreq - baseDoppler);

    // === ANOMALY LOGIC (STRICT) ===
    const anomaly = (qsl > 0.85 && dopplerDelta > 5e4)
        ? "⚠️ Signal Disruption Detected"
        : "✅ Signal Stable";

    // === OUTPUT ===
    const dataHTML = `
        📡 <strong>Distance:</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        💠 <strong>QSL:</strong> ${qsl.toFixed(6)} <br>
        🧿 <strong>QSU:</strong> ${qsu.toFixed(6)} <br>
        📈 <strong>Received Frequency:</strong> ${receivedFreq.toFixed(2)} Hz <br>
        📊 <strong>Doppler Shift Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
    `;

    document.getElementById("deep-space-data").innerHTML = dataHTML;
}


// === INIT ===
fetchDSNData();
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);

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
