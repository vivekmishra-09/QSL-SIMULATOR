// api/voyager.js — Real NASA JPL Horizons API integration
// Fetches LIVE distance, velocity, light-time for Voyager 1, Voyager 2, New Horizons
// NAIF IDs: Voyager 1 = -31 | Voyager 2 = -32 | New Horizons = -98
// CENTER=500@10 = Sun (heliocentric) | EPHEM_TYPE=VECTORS | VEC_TABLE=3 = LT, RG, RR

const HORIZONS_BASE = "https://ssd.jpl.nasa.gov/api/horizons.api";
const AU_TO_KM = 149597870.7;

function getDateStr(offsetDays = 0) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offsetDays);
    const months = ["Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${d.getUTCFullYear()}-${months[d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

// Parse Horizons VECTOR table text — extracts LT (light-time s), RG (range km), RR (range-rate km/s)
function parseHorizons(resultText) {
    const soe = resultText.indexOf("$$SOE");
    const eoe = resultText.indexOf("$$EOE");
    if (soe === -1 || eoe === -1) return null;

    const block = resultText.slice(soe + 5, eoe).trim();
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    // Second line has the LT= RG= RR= values
    const valLine = lines[1];
    const lt = valLine.match(/LT=\s*([\d.E+\-]+)/i);
    const rg = valLine.match(/RG=\s*([\d.E+\-]+)/i);
    const rr = valLine.match(/RR=\s*([\d.E+\-]+)/i);

    if (!rg) return null;
    return {
        distance_km:    parseFloat(rg[1]),
        light_time_sec: lt ? parseFloat(lt[1]) : null,
        velocity_km_s:  rr ? parseFloat(rr[1]) : null
    };
}

async function fetchProbe(naifId, start, stop) {
    const params = new URLSearchParams({
        format:     "json",
        COMMAND:    String(naifId),
        OBJ_DATA:   "NO",
        MAKE_EPHEM: "YES",
        EPHEM_TYPE: "VECTORS",
        VEC_TABLE:  "3",       // LT, RG, RR output
        CENTER:     "500@10",  // Heliocentric (Sun as origin)
        START_TIME: start,
        STOP_TIME:  stop,
        STEP_SIZE:  "1d",
        VEC_LABELS: "YES",
        CSV_FORMAT: "NO"
    });

    const res = await fetch(`${HORIZONS_BASE}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for NAIF ${naifId}`);

    const json = await res.json();
    if (!json.result) throw new Error(`No result for NAIF ${naifId}`);

    const data = parseHorizons(json.result);
    if (!data) throw new Error(`Parse failed for NAIF ${naifId}`);
    return data;
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=600");

    const today    = getDateStr(0);
    const tomorrow = getDateStr(1);

    try {
        // All 3 probes fetched in parallel from real NASA JPL Horizons
        const [v1, v2, nh] = await Promise.all([
            fetchProbe(-31, today, tomorrow),   // Voyager 1
            fetchProbe(-32, today, tomorrow),   // Voyager 2
            fetchProbe(-98, today, tomorrow),   // New Horizons
        ]);

        res.status(200).json({
            source:    "NASA JPL Horizons API — Real Ephemeris Data",
            timestamp: new Date().toISOString(),
            probes: {
                voyager1: {
                    naif_id:        -31,
                    name:           "Voyager 1",
                    distance_km:    v1.distance_km,
                    distance_au:    +(v1.distance_km / AU_TO_KM).toFixed(6),
                    light_time_sec: v1.light_time_sec,
                    velocity_km_s:  v1.velocity_km_s
                },
                voyager2: {
                    naif_id:        -32,
                    name:           "Voyager 2",
                    distance_km:    v2.distance_km,
                    distance_au:    +(v2.distance_km / AU_TO_KM).toFixed(6),
                    light_time_sec: v2.light_time_sec,
                    velocity_km_s:  v2.velocity_km_s
                },
                new_horizons: {
                    naif_id:        -98,
                    name:           "New Horizons",
                    distance_km:    nh.distance_km,
                    distance_au:    +(nh.distance_km / AU_TO_KM).toFixed(6),
                    light_time_sec: nh.light_time_sec,
                    velocity_km_s:  nh.velocity_km_s
                }
            }
        });

    } catch (err) {
        console.error("Horizons fetch error:", err.message);
        res.status(500).json({
            error:   "NASA JPL Horizons fetch failed",
            details: err.message
        });
    }
}
