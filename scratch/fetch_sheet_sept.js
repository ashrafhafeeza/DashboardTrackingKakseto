const https = require('https');
const fs = require('fs');

const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';
const sheetName = 'September 2026'; // also try others if this fails
const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        const match = data.match(/google\.visualization\.Query\.setResponse\((.*)\);/);
        if (match) {
            const json = JSON.parse(match[1]);
            const rows = json.table.rows;
            const cols = json.table.cols;
            
            let output = 'Cols:\n';
            cols.forEach((c, idx) => {
                if (c && c.label) output += `Col ${idx}: ${c.label}\n`;
            });
            
            output += '\nRows:\n';
            rows.forEach((r, idx) => {
                const c = r.c;
                if (!c) return;
                
                const rowVals = c.map(cell => cell ? cell.v : null);
                // Dump rows that have any data after column 15 to see where the tables are
                const hasDataAfter15 = rowVals.slice(15).some(v => v !== null && v !== '');
                if (hasDataAfter15) {
                    output += `Row ${idx}: ${JSON.stringify(rowVals)}\n`;
                }
            });
            
            fs.writeFileSync('scratch/sheet_dump_sept2026.txt', output);
            console.log('Dumped to scratch/sheet_dump_sept2026.txt');
        } else {
            console.log('No valid JSONP found. Response:', data.substring(0, 100));
        }
    });
});
