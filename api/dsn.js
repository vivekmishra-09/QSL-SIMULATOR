/*
 * api/dsn.js — NASA Deep Space Network Real-Time Telemetry Proxy
 * Source: https://eyes.nasa.gov/dsn/data/dsn.json  [Paper Ref 1]
 *
 * This route proxies the NASA DSN JSON feed to avoid CORS restrictions.
 * The DSN JSON updates every ~5 seconds with live spacecraft data.
 */

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=5, stale-while-revalidate=5");

    try {
        const response = await fetch(
            "https://eyes.nasa.gov/dsn/data/dsn.json?r=" + Date.now(),
            {
                headers: {
                    "User-Agent": "QSL-Simulator/1.0 (research; " +
                                  "doi:10.5281/zenodo.16919283)"
                }
            }
        );

        if (!response.ok) {
            throw new Error(`NASA DSN returned HTTP ${response.status}`);
        }

        const text = await response.text();

        // DSN JSON is sometimes malformed — wrap safely
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            // DSN uses a non-standard quasi-JSON — try eval-safe parse
            data = JSON.parse(text.replace(/'/g, '"'));
        }

        return res.status(200).json({
            source:    "NASA DSN Real-Time Feed (eyes.nasa.gov)",
            timestamp: new Date().toISOString(),
            dsn:       data
        });

    } catch (err) {
        console.error("DSN fetch error:", err.message);
        return res.status(502).json({
            error:   "NASA DSN feed unavailable",
            details: err.message
        });
    }
}
