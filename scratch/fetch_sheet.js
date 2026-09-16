const https = require('https');

const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';
const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        // gviz returns a string like: /*O_o*/\ngoogle.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","sig":"...", "table": ...});
        const match = data.match(/google\.visualization\.Query\.setResponse\((.*)\);/);
        if (match) {
            const json = JSON.parse(match[1]);
            const rows = json.table.rows;
            // Let's print out rows where columns 20+ have data, to see the headers and data.
            for (let i = 0; i < 40; i++) {
                if (!rows[i]) continue;
                const rowData = rows[i].c.map((cell, idx) => {
                    if (idx < 20) return null; // skip early columns
                    return cell ? cell.v : null;
                }).filter((v, idx) => v !== null || idx < 10); // Keep some context
                console.log(`Row ${i}:`, rowData);
            }
            
            // Also let's find all headers mentioning "KAK SETO" or "HOMESCHOOLING"
            rows.forEach((r, idx) => {
                const c = r.c;
                if (!c) return;
                c.forEach((cell, cIdx) => {
                    if (cell && typeof cell.v === 'string') {
                        if (cell.v.toUpperCase().includes('KAK SETO') || cell.v.toUpperCase().includes('HOMESCHOOLING')) {
                            console.log(`Found "${cell.v}" at Row ${idx}, Col ${cIdx}`);
                        }
                    }
                });
            });
        }
    });
});
