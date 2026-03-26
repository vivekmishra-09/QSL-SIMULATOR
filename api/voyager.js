
export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='-32'&CENTER='500@399'&MAKE_EPHEM='YES'&EPHEM_TYPE='OBSERVER'&QUANTITIES='20'"
        );

        const data = await response.json();

        const text = data.result;

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
