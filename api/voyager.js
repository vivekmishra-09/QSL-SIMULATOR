export default async function handler(req, res) {
    try {
        const now = new Date().toISOString();

        const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='-32'&EPHEM_TYPE=OBSERVER&CENTER='500@399'&START_TIME='${now}'&STOP_TIME='${now}'&STEP_SIZE='1 m'&QUANTITIES='20'`;

        const response = await fetch(url);
        const data = await response.json();

        const text = data.result;

        // extract distance properly
        const match = text.match(/(\d+\.\d+E\+\d+)/);

        if (match) {
            const distance = parseFloat(match[0]);
            return res.status(200).json({ distance });
        }

        return res.status(500).json({ error: "Parse failed" });

    } catch (err) {
        return res.status(500).json({ error: "Fetch failed" });
    }
}
