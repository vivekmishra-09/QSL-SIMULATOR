export default async function handler(req, res) {
    try {
        // Voyager approx current distance (2026)
        const baseDistance = 2.4e10; // 24 billion km

        // speed ~17 km/s
        const velocity = 17;

        // fixed start time (2024 approx)
        const baseTime = 1700000000000;

        const t = (Date.now() - baseTime) / 1000;

        // real continuous motion
        const distance = baseDistance + (velocity * t);

        return res.status(200).json({ distance });

    } catch (err) {
        return res.status(500).json({ error: "Failed" });
    }
}
