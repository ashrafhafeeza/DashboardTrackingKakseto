/**
 * Dashboard Tracking CS SKS - Core Logic Engine
 * Sekolah Kak Seto
 *
 * Features:
 * - Dynamic multi-sheet fetching from Google Sheets (GViz JSONP)
 * - Auto-discovery for months (Juni, Juli, Agustus, September, etc.)
 * - Robust date normalization (Google GViz Date, DD/MM/YYYY, YYYY-MM-DD, D MMMM YYYY)
 * - Dynamic data parsing for Leads, CMB, and Murid without hardcoded row/column indexes
 * - Multi-level filtering (Month, Year, CS/Unit/Sumber)
 * - Real-time sync status feedback & auto-refresh
 * - Responsive chart & table rendering
 */

(function () {
  'use strict';

  // --- CONFIGURATION ---
  const SPREADSHEET_ID = '1QoN0mdOEU_E3oxbMkaSI_D6zSwyWRPhsaQj0tLMO8bQ';
  const AUTO_REFRESH_INTERVAL_MS = 180000; // 3 minutes

  const MONTH_NAMES = {
    '01': 'Januari', '02': 'Februari', '03': 'Maret', '04': 'April',
    '05': 'Mei', '06': 'Juni', '07': 'Juli', '08': 'Agustus',
    '09': 'September', '10': 'Oktober', '11': 'November', '12': 'Desember'
  };

  const INDO_MONTH_MAP = {
    'januari': '01', 'jan': '01', 'january': '01',
    'februari': '02', 'feb': '02', 'february': '02',
    'maret': '03', 'mar': '03', 'march': '03',
    'april': '04', 'apr': '04',
    'mei': '05', 'may': '05',
    'juni': '06', 'jun': '06', 'june': '06',
    'juli': '07', 'jul': '07', 'july': '07',
    'agustus': '08', 'ags': '08', 'agu': '08', 'aug': '08', 'august': '08',
    'september': '09', 'sep': '09', 'sept': '09',
    'oktober': '10', 'okt': '10', 'oct': '10', 'october': '10',
    'november': '11', 'nov': '11',
    'desember': '12', 'des': '12', 'dec': '12', 'december': '12'
  };

  // --- APPLICATION STATE ---
  let discoveredSheets = []; // Array of { sheetName, month, year, rows, cols, sig }
  let parsedLeadsData = [];  // Array of parsed daily leads
  let parsedCMBData = [];    // Array of parsed CMB rows
  let parsedMuridData = [];  // Array of parsed Murid sections per sheet
  let availableYears = new Set();
  let currentTab = 'report_leads';
  let chartInstance = null;
  let isFetching = false;
  let lastSyncTime = null;

  // --- INITIALIZATION ---
  document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    fetchData();
    setInterval(fetchData, AUTO_REFRESH_INTERVAL_MS);
  });

  function setupEventListeners() {
    // Tab switching
    document.getElementById('tab-report_leads')?.addEventListener('click', () => switchTab('report_leads'));
    document.getElementById('tab-rekap_cmb')?.addEventListener('click', () => switchTab('rekap_cmb'));
    document.getElementById('tab-rekap_murid')?.addEventListener('click', () => switchTab('rekap_murid'));

    // Filter changes
    document.getElementById('monthFilter')?.addEventListener('change', onFilterChange);
    document.getElementById('yearFilter')?.addEventListener('change', onFilterChange);
    document.getElementById('csFilter')?.addEventListener('change', renderCurrentMenu);

    // Sync button
    document.getElementById('syncBtn')?.addEventListener('click', () => {
      if (!isFetching) fetchData();
    });
  }

  function onFilterChange() {
    renderCurrentMenu();
  }

  // --- DATA FETCHING ENGINE (MULTI-SHEET PROBING) ---
  async function fetchData() {
    if (isFetching) return;
    isFetching = true;

    setSyncStatus('loading', 'Memuat seluruh data dari Google Sheets...');
    const syncBtn = document.getElementById('syncBtn');
    if (syncBtn) syncBtn.classList.add('loading');

    try {
      // Step 1: Probe default sheet to establish fallback signature
      const defaultRes = await fetchSingleSheet('Sheet1');
      const fallbackSig = defaultRes?.sig || null;

      // Step 2: Generate candidate month-year sheets
      const currentYear = new Date().getFullYear();
      const yearsToProbe = [currentYear - 1, currentYear, currentYear + 1];
      const candidateNames = [];

      for (const y of yearsToProbe) {
        for (const mKey of Object.keys(MONTH_NAMES)) {
          candidateNames.push(`${MONTH_NAMES[mKey]} ${y}`);
        }
      }

      // Step 3: Fetch all candidate sheets in parallel
      const probePromises = candidateNames.map(name => fetchSingleSheet(name));
      const probeResults = await Promise.all(probePromises);

      // Step 4: Filter valid sheets (exclude non-existent sheets that return fallback signature)
      const validSheets = [];
      probeResults.forEach(res => {
        if (res && res.status === 'ok' && res.rows && res.rows.length > 0) {
          const isFallback = (fallbackSig && res.sig === fallbackSig);
          if (!isFallback) {
            // Determine month and year from sheet name
            const parts = res.sheetName.split(' ');
            const mName = parts[0]?.toLowerCase();
            const mCode = INDO_MONTH_MAP[mName] || 'ALL';
            const yCode = parts[1] || 'ALL';

            validSheets.push({
              sheetName: res.sheetName,
              month: mCode,
              year: yCode,
              rows: res.rows,
              cols: res.cols,
              sig: res.sig
            });
          }
        }
      });

      // If no month sheets discovered via probe, include default sheet
      if (validSheets.length === 0 && defaultRes && defaultRes.rows) {
        validSheets.push({
          sheetName: 'Sheet1',
          month: 'ALL',
          year: String(currentYear),
          rows: defaultRes.rows,
          cols: defaultRes.cols,
          sig: defaultRes.sig
        });
      }

      discoveredSheets = validSheets;

      // Step 5: Parse and process all datasets
      processAllSheetsData();

      // Step 6: Update UI states
      lastSyncTime = new Date();
      const timeStr = lastSyncTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setSyncStatus('success', `Data berhasil diperbarui (${validSheets.length} Sheet terbaca)`, timeStr);

      updateSheetCountBadge();
      updateYearFilterDropdown();
      renderCurrentMenu();

    } catch (err) {
      console.error('Error fetching Google Sheets data:', err);
      setSyncStatus('error', `Gagal mengambil data: ${err.message || 'Koneksi bermasalah'}`);
      if (parsedLeadsData.length === 0) {
        renderErrorState(err.message);
      }
    } finally {
      isFetching = false;
      if (syncBtn) syncBtn.classList.remove('loading');
    }
  }

  // Helper JSONP request for a single sheet tab
  function fetchSingleSheet(sheetName) {
    return new Promise((resolve) => {
      const callbackName = 'gviz_callback_' + Math.random().toString(36).substring(2, 9);
      const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json;responseHandler:${callbackName}&sheet=${encodeURIComponent(sheetName)}`;

      const script = document.createElement('script');
      script.src = url;

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 10000);

      function cleanup() {
        clearTimeout(timeoutId);
        delete window[callbackName];
        if (script.parentNode) script.remove();
      }

      window[callbackName] = (json) => {
        cleanup();
        if (json && json.status === 'ok' && json.table) {
          resolve({
            sheetName,
            status: 'ok',
            sig: json.sig,
            rows: json.table.rows || [],
            cols: json.table.cols || []
          });
        } else {
          resolve(null);
        }
      };

      script.onerror = () => {
        cleanup();
        resolve(null);
      };

      document.head.appendChild(script);
    });
  }

  // --- DATA PROCESSING & PARSING ---
  function processAllSheetsData() {
    parsedLeadsData = [];
    parsedCMBData = [];
    parsedMuridData = [];
    availableYears.clear();

    discoveredSheets.forEach(sheet => {
      parseLeadsFromSheet(sheet);
      parseCMBFromSheet(sheet);
      parseMuridFromSheet(sheet);
    });
  }

  // 1. Leads Parser
  function parseLeadsFromSheet(sheet) {
    let currentDateObj = null;

    sheet.rows.forEach(r => {
      const c = r.c || [];
      if (!c || c.length < 2) return;

      // Extract and update date when column A is present
      if (c[0] && (c[0].f || c[0].v)) {
        const rawDate = c[0].f || c[0].v;
        const norm = normalizeDate(rawDate, c[0].f, sheet);
        if (norm) currentDateObj = norm;
      }

      const csName = c[1] && c[1].v ? String(c[1].v).trim() : '';

      // Validate that this is a valid CS row (starts with "Kak " or valid person name, not summary)
      if (csName && !['total', 'jumlah', 'nama cs', '-'].includes(csName.toLowerCase())) {
        const dateObj = currentDateObj || {
          raw: sheet.sheetName,
          year: sheet.year,
          month: sheet.month,
          monthName: MONTH_NAMES[sheet.month] || '',
          day: 1,
          display: sheet.sheetName
        };

        if (dateObj.year && dateObj.year !== 'ALL') {
          availableYears.add(dateObj.year);
        }

        parsedLeadsData.push({
          sheetName: sheet.sheetName,
          dateObj: dateObj,
          tanggal: dateObj.display,
          namaCS: csName,
          newLeads: parseCellNum(c[2]),       // Col C
          existingLeads: parseCellNum(c[3]),  // Col D
          totalLeads: parseCellNum(c[4]),     // Col E
          callIn: parseCellNum(c[5]),         // Col F
          potensial: parseCellNum(c[6]),      // Col G
          closingForm: parseCellNum(c[7]),    // Col H
          tidakPotensial: parseCellNum(c[8]), // Col I
          kuotaFull: parseCellNum(c[9]),      // Col J
          closingUP: parseCellNum(c[10]),     // Col K
          catatan: c[12]?.v ? String(c[12].v).trim() : ''
        });
      }
    });
  }

  // 2. CMB Parser
  function parseCMBFromSheet(sheet) {
    const rows = sheet.rows;
    const cols = sheet.cols;

    // Detect column indexes dynamically for this sheet
    let cmbUnitCol = -1;
    let cmbJenjangCol = -1;
    let cmbProgCol = -1;

    // 1. Check col labels
    for (let cIdx = 10; cIdx < Math.min(25, cols.length); cIdx++) {
      const label = String(cols[cIdx]?.label || '').toLowerCase();
      if (label.includes('unit') && cmbUnitCol === -1) cmbUnitCol = cIdx;
      if (label.includes('jenjang') && cmbJenjangCol === -1) cmbJenjangCol = cIdx;
      if (label.includes('program') && cmbProgCol === -1) cmbProgCol = cIdx;
    }

    // 2. Scan top 10 rows for "Unit", "Jenjang", "Program" headers
    if (cmbUnitCol === -1 || cmbProgCol === -1) {
      for (let rIdx = 0; rIdx < Math.min(10, rows.length); rIdx++) {
        const c = rows[rIdx]?.c || [];
        c.forEach((cell, cIdx) => {
          if (cIdx >= 10 && cIdx <= 25 && cell && cell.v) {
            const v = String(cell.v).toLowerCase().trim();
            if (v === 'unit' && cmbUnitCol === -1) cmbUnitCol = cIdx;
            if (v === 'jenjang' && cmbJenjangCol === -1) cmbJenjangCol = cIdx;
            if (v === 'program' && cmbProgCol === -1) cmbProgCol = cIdx;
          }
        });
      }
    }

    // 3. Fallback: look for known unit keywords
    if (cmbUnitCol === -1) {
      for (let rIdx = 0; rIdx < Math.min(15, rows.length); rIdx++) {
        const c = rows[rIdx]?.c || [];
        for (let cIdx = 10; cIdx <= 20; cIdx++) {
          const v = String(c[cIdx]?.v || '').toUpperCase().trim();
          if (['HSKS', 'KSS', 'SKKS', 'KSLC'].includes(v)) {
            cmbUnitCol = cIdx;
            cmbJenjangCol = cIdx + 1;
            cmbProgCol = cIdx + 2;
            break;
          }
        }
        if (cmbUnitCol !== -1) break;
      }
    }

    if (cmbUnitCol === -1) cmbUnitCol = 14;
    if (cmbJenjangCol === -1) cmbJenjangCol = cmbUnitCol + 1;
    if (cmbProgCol === -1) cmbProgCol = cmbUnitCol + 2;

    const colClosingForm = cmbProgCol + 1;
    const colUPProses = cmbProgCol + 2;
    const colUPSelesai = cmbProgCol + 3;
    const colCancel = cmbProgCol + 4;
    const colOnProgressOld = cmbProgCol + 5;
    const colKetOnProgress = cmbProgCol + 6;

    let currentUnit = '';
    let currentJenjang = '';

    rows.forEach((r, rIdx) => {
      const c = r.c || [];
      if (!c) return;

      if (c[cmbUnitCol]?.v) {
        const u = String(c[cmbUnitCol].v).trim();
        if (u && !['unit', 'total', 'jumlah', 'closing formulir', 'cancel pendaftaran', 'formulir', 'cancel', 'lanjut up', 'up finish', 'up proses', 'non up proses'].includes(u.toLowerCase())) {
          currentUnit = u;
        }
      }

      if (c[cmbJenjangCol]?.v) {
        const j = String(c[cmbJenjangCol].v).trim();
        if (j && !['jenjang', 'total', 'jumlah', 'closing formulir', 'cancel pendaftaran', 'formulir', 'cancel', 'lanjut up', 'up finish', 'up proses', 'non up proses'].includes(j.toLowerCase())) {
          currentJenjang = j;
        }
      }

      if (c[cmbProgCol]?.v) {
        const prog = String(c[cmbProgCol].v).trim();
        const lowerProg = prog.toLowerCase();

        // ABAIKAN baris header, total, jumlah, atau subtotal ringkasan bawaan sheet agar tidak double
        if (prog &&
          !['program', 'jumlah', 'total', 'cancel pendaftaran', 'subtotal', 'rekap'].includes(lowerProg) &&
          !lowerProg.startsWith('jumlah') &&
          !lowerProg.startsWith('total') &&
          isNaN(Number(prog))) {

          const closingForm = parseCellNum(c[colClosingForm]);
          const upProses = parseCellNum(c[colUPProses]);
          const upSelesai = parseCellNum(c[colUPSelesai]);
          const cancel = parseCellNum(c[colCancel]);
          const onProgressOld = parseCellNum(c[colOnProgressOld]);
          const ket = c[colKetOnProgress]?.v ? String(c[colKetOnProgress].v).trim() : '';

          // Extract individual candidates from keterangan
          const candidates = [];
          if (ket) {
            ket.split('\n').forEach(line => {
              const trimmed = line.trim();
              if (!trimmed) return;
              let pic = '';
              const picMatch = trimmed.match(/-\s*(Kak\s+[A-Za-z]+)|(Kak\s+[A-Za-z]+)/i);
              if (picMatch) {
                pic = (picMatch[1] || picMatch[2]).trim().replace(/Kak\s+WInda/i, 'Kak Winda');
              }
              candidates.push({
                rawText: trimmed,
                pic: pic || 'Umum'
              });
            });
          }

          parsedCMBData.push({
            sheetName: sheet.sheetName,
            month: sheet.month,
            year: sheet.year,
            unit: currentUnit || 'Umum',
            jenjang: currentJenjang || 'Lainnya',
            program: prog,
            closingForm,
            cancel,
            upProses,
            upSelesai,
            onProgressOld,
            keterangan: ket,
            candidates,
            rowIdx: rIdx
          });
        }
      }
    });
  }

  // 3. Murid Parser
  function parseMuridFromSheet(sheet) {
    const rows = sheet.rows;
    const programList = ['DLP', 'DL', 'DLT', 'INK', 'KOM', 'KOP', 'KOR'];
    const sectionsDef = [
      { sumber: 'Homeschooling Kak Seto', title: 'HOMESCHOOLING KAK SETO', keyword: 'HOMESCHOOLING' },
      { sumber: 'Kak Seto School', title: 'KAK SETO SCHOOL', keyword: 'KAK SETO SCHOOL' }
    ];

    const sheetMuridObj = {
      sheetName: sheet.sheetName,
      month: sheet.month,
      year: sheet.year,
      sections: []
    };

    sectionsDef.forEach(secDef => {
      const secItem = {
        sumber: secDef.sumber,
        title: secDef.title,
        jenjangs: []
      };

      ['SD', 'SMP', 'SMA'].forEach(jenjName => {
        // Find column containing secDef.keyword and jenjName
        let targetCol = -1;
        let headerRow = -1;

        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
          const c = rows[rIdx]?.c || [];
          for (let cIdx = 20; cIdx < c.length; cIdx++) {
            const txt = String(c[cIdx]?.v || '').toUpperCase();
            if (txt.includes(jenjName) && txt.includes(secDef.keyword)) {
              targetCol = cIdx;
              headerRow = rIdx;
              break;
            }
          }
          if (targetCol !== -1) break;
        }

        if (targetCol === -1) return;

        // Find "Kelas" row below headerRow
        let classLabelRow = -1;
        for (let rIdx = headerRow; rIdx < Math.min(headerRow + 15, rows.length); rIdx++) {
          const txt = String(rows[rIdx]?.c?.[targetCol]?.v || '').toLowerCase();
          if (txt.includes('kelas')) {
            classLabelRow = rIdx;
            break;
          }
        }

        if (classLabelRow === -1) return;

        // Extract class rows under targetCol
        const classRows = [];
        const progStartCol = targetCol + 1;

        for (let rIdx = classLabelRow + 1; rIdx < rows.length; rIdx++) {
          const cellVal = String(rows[rIdx]?.c?.[targetCol]?.v || '').trim();
          if (!cellVal) continue;
          if (cellVal.toLowerCase().includes('jumlah') || cellVal.toLowerCase().includes('total')) break;

          const progValues = [];
          programList.forEach((p, pIdx) => {
            const val = parseCellNum(rows[rIdx]?.c?.[progStartCol + pIdx]);
            progValues.push(val);
          });

          classRows.push({
            className: cellVal,
            rowIdx: rIdx,
            progValues: progValues,
            total: progValues.reduce((a, b) => a + b, 0)
          });
        }

        secItem.jenjangs.push({
          name: jenjName,
          targetCol,
          rows: classRows,
          total: classRows.reduce((a, b) => a + b.total, 0)
        });
      });

      sheetMuridObj.sections.push(secItem);
    });

    parsedMuridData.push(sheetMuridObj);
  }

  // --- DATE NORMALIZATION UTILITIES ---
  function normalizeDate(val, formattedVal, sheetContext) {
    if (!val && !formattedVal) return null;
    const raw = String(val || formattedVal).trim();
    const fRaw = String(formattedVal || val).trim();

    // 1. Google Visualization Date(YYYY, M, D) format (M is 0-indexed: 0=Jan, 6=Jul, 7=Aug)
    const gvizMatch = raw.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
    if (gvizMatch) {
      const y = gvizMatch[1];
      const m = parseInt(gvizMatch[2], 10) + 1; // 0-indexed to 1-12
      const d = parseInt(gvizMatch[3], 10);
      const mStr = String(m).padStart(2, '0');
      return {
        raw,
        year: y,
        month: mStr,
        monthName: MONTH_NAMES[mStr] || '',
        day: d,
        display: (fRaw && !fRaw.startsWith('Date(')) ? fRaw : `${d} ${MONTH_NAMES[mStr]} ${y}`
      };
    }

    // 2. Format with Indonesian / English month names e.g. "1 Juli 2026", "24 Agustus 2026"
    const textStr = (fRaw + ' ' + raw).toLowerCase();
    for (const [mName, mNum] of Object.entries(INDO_MONTH_MAP)) {
      const regex = new RegExp(`(\\b\\d{1,2}\\b)[\\s\\-\\/]+${mName}[\\s\\-\\/]+(\\b\\d{4}\\b)`, 'i');
      const mMatch = textStr.match(regex);
      if (mMatch) {
        const d = parseInt(mMatch[1], 10);
        const y = mMatch[2];
        return {
          raw,
          year: y,
          month: mNum,
          monthName: MONTH_NAMES[mNum] || '',
          day: d,
          display: `${d} ${MONTH_NAMES[mNum]} ${y}`
        };
      }
    }

    // 3. DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = raw.match(/(\b\d{1,2}\b)[\/\-](\b\d{1,2}\b)[\/\-](\b\d{4}\b)/);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1], 10);
      const m = String(parseInt(dmyMatch[2], 10)).padStart(2, '0');
      const y = dmyMatch[3];
      return {
        raw,
        year: y,
        month: m,
        monthName: MONTH_NAMES[m] || '',
        day: d,
        display: `${d} ${MONTH_NAMES[m] || m} ${y}`
      };
    }

    // 4. YYYY-MM-DD
    const ymdMatch = raw.match(/(\b\d{4}\b)[\/\-](\b\d{1,2}\b)[\/\-](\b\d{1,2}\b)/);
    if (ymdMatch) {
      const y = ymdMatch[1];
      const m = String(parseInt(ymdMatch[2], 10)).padStart(2, '0');
      const d = parseInt(ymdMatch[3], 10);
      return {
        raw,
        year: y,
        month: m,
        monthName: MONTH_NAMES[m] || '',
        day: d,
        display: `${d} ${MONTH_NAMES[m] || m} ${y}`
      };
    }

    // Fallback: inherit from sheet context if available
    if (sheetContext && sheetContext.month !== 'ALL') {
      return {
        raw,
        year: sheetContext.year || 'ALL',
        month: sheetContext.month,
        monthName: MONTH_NAMES[sheetContext.month] || '',
        day: 1,
        display: fRaw || raw
      };
    }

    return {
      raw,
      year: 'ALL',
      month: 'ALL',
      monthName: '',
      day: 1,
      display: fRaw || raw
    };
  }

  function parseCellNum(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return 0;
    const num = Number(cell.v);
    return isNaN(num) ? 0 : num;
  }

  // --- FILTERING LOGIC ---
  function matchDateFilter(itemMonth, itemYear) {
    const selectedMonth = document.getElementById('monthFilter')?.value || 'ALL';
    const selectedYear = document.getElementById('yearFilter')?.value || 'ALL';

    const monthMatch = (selectedMonth === 'ALL' || itemMonth === selectedMonth);
    const yearMatch = (selectedYear === 'ALL' || itemYear === selectedYear);

    return monthMatch && yearMatch;
  }

  // --- NAVIGATION & TABS ---
  function switchTab(tabName) {
    currentTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
    });

    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');

    renderCurrentMenu();
  }

  function renderCurrentMenu() {
    updateBadgeHeader();

    if (currentTab === 'report_leads') {
      renderReportLeads();
    } else if (currentTab === 'rekap_cmb') {
      renderRekapCMB();
    } else if (currentTab === 'rekap_murid') {
      renderRekapMurid();
    }
  }

  function updateBadgeHeader() {
    const selectedMonth = document.getElementById('monthFilter')?.value || 'ALL';
    const selectedYear = document.getElementById('yearFilter')?.value || 'ALL';

    const monthText = selectedMonth === 'ALL' ? 'Semua Bulan' : (MONTH_NAMES[selectedMonth] || selectedMonth);
    const yearText = selectedYear === 'ALL' ? 'Semua Tahun' : selectedYear;

    const badge = document.getElementById('activePeriodeBadge');
    if (badge) {
      badge.textContent = `Bulan: ${monthText} | Tahun: ${yearText}`;
    }
  }

  function updateSheetCountBadge() {
    const badge = document.getElementById('sheetCountBadge');
    if (badge) {
      const names = discoveredSheets.map(s => s.sheetName).join(', ');
      badge.textContent = `${discoveredSheets.length} Sheet (${names || 'Tidak ada'})`;
    }
  }

  function updateYearFilterDropdown() {
    const yearSelect = document.getElementById('yearFilter');
    if (!yearSelect) return;

    const currentSelected = yearSelect.value;
    const sortedYears = Array.from(availableYears).sort();

    yearSelect.innerHTML = '<option value="ALL">Semua Tahun</option>';
    sortedYears.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    });

    if (availableYears.has(currentSelected)) {
      yearSelect.value = currentSelected;
    } else {
      yearSelect.value = 'ALL';
    }
  }

  // --- MENU 1: REPORT LEADS ---
  function renderReportLeads() {
    const filterLabel = document.getElementById('filterLabel');
    if (filterLabel) filterLabel.textContent = 'Filter CS:';

    const chartTitle = document.getElementById('chartTitle');
    if (chartTitle) chartTitle.textContent = '📊 Distribusi Status Leads (Call In s/d Closing UP)';

    // Filter leads by date
    const dateFilteredLeads = parsedLeadsData.filter(d => {
      const m = d.dateObj?.month || 'ALL';
      const y = d.dateObj?.year || 'ALL';
      return matchDateFilter(m, y);
    });

    // Populate CS Filter dropdown
    populateSpecificFilter(dateFilteredLeads, 'namaCS');

    const selectedCS = document.getElementById('csFilter')?.value || 'ALL';
    const finalData = (selectedCS === 'ALL')
      ? dateFilteredLeads
      : dateFilteredLeads.filter(d => d.namaCS === selectedCS);

    // Sum metrics
    const sumNew = finalData.reduce((s, d) => s + d.newLeads, 0);
    const sumExist = finalData.reduce((s, d) => s + d.existingLeads, 0);
    const sumTotalLeads = finalData.reduce((s, d) => s + d.totalLeads, 0);
    const sumCallIn = finalData.reduce((s, d) => s + d.callIn, 0);
    const sumPot = finalData.reduce((s, d) => s + d.potensial, 0);
    const sumCloseForm = finalData.reduce((s, d) => s + d.closingForm, 0);
    const sumTidakPot = finalData.reduce((s, d) => s + d.tidakPotensial, 0);
    const sumFull = finalData.reduce((s, d) => s + d.kuotaFull, 0);
    const sumCloseUP = finalData.reduce((s, d) => s + d.closingUP, 0);
    const sumStatusTotal = sumCallIn + sumPot + sumCloseForm + sumTidakPot + sumFull + sumCloseUP;

    // Render Metrics Cards
    const metricsContainer = document.getElementById('metricsContainer');
    if (metricsContainer) {
      metricsContainer.innerHTML = `
        <div class="metric-card border-blue">
          <p class="metric-card-title">New Leads</p>
          <p class="metric-card-value text-blue-600">${sumNew.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-cyan">
          <p class="metric-card-title">Existing Leads</p>
          <p class="metric-card-value text-cyan-600">${sumExist.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-indigo">
          <p class="metric-card-title text-indigo-700">TOTAL LEADS (C+D)</p>
          <p class="metric-card-value text-indigo-900">${sumTotalLeads.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-sky">
          <p class="metric-card-title">Call In</p>
          <p class="metric-card-value text-sky-600">${sumCallIn.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-amber">
          <p class="metric-card-title">Potensial</p>
          <p class="metric-card-value text-amber-600">${sumPot.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-emerald">
          <p class="metric-card-title">Closing Form</p>
          <p class="metric-card-value text-emerald-600">${sumCloseForm.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-rose">
          <p class="metric-card-title">Tidak Potensial</p>
          <p class="metric-card-value text-rose-600">${sumTidakPot.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-slate">
          <p class="metric-card-title">Kuota Full</p>
          <p class="metric-card-value text-slate-600">${sumFull.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-purple">
          <p class="metric-card-title">Closing UP</p>
          <p class="metric-card-value text-purple-600">${sumCloseUP.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-teal">
          <p class="metric-card-title text-teal-700">TOTAL STATUS (F..K)</p>
          <p class="metric-card-value text-teal-900">${sumStatusTotal.toLocaleString('id-ID')}</p>
        </div>
      `;
    }

    // Render Detailed Leads Table
    const tableContainer = document.getElementById('dynamicTableContainer');
    if (!tableContainer) return;

    if (finalData.length === 0) {
      tableContainer.innerHTML = renderEmptyStateHTML('Tidak ada data leads untuk periode yang dipilih.');
      renderPieChart([], [], []);
      return;
    }

    let rowsHTML = '';
    finalData.forEach(item => {
      const rowStatusTotal = item.callIn + item.potensial + item.closingForm + item.tidakPotensial + item.kuotaFull + item.closingUP;
      rowsHTML += `
        <tr>
          <td class="text-left font-date">${item.tanggal}</td>
          <td class="text-left font-cs">${item.namaCS}</td>
          <td>${item.newLeads}</td>
          <td>${item.existingLeads}</td>
          <td class="col-total-leads">${item.totalLeads}</td>
          <td>${item.callIn}</td>
          <td class="text-amber-600 font-semibold">${item.potensial}</td>
          <td class="text-emerald-600 font-semibold">${item.closingForm}</td>
          <td class="text-rose-600">${item.tidakPotensial}</td>
          <td class="text-slate-500">${item.kuotaFull}</td>
          <td class="text-purple-600 font-semibold">${item.closingUP}</td>
          <td class="col-total-status">${rowStatusTotal}</td>
        </tr>
      `;
    });

    tableContainer.innerHTML = `
      <div class="table-card">
        <div class="table-header-banner banner-primary">
          <span>📋 Detail Laporan Leads Harian (Real-time Google Sheets)</span>
          <span class="text-xs opacity-80 font-normal">Menampilkan ${finalData.length} baris data</span>
        </div>
        <div class="table-card-body">
          <div class="table-responsive">
            <table class="custom-table">
              <thead>
                <tr>
                  <th class="text-left">Tanggal</th>
                  <th class="text-left">Nama CS</th>
                  <th>New Leads</th>
                  <th>Existing</th>
                  <th class="th-highlight-yellow">Total Leads</th>
                  <th>Call In</th>
                  <th>Potensial</th>
                  <th>Closing Form</th>
                  <th>Tidak Pot.</th>
                  <th>Kuota Full</th>
                  <th>Closing UP</th>
                  <th class="th-highlight-green">Total Status</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHTML}
                <tr class="total-row">
                  <td class="text-left" colspan="2">TOTAL KESELURUHAN</td>
                  <td>${sumNew}</td>
                  <td>${sumExist}</td>
                  <td class="text-base">${sumTotalLeads}</td>
                  <td>${sumCallIn}</td>
                  <td>${sumPot}</td>
                  <td>${sumCloseForm}</td>
                  <td>${sumTidakPot}</td>
                  <td>${sumFull}</td>
                  <td>${sumCloseUP}</td>
                  <td class="text-base">${sumStatusTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Render Chart
    renderPieChart(
      ['Call In', 'Potensial', 'Closing Form', 'Tidak Potensial', 'Kuota Full', 'Closing UP'],
      [sumCallIn, sumPot, sumCloseForm, sumTidakPot, sumFull, sumCloseUP],
      ['#38BDF8', '#F59E0B', '#10B981', '#EF4444', '#64748B', '#A855F7']
    );
  }

  // --- MENU 2: REKAPITULASI CMB ---
  function renderRekapCMB() {
    const filterLabel = document.getElementById('filterLabel');
    if (filterLabel) filterLabel.textContent = 'Filter CS:';

    const chartTitle = document.getElementById('chartTitle');
    if (chartTitle) chartTitle.textContent = '📊 Distribusi CMB Per Jenjang';

    // Filter CMB by date
    const dateFilteredCMB = parsedCMBData.filter(d => matchDateFilter(d.month, d.year));

    // Build CS list from candidates for filter population
    const csSet = new Set();
    dateFilteredCMB.forEach(d => {
      if (d.candidates && d.candidates.length > 0) {
        d.candidates.forEach(c => {
          if (c.pic && c.pic !== 'Umum') csSet.add(c.pic);
        });
      }
    });

    // Populate CS Filter
    const csSelect = document.getElementById('csFilter');
    if (csSelect) {
      const currentVal = csSelect.value;
      csSelect.innerHTML = '<option value="ALL">Semua Data</option>';
      Array.from(csSet).sort().forEach(cs => {
        const opt = document.createElement('option');
        opt.value = cs;
        opt.textContent = cs;
        csSelect.appendChild(opt);
      });
      if (csSet.has(currentVal)) {
        csSelect.value = currentVal;
      } else {
        csSelect.value = 'ALL';
      }
    }

    const finalData = dateFilteredCMB;

    // Calculate grand totals
    let grandClosingForm = 0;
    let grandCancel = 0;
    let grandUPProses = 0;
    let grandUPSelesai = 0;
    let grandOnProgress = 0;

    finalData.forEach(d => {
      grandClosingForm += d.closingForm || 0;
      grandCancel += d.cancel || 0;
      grandUPProses += d.upProses || 0;
      grandUPSelesai += d.upSelesai || 0;
      grandOnProgress += d.onProgressOld || 0;
    });

    const grandLanjutPendaftaran = Math.max(0, grandClosingForm - grandCancel);
    const grandFormulirProses = Math.max(0, grandLanjutPendaftaran - grandUPSelesai - grandUPProses);

    // Render Metric Cards
    const metricsContainer = document.getElementById('metricsContainer');
    if (metricsContainer) {
      metricsContainer.innerHTML = `
        <div class="metric-card border-teal">
          <p class="metric-card-title">Lanjut Pendaftaran</p>
          <p class="metric-card-value text-teal-700">${grandLanjutPendaftaran.toLocaleString('id-ID')}</p>
          <p class="metric-card-subtitle">= Closing Formulir (${grandClosingForm}) - Cancel (${grandCancel})</p>
        </div>
        <div class="metric-card border-purple">
          <p class="metric-card-title">Formulir (Proses)</p>
          <p class="metric-card-value text-purple-700">${grandFormulirProses.toLocaleString('id-ID')}</p>
          <p class="metric-card-subtitle">= Lanjut (${grandLanjutPendaftaran}) - UP Selesai (${grandUPSelesai}) - UP Proses (${grandUPProses})</p>
        </div>
        <div class="metric-card border-blue">
          <p class="metric-card-title">Closing Formulir</p>
          <p class="metric-card-value text-blue-600">${grandClosingForm.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-rose">
          <p class="metric-card-title">Cancel Pendaftaran</p>
          <p class="metric-card-value text-rose-600">${grandCancel.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-amber">
          <p class="metric-card-title">Uang Pangkal (Proses)</p>
          <p class="metric-card-value text-amber-600">${grandUPProses.toLocaleString('id-ID')}</p>
        </div>
        <div class="metric-card border-emerald">
          <p class="metric-card-title">Uang Pangkal (Selesai)</p>
          <p class="metric-card-value text-emerald-700">${grandUPSelesai.toLocaleString('id-ID')}</p>
        </div>
      `;
    }

    const tableContainer = document.getElementById('dynamicTableContainer');
    if (!tableContainer) return;

    if (finalData.length === 0) {
      tableContainer.innerHTML = renderEmptyStateHTML('Tidak ada data CMB untuk periode yang dipilih.');
      renderPieChart([], [], []);
      return;
    }

    // Build hierarchical table: Unit → Jenjang → Program
    const units = [...new Set(finalData.map(d => d.unit))];

    let tableBodyHTML = '';
    let jenjangChartLabels = [];
    let jenjangChartValues = [];

    units.forEach(unit => {
      const unitItems = finalData.filter(d => d.unit === unit);
      const jenjangs = [...new Set(unitItems.map(d => d.jenjang))];

      let unitTotalClosing = 0, unitTotalUPP = 0, unitTotalUPF = 0, unitTotalCancel = 0, unitTotalFormProses = 0;

      // Count total rows for unit rowspan
      let unitRowCount = 0;
      jenjangs.forEach(jenj => {
        const jenjItems = unitItems.filter(d => d.jenjang === jenj);
        const uniquePrograms = [...new Set(jenjItems.map(d => d.program))];
        unitRowCount += uniquePrograms.length + 1; // +1 for jenjang subtotal row
      });

      let isFirstUnitRow = true;

      jenjangs.forEach(jenj => {
        const jenjItems = unitItems.filter(d => d.jenjang === jenj);
        const uniquePrograms = [...new Set(jenjItems.map(d => d.program))];
        let jenjTotalClosing = 0, jenjTotalUPP = 0, jenjTotalUPF = 0, jenjTotalCancel = 0, jenjTotalFormProses = 0;

        let isFirstJenjRow = true;

        uniquePrograms.forEach(prog => {
          const progItems = jenjItems.filter(d => d.program === prog);
          
          let progClosingForm = 0;
          let progUPProses = 0;
          let progUPSelesai = 0;
          let progCancel = 0;
          
          progItems.forEach(item => {
            progClosingForm += item.closingForm || 0;
            progUPProses += item.upProses || 0;
            progUPSelesai += item.upSelesai || 0;
            progCancel += item.cancel || 0;
          });

          const lanjut = Math.max(0, progClosingForm - progCancel);
          const formProses = Math.max(0, lanjut - progUPSelesai - progUPProses);

          jenjTotalClosing += progClosingForm;
          jenjTotalUPP += progUPProses;
          jenjTotalUPF += progUPSelesai;
          jenjTotalCancel += progCancel;
          jenjTotalFormProses += formProses;

          tableBodyHTML += `<tr>`;

          // Unit cell with rowspan (only on first row of unit)
          if (isFirstUnitRow) {
            tableBodyHTML += `<td rowspan="${unitRowCount}" class="unit-cell text-left">${unit}</td>`;
            isFirstUnitRow = false;
          }

          // Jenjang cell with rowspan (only on first row of jenjang)
          if (isFirstJenjRow) {
            tableBodyHTML += `<td rowspan="${uniquePrograms.length + 1}" class="jenjang-cell text-left">${jenj}</td>`;
            isFirstJenjRow = false;
          }

          tableBodyHTML += `
              <td class="program-cell">${prog}</td>
              <td class="col-closing-form">${progClosingForm}</td>
              <td class="col-up-proses">${progUPProses}</td>
              <td class="col-up-selesai">${progUPSelesai}</td>
              <td class="col-cancel">${progCancel}</td>
              <td class="col-form-proses">${formProses}</td>
            </tr>`;
        });

        // Jenjang subtotal row
        const jenjLanjut = Math.max(0, jenjTotalClosing - jenjTotalCancel);
        const jenjFormProses = Math.max(0, jenjLanjut - jenjTotalUPF - jenjTotalUPP);

        tableBodyHTML += `
          <tr class="subtotal-jenjang-row">
            <td class="text-left font-bold">Jumlah</td>
            <td>${jenjTotalClosing}</td>
            <td>${jenjTotalUPP}</td>
            <td>${jenjTotalUPF}</td>
            <td>${jenjTotalCancel}</td>
            <td>${jenjFormProses}</td>
          </tr>`;

        unitTotalClosing += jenjTotalClosing;
        unitTotalUPP += jenjTotalUPP;
        unitTotalUPF += jenjTotalUPF;
        unitTotalCancel += jenjTotalCancel;
        unitTotalFormProses += jenjFormProses;

        // Track for pie chart
        const existingIdx = jenjangChartLabels.indexOf(jenj);
        if (existingIdx >= 0) {
          jenjangChartValues[existingIdx] += jenjTotalClosing;
        } else {
          jenjangChartLabels.push(jenj);
          jenjangChartValues.push(jenjTotalClosing);
        }
      });
    });

    // Grand total row
    const gtLanjut = Math.max(0, grandClosingForm - grandCancel);
    const gtFormProses = Math.max(0, gtLanjut - grandUPSelesai - grandUPProses);

    tableBodyHTML += `
      <tr class="total-row-blue">
        <td colspan="3" class="text-left">TOTAL KESELURUHAN</td>
        <td>${grandClosingForm}</td>
        <td>${grandUPProses}</td>
        <td>${grandUPSelesai}</td>
        <td>${grandCancel}</td>
        <td class="highlight-accent">${gtFormProses}</td>
      </tr>`;

    const fullTableHTML = `
      <div class="table-card">
        <div class="table-header-banner banner-emerald">
          <span>👥 REKAPITULASI CMB PER UNIT / JENJANG / PROGRAM</span>
          <span class="text-xs opacity-80 font-normal">Total Closing Formulir: ${grandClosingForm} • Lanjut Pendaftaran: ${gtLanjut}</span>
        </div>
        <div class="table-card-body">
          <div class="table-responsive">
            <table class="custom-table">
              <thead>
                <tr>
                  <th class="text-left">Unit</th>
                  <th class="text-left">Jenjang</th>
                  <th class="text-left">Program</th>
                  <th>Closing Formulir</th>
                  <th>UP + Progress</th>
                  <th>UP + Finish</th>
                  <th>Cancel</th>
                  <th class="th-highlight-green">Formulir (Proses)</th>
                </tr>
              </thead>
              <tbody>
                ${tableBodyHTML}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    tableContainer.innerHTML = fullTableHTML;

    // Render pie chart by jenjang
    renderPieChart(
      jenjangChartLabels,
      jenjangChartValues,
      ['#2563EB', '#16A34A', '#EA580C', '#9333EA', '#CA8A04', '#0891B2']
    );
  }

  // --- MENU 3: REKAPITULASI MURID ---
  function renderRekapMurid() {
    const filterLabel = document.getElementById('filterLabel');
    if (filterLabel) filterLabel.textContent = 'Filter Sumber:';

    const chartTitle = document.getElementById('chartTitle');
    if (chartTitle) chartTitle.textContent = '📊 Distribusi Murid per Jenjang';

    const programList = ['DLP', 'DL', 'DLT', 'INK', 'KOM', 'KOP', 'KOR'];

    // Filter Murid data by sheet month and year
    const dateFilteredSheets = parsedMuridData.filter(s => matchDateFilter(s.month, s.year));

    // Aggregate sections across matched sheets
    const aggregatedSections = [
      { sumber: 'Homeschooling Kak Seto', title: 'HOMESCHOOLING KAK SETO', jenjangs: [] },
      { sumber: 'Kak Seto School', title: 'KAK SETO SCHOOL', jenjangs: [] }
    ];

    // Populate Sumber filter
    populateSpecificFilter([
      { sumber: 'Homeschooling Kak Seto' },
      { sumber: 'Kak Seto School' }
    ], 'sumber');

    const selectedSumber = document.getElementById('csFilter')?.value || 'ALL';

    // Merge sections across sheets
    const jenjangNames = ['SD', 'SMP', 'SMA'];
    aggregatedSections.forEach(sec => {
      jenjangNames.forEach(jenjName => {
        const classMap = new Map(); // className -> array of 7 program values

        dateFilteredSheets.forEach(sheetMurid => {
          const matchingSec = sheetMurid.sections.find(s => s.sumber === sec.sumber);
          const matchingJenj = matchingSec?.jenjangs.find(j => j.name === jenjName);
          if (matchingJenj) {
            matchingJenj.rows.forEach(r => {
              if (!classMap.has(r.className)) {
                classMap.set(r.className, Array(programList.length).fill(0));
              }
              const currentVals = classMap.get(r.className);
              r.progValues.forEach((val, pIdx) => {
                currentVals[pIdx] += val;
              });
            });
          }
        });

        if (classMap.size > 0) {
          const mergedRows = [];
          classMap.forEach((progValues, className) => {
            mergedRows.push({
              className: className,
              progValues: progValues,
              total: progValues.reduce((a, b) => a + b, 0)
            });
          });

          sec.jenjangs.push({
            name: jenjName,
            rows: mergedRows,
            total: mergedRows.reduce((a, b) => a + b.total, 0)
          });
        }
      });
    });

    const finalSections = (selectedSumber === 'ALL')
      ? aggregatedSections
      : aggregatedSections.filter(s => s.sumber === selectedSumber);

    let htmlContent = '';
    let overallTotal = 0;
    let jenjangSummaryMap = {};

    finalSections.forEach(sec => {
      sec.jenjangs.forEach(j => {
        let jenjangTotal = 0;
        let progTotals = Array(programList.length).fill(0);
        let classRowsHTML = '';

        j.rows.forEach(r => {
          jenjangTotal += r.total;
          let colsHTML = '';
          r.progValues.forEach((val, pIdx) => {
            progTotals[pIdx] += val;
            colsHTML += `<td>${val}</td>`;
          });

          classRowsHTML += `
            <tr>
              <td class="font-bold bg-slate-50">${r.className}</td>
              ${colsHTML}
              <td class="font-bold bg-amber-50 text-amber-800">${r.total}</td>
            </tr>
          `;
        });

        let progTotalsColsHTML = progTotals.map(pt => `<td>${pt}</td>`).join('');

        htmlContent += `
          <div class="table-card">
            <div class="table-header-banner banner-primary">
              <span>${sec.title} &bull; ${j.name}</span>
              <span class="text-xs opacity-80 font-normal">Subtotal: ${jenjangTotal} Murid</span>
            </div>
            <div class="table-card-body">
              <div class="table-responsive">
                <table class="custom-table">
                  <thead>
                    <tr class="bg-amber-300 text-slate-900">
                      <th class="w-20 text-slate-900 bg-amber-300 border-amber-400">Kelas</th>
                      ${programList.map(p => `<th class="text-slate-900 bg-amber-300 border-amber-400">${p}</th>`).join('')}
                      <th class="text-slate-900 bg-amber-400 border-amber-400">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${classRowsHTML}
                    <tr class="total-row">
                      <td>JUMLAH</td>
                      ${progTotalsColsHTML}
                      <td class="text-base">${jenjangTotal}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;

        overallTotal += jenjangTotal;
        jenjangSummaryMap[j.name] = (jenjangSummaryMap[j.name] || 0) + jenjangTotal;
      });
    });

    // Summary Table (Program x Jenjang)
    const activeJenjangNames = Object.keys(jenjangSummaryMap);
    let summaryTableHTML = '';

    if (activeJenjangNames.length > 0) {
      let programSummaryRowsHTML = '';
      programList.forEach((p, pIdx) => {
        let pTotal = 0;
        let jColsHTML = '';

        activeJenjangNames.forEach(jName => {
          let pVal = 0;
          finalSections.forEach(sec => {
            const foundJenj = sec.jenjangs.find(j => j.name === jName);
            if (foundJenj) {
              foundJenj.rows.forEach(r => {
                pVal += (r.progValues[pIdx] || 0);
              });
            }
          });
          pTotal += pVal;
          jColsHTML += `<td>${pVal}</td>`;
        });

        programSummaryRowsHTML += `
          <tr>
            <td class="text-left font-bold bg-slate-50">${p}</td>
            ${jColsHTML}
            <td class="font-bold bg-amber-50 text-amber-800">${pTotal}</td>
          </tr>
        `;
      });

      let jenjangTotalCols = activeJenjangNames.map(j => `<td>${jenjangSummaryMap[j]}</td>`).join('');

      summaryTableHTML = `
        <div class="table-card">
          <div class="table-header-banner banner-emerald">
            <span>REKAP PER PROGRAM (SELURUH JENJANG)</span>
            <span class="text-xs opacity-80 font-normal">Total: ${overallTotal} Murid</span>
          </div>
          <div class="table-card-body">
            <div class="table-responsive">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th class="text-left">Program</th>
                    ${activeJenjangNames.map(j => `<th>${j}</th>`).join('')}
                    <th class="th-highlight-amber">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  ${programSummaryRowsHTML}
                  <tr class="total-row-blue">
                    <td class="text-left">TOTAL</td>
                    ${jenjangTotalCols}
                    <td class="highlight-accent text-base">${overallTotal}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // Render Metric Card
    const metricsContainer = document.getElementById('metricsContainer');
    if (metricsContainer) {
      metricsContainer.innerHTML = `
        <div class="metric-card col-span-full border-purple">
          <p class="metric-card-title">Total Keseluruhan Murid</p>
          <p class="metric-card-value text-purple-700">${overallTotal.toLocaleString('id-ID')}</p>
        </div>
      `;
    }

    const tableContainer = document.getElementById('dynamicTableContainer');
    if (!tableContainer) return;

    if (overallTotal === 0 && !summaryTableHTML) {
      tableContainer.innerHTML = renderEmptyStateHTML('Tidak ada data murid untuk periode yang dipilih.');
      renderPieChart([], [], []);
      return;
    }

    tableContainer.innerHTML = summaryTableHTML + htmlContent;

    renderPieChart(
      Object.keys(jenjangSummaryMap),
      Object.values(jenjangSummaryMap),
      ['#2563EB', '#16A34A', '#EA580C', '#9333EA']
    );
  }

  // --- FILTER DROPDOWN UTILITY ---
  function populateSpecificFilter(data, keyName) {
    const select = document.getElementById('csFilter');
    if (!select) return;

    const currentVal = select.value;
    const uniqueValues = new Set();

    data.forEach(item => {
      const val = item[keyName];
      if (val && val !== '-' && val !== 'ALL') {
        uniqueValues.add(val);
      }
    });

    select.innerHTML = '<option value="ALL">Semua Data</option>';
    Array.from(uniqueValues).sort().forEach(val => {
      const option = document.createElement('option');
      option.value = val;
      option.textContent = val;
      select.appendChild(option);
    });

    if (uniqueValues.has(currentVal)) {
      select.value = currentVal;
    } else {
      select.value = 'ALL';
    }
  }

  // --- CHART RENDERING ---
  function renderPieChart(labels, dataValues, colors) {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    if (!labels || labels.length === 0 || dataValues.every(v => v === 0)) {
      // Clear chart canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    chartInstance = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: labels,
        datasets: [{
          data: dataValues,
          backgroundColor: colors.slice(0, labels.length),
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: {
                family: "'Plus Jakarta Sans', sans-serif",
                size: 12,
                weight: 600
              },
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const label = context.label || '';
                const value = context.parsed || 0;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                return ` ${label}: ${value.toLocaleString('id-ID')} (${percentage}%)`;
              }
            }
          }
        }
      }
    });
  }

  // --- STATUS & ERROR STATES ---
  function setSyncStatus(type, message, time = '') {
    const bar = document.getElementById('syncStatusBar');
    const textEl = document.getElementById('syncStatusText');
    const timeEl = document.getElementById('syncStatusTime');
    if (!bar || !textEl) return;

    bar.className = 'sync-status-bar';
    bar.style.display = 'flex';

    if (type === 'loading') {
      bar.classList.add('status-loading');
      textEl.innerHTML = '⏳ ' + message;
      if (timeEl) timeEl.textContent = '';
    } else if (type === 'success') {
      bar.classList.add('status-success');
      textEl.innerHTML = '✅ ' + message;
      if (timeEl) timeEl.textContent = time ? `Terakhir sync: ${time}` : '';
    } else if (type === 'error') {
      bar.classList.add('status-error');
      textEl.innerHTML = '⚠️ ' + message;
      if (timeEl) timeEl.textContent = '';
    }
  }

  function renderEmptyStateHTML(message) {
    return `
      <div class="state-container">
        <span class="state-icon">📭</span>
        <p class="state-title">Data Tidak Ditemukan</p>
        <p class="state-desc">${message}</p>
      </div>
    `;
  }

  function renderErrorState(errorMessage) {
    const tableContainer = document.getElementById('dynamicTableContainer');
    if (tableContainer) {
      tableContainer.innerHTML = `
        <div class="state-container">
          <span class="state-icon">⚠️</span>
          <p class="state-title text-red-600">Gagal Terhubung ke Google Sheets</p>
          <p class="state-desc text-slate-600 mb-4">${errorMessage || 'Pastikan koneksi internet stabil dan Spreadsheet dapat diakses.'}</p>
          <button onclick="window.fetchData && window.fetchData()" class="btn-sync">
            <span>🔄</span> Coba Lagi
          </button>
        </div>
      `;
    }
  }

  // Expose fetchData to window for manual retry button
  window.fetchData = fetchData;
  window.switchTab = switchTab;
  window.renderCurrentMenu = renderCurrentMenu;

})();