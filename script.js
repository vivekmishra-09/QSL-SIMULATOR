/*
 * Quantum Signal Loss (QSL) Simulator - Real Voyager Integrated
 * Core logic by Vivek Mishra (unchanged)
 */

// === CONSTANTS ===
const LIGHT_SPEED = 299792.458; // km/s
const EARTH_MARS_AVG_DISTANCE = 225000000;
const MARS_ATMOSPHERIC_LOSS = 0.04;
const MARS_VELOCITY = 24;
const PROBE_VELOCITY = 15;
const SIGNAL_FREQUENCY = 8.4e9;

// === BASE QSL PARAMETER ===
const BASE_LAMBDA = 3.6e-7;

// === REAL DATA STORAGE ===
let REAL_DISTANCE = null;

// === FETCH REAL VOYAGER DATA (Vercel API) ===
async function updateVoyagerDistance() {
    try {
        const res = await fetch("/api/voyager");
        const data = await res.json();

        if (data.distance) {
            REAL_DISTANCE = data.distance;
        }
    } catch (err) {
        console.warn("Voyager fetch failed, fallback active");
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

// === FALLBACK PROBE MODEL (only if API fails) ===
function getFallbackDistance() {
    const baseDistance = 2.47e10;
    const velocity = 17;
    const baseTime = 1700000000000;
    const t = (Date.now() - baseTime) / 1000;

    let distance = baseDistance + (velocity * t);
    let perturb = Math.abs(Math.sin(t / 50000)) * 5e5;

    return distance + perturb;
}

// === FINAL DISTANCE FUNCTION ===
function getRealProbeDistance() {
    if (REAL_DISTANCE) return REAL_DISTANCE;
    return getFallbackDistance();
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

// === DEEP SPACE FUNCTION (REAL DATA) ===
function deepSpaceProbeData() {

    let distance = getRealProbeDistance();
    let signalDelay = distance / LIGHT_SPEED;
    let signalTime = signalDelay.toFixed(6);

    let interference = getControlledNoise();
    let lambda = computeLambda(distance, interference);

    let qsl = 1 - Math.exp(-lambda * signalDelay);
    let qsu = Math.exp(-lambda * signalDelay);

    const velocityVariation = Math.sin(Date.now() / 20000000) * 0.5;
    const effectiveVelocity = PROBE_VELOCITY + velocityVariation;

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
    `;
}

// === INIT ===
setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);
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
