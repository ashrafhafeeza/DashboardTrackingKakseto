const https = require('https');
const fs = require('fs');

const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';
const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1`;

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
                
                // Collect row values
                const rowVals = [];
                let hasData20Plus = false;
                for (let i = 0; i < c.length; i++) {
                    const val = c[i] ? c[i].v : null;
                    rowVals.push(val);
                    if (i >= 20 && val !== null && val !== '') hasData20Plus = true;
                }
                
                if (hasData20Plus || rowVals.join('').includes('HOMESCHOOLING') || rowVals.join('').includes('KAK SETO')) {
                    output += `Row ${idx}: ${JSON.stringify(rowVals)}\n`;
                }
            });
            
            fs.writeFileSync('scratch/sheet_dump.txt', output);
            console.log('Dumped to scratch/sheet_dump.txt');
        }
    });
});
