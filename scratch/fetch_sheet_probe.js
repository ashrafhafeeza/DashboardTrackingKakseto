const https = require('https');
const fs = require('fs');

const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';

const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const years = [2023, 2024, 2025, 2026];

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
                    console.log(`Found valid sheet: ${sheetName}`);
                    
                    let output = `Sheet: ${sheetName}\n\n`;
                    const rows = json.table.rows;
                    rows.forEach((r, idx) => {
                        if (!r.c) return;
                        const rowVals = r.c.map(cell => cell ? cell.v : null);
                        // Dump all rows to see everything
                        output += `Row ${idx}: ${JSON.stringify(rowVals)}\n`;
                    });
                    
                    fs.writeFileSync(`scratch/sheet_dump_${sheetName.replace(' ', '_')}.txt`, output);
                    console.log(`Dumped to scratch/sheet_dump_${sheetName.replace(' ', '_')}.txt`);
                    // Stop once we find one!
                    return;
                }
            }
            // Try next
            fetchNextSheet();
        });
    }).on('error', (e) => {
        console.error(e);
        fetchNextSheet();
    });
}

fetchNextSheet();
