const https = require('https');
const fs = require('fs');

const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';
const sheetName = 'Januari 2024'; // Let's try 2024 since we didn't find Murid in Jan 2023. Wait, we found Jan 2023 but it had no Murid.
const months = ['Agustus', 'September', 'Oktober', 'Januari', 'Februari', 'Juli'];
const years = [2024, 2025, 2026];

const sheetNamesToTry = [];
years.forEach(y => {
    months.forEach(m => {
        sheetNamesToTry.push(`${m} ${y}`);
    });
});

let currentIndex = 0;

function fetchNextSheet() {
    if (currentIndex >= sheetNamesToTry.length) {
        console.log('Tried all sheets.');
        return;
    }
    
    const sheetName = sheetNamesToTry[currentIndex++];
    console.log('Trying', sheetName);
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
                if (json.status === 'ok' && json.table && json.table.rows.length > 0) {
                    const rows = json.table.rows;
                    let hasMurid = false;
                    for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        if (r.c) {
                            const txt = r.c.map(cell => cell ? String(cell.v).toUpperCase() : '').join(' ');
                            if (txt.includes('HOMESCHOOLING') || txt.includes('KAK SETO SCHOOL')) {
                                hasMurid = true;
                                break;
                            }
                        }
                    }

                    if (hasMurid) {
                        console.log(`Found valid Murid sheet: ${sheetName}`);
                        
                        let output = `Sheet: ${sheetName}\n\n`;
                        rows.forEach((r, idx) => {
                            if (!r.c) return;
                            const rowVals = r.c.map(cell => cell ? cell.v : null);
                            // only print rows that have data after col 19
                            if (rowVals.length > 20 && rowVals.slice(20).some(v => v !== null && v !== '')) {
                                output += `Row ${idx}: ${JSON.stringify(rowVals)}\n`;
                            }
                        });
                        
                        fs.writeFileSync(`scratch/sheet_dump_murid2.txt`, output);
                        console.log(`Dumped to scratch/sheet_dump_murid2.txt`);
                        return; // stop
                    }
                }
            }
            fetchNextSheet();
        });
    }).on('error', (e) => {
        console.error(e);
        fetchNextSheet();
    });
}

fetchNextSheet();
