/*
 * Quantum Signal Loss (QSL) Simulator
 * Copyright (c) 2025 Vivek Mishra - All Rights Reserved
 * Unauthorized copying, modification, distribution, or use of this code,
 * in whole or in part, is strictly prohibited.
 * For permissions, contact: [vivekmishra.space@gmail.com]
 */
// === CONSTANTS ===
const LIGHT_SPEED = 299792.458; // km/s
const EARTH_MARS_AVG_DISTANCE = 225000000; // km
const MARS_ATMOSPHERIC_LOSS = 0.04;
const EARTH_TO_PROBE_DISTANCE = 9140000000; // km
const MARS_VELOCITY = 24; // km/s (approx)
const PROBE_VELOCITY = 15; // km/s (deep space probe)
const SIGNAL_FREQUENCY = 8.4e9; // Hz

// === QSL PARAMETERS ===
const QSL_LAMBDA = 0.25; // Quantum Signal Loss decay sensitivity

// === MARS ORBITER FUNCTION ===
function getMarsOrbiterData() {
    // Simulate orbit-induced distance fluctuation
    let distance = EARTH_MARS_AVG_DISTANCE + (Math.sin(Date.now() / 5000000) * 5000000);

    let signalTime = (distance / LIGHT_SPEED).toFixed(6); // seconds

    // Random signal noise (simulated)
    let rawInterference = Math.random() * 10;
    let interference = rawInterference.toFixed(2);

    // Atmospheric signal degradation model
    let signalStrength = (100 - (distance * MARS_ATMOSPHERIC_LOSS / 10000000)).toFixed(2);

    // Doppler effect (receiver is moving away, redshift)
    let dopplerShift = SIGNAL_FREQUENCY * ((LIGHT_SPEED - MARS_VELOCITY) / LIGHT_SPEED);

    // Status condition
    let anomaly = (rawInterference > 8.0) ? "⚠️ UNKNOWN SIGNAL DETECTED" : "✅ Normal Transmission";

    // UI Update
    let dataHTML = `
        🛰️ <strong>Distance:</strong> ${distance.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        📶 <strong>Signal Strength:</strong> ${signalStrength} % <br>
        📡 <strong>Interference:</strong> ${interference} dB <br>
        📈 <strong>Doppler Shift:</strong> ${dopplerShift.toFixed(2)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
    `;
    document.getElementById("mars-data").innerHTML = dataHTML;
}

// === DEEP SPACE FUNCTION ===
function deepSpaceProbeData() {
    const signalDelay = EARTH_TO_PROBE_DISTANCE / LIGHT_SPEED;
    const signalTime = signalDelay.toFixed(6);

    // Quantum Signal Loss Calculation
    const interference = Math.random() * 8 + 2; // 2 to 10 dB simulated noise
    const distance = EARTH_TO_PROBE_DISTANCE * 1e3; // km to meters
    const delay = distance / 299792458; // in seconds

    const gravity_factor = 1 / Math.sqrt(1 + distance / 1e12); 
    const lambda = QSL_LAMBDA * Math.abs(Math.sin(Date.now() / 1e6)) * gravity_factor;

    const decoherenceDelta = (signalDelay * interference) / 4000;
    const qsl = 1 - Math.exp(-lambda * decoherenceDelta);  // QSL ∈ [0, 1]
    const qsu = 1 - qsl;  // QSU = Quantum Signal Utility
    const qslHTML = `<div class="qsl-highlight">💠 <strong>QSL (Quantum Signal Loss):</strong> ${qsl.toFixed(6)}</div>`;

    // Doppler Calculation (received frequency)
    const dynamicVelocity = PROBE_VELOCITY + Math.sin(Date.now() / 10000000) * 2; // km/s
    const receivedFreq = SIGNAL_FREQUENCY * (1 - dynamicVelocity / LIGHT_SPEED); // Hz

    // Real Doppler shift Δf
    const deltaF = receivedFreq - SIGNAL_FREQUENCY; // Hz (negative for receding)

    // Anomaly Detection
    const baseDoppler = SIGNAL_FREQUENCY * (1 - PROBE_VELOCITY / LIGHT_SPEED);
    const dopplerDelta = Math.abs(receivedFreq - baseDoppler);

    const anomaly = (qsl > 0.85 && dopplerDelta > 1e8)
        ? "⚠️ Signal Disruption Detected"
        : "✅ Signal Stable";

    // Output UI
    const dataHTML = `
        📡 <strong>Distance:</strong> ${EARTH_TO_PROBE_DISTANCE.toFixed(2)} km <br>
        ⏳ <strong>Signal Delay:</strong> ${signalTime} sec <br>
        ${qslHTML}<br>
        🧿 <strong>QSU (Quantum Signal Utility):</strong> ${qsu.toFixed(6)} <br>
        📈 <strong>Received Frequency:</strong> ${receivedFreq.toFixed(2)} Hz <br>
        📊 <strong>Doppler Shift Δf:</strong> ${deltaF.toFixed(0)} Hz <br>
        🕒 <strong>Last Updated:</strong> ${new Date().toUTCString()}<br>
        🔵 <strong>Status:</strong> ${anomaly}
    `;
    document.getElementById("deep-space-data").innerHTML = dataHTML;
}

setInterval(getMarsOrbiterData, 5000);
setInterval(deepSpaceProbeData, 15000);


// THEME
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




