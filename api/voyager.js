export default async function handler(req, res) {
    try {
        const response = await fetch(
            "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND='-32'&EPHEM_TYPE=VECTORS&CENTER='500@0'"
        );

        const text = await response.text();

        // locate $$SOE (start of data)
        const start = text.indexOf("$$SOE");
        const end = text.indexOf("$$EOE");

        if (start === -1 || end === -1) {
            return res.status(500).json({ error: "Data block not found" });
        }

        const dataBlock = text.substring(start, end);

        const lines = dataBlock.split("\n");

        // first data line contains X Y Z
        for (let line of lines) {
            if (line.trim().startsWith("20")) { // time line
                const parts = line.trim().split(/\s+/);

                // X coordinate usually 2nd or 3rd value
                let x = parseFloat(parts[2]);

                if (!isNaN(x)) {
                    const distanceAU = Math.abs(x);
                    const distanceKM = distanceAU * 149597870;

                    return res.status(200).json({ distance: distanceKM });
                }
            }
        }

        return res.status(500).json({ error: "Parse failed" });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
