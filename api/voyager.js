export default async function handler(req, res) {
    try {
        const now = new Date().toISOString();

        const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='-32'&EPHEM_TYPE=OBSERVER&CENTER='500@399'&START_TIME='${now}'&STOP_TIME='${now}'&STEP_SIZE='1 m'&QUANTITIES='20'`;

        const response = await fetch(url);
        const text = await response.text();

        // split lines
        const lines = text.split("\n");

        let distance = null;

        for (let line of lines) {
            // look for line with AU distance
            if (line.includes("AU")) {
                const match = line.match(/([0-9]+\.[0-9]+)/);
                if (match) {
                    const distanceAU = parseFloat(match[1]);

                    // convert AU → KM
                    distance = distanceAU * 149597870;
                    break;
                }
            }
        }

        if (distance) {
            return res.status(200).json({ distance });
        }

        return res.status(500).json({ error: "Parse failed" });

    } catch (err) {
        return res.status(500).json({ error: "Fetch failed" });
    }
}
