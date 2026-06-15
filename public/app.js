'use strict';

let map, markerLayer, appsChart, ipsChart, timelineChart, toolsUsageChart, toolsTimelineChart, appsUsageChart, comparisonChart;

// Palette for multi-series tool charts.
const TOOL_COLORS = ['#2f81f7', '#3fb950', '#d29922', '#a371f7', '#f85149', '#39c5cf', '#db61a2', '#e3b341'];

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const resultsEl = $('#results');

const PAGE_SIZE = 50;

const STATE = {
  data: null, days: 30, source: 'graph', filtered: [],
  mode: 'user',            // 'user' | 'tenant'
  tablePage: 1,
  baselineKind: null,      // null | 'compare' | 'tenant'
  compareData: null,       // full analysis of the compared user
  tenantCache: {},         // { [days]: TenantBaseline }
  tenantPending: null,
};

/* ----------------------------- Search ----------------------------- */

$('#search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = $('#user-input').value.trim();
  if (!user) return;
  await runAnalysis(user);
});

// Switching data source re-runs the analysis (different backend query).
$('#source-select').addEventListener('change', async (e) => {
  STATE.source = e.target.value;
  renderFilters(STATE.source);
  const user = $('#user-input').value.trim();
  if (user && STATE.data) await runAnalysis(user);
});

async function runAnalysis(user) {
  const btn = $('#search-btn');
  btn.disabled = true;
  const lookback = STATE.source === 'loganalytics' ? 90 : 30;
  setStatus(`Querying ${sourceLabel(STATE.source)} for "${user}"...`, false);
  resultsEl.classList.add('hidden');

  try {
    const url = `/api/analyze?user=${encodeURIComponent(user)}&source=${STATE.source}&days=${lookback}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Query failed.');
    render(data);
    setStatus(`Analysis completed at ${new Date(data.generatedAt).toLocaleString()} via ${sourceLabel(data.source)}.`, false);
    resultsEl.classList.remove('hidden');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// Tenant-wide overview (shown automatically after the Service Principal is configured).
async function loadTenantOverview() {
  STATE.source = 'graph';
  $('#source-select').value = 'graph';
  renderFilters('graph');
  setStatus('Loading tenant overview…', false);
  resultsEl.classList.add('hidden');
  try {
    const res = await fetch('/api/tenant-overview?days=30');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load tenant overview.');
    render(data);
    setStatus(`Tenant overview — ${data.user.displayName || ''} — generated ${new Date(data.generatedAt).toLocaleString()}.`, false);
    resultsEl.classList.remove('hidden');
  } catch (err) {
    setStatus(err.message, true);
  }
}

function sourceLabel(s) {
  return s === 'loganalytics' ? 'Log Analytics' : 'Microsoft Graph';
}

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', !!isError);
}

/* ----------------------- Period filters + PDF ----------------------- */

// Build the period buttons available for the active source.
function renderFilters(source) {
  const ranges = source === 'loganalytics' ? [7, 30, 90] : [1, 7, 30];
  const def = source === 'loganalytics' ? 90 : 30;
  STATE.days = def;
  $('#filters').innerHTML = ranges
    .map((d) => `<button type="button" data-days="${d}" class="${d === def ? 'active' : ''}">${d === 1 ? '24 hours' : d + ' days'}</button>`)
    .join('');
}
renderFilters('graph');

$('#filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-days]');
  if (!btn || !STATE.data) return;
  applyFilter(Number(btn.dataset.days));
});

$('#pdf-btn').addEventListener('click', () => window.print());

/* ----------------------- Metric drill-down ----------------------- */

const detailOverlay = $('#detail-overlay');

$('#summary').addEventListener('click', (e) => {
  const card = e.target.closest('.metric[data-metric]');
  if (!card || !STATE.filtered) return;
  openDetail(card.dataset.metric);
});
$('#detail-close').addEventListener('click', () => detailOverlay.classList.add('hidden'));
detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) detailOverlay.classList.add('hidden'); });

function openDetail(metric) {
  const data = STATE.filtered || [];
  const period = STATE.days === 1 ? 'last 24 hours' : `last ${STATE.days} days`;
  let title = '';
  let html = '';

  switch (metric) {
    case 'total':
      title = 'All sign-ins';
      html = signinTable(data);
      break;
    case 'success':
      title = 'Successful sign-ins';
      html = signinTable(data.filter((s) => s.status.errorCode === 0));
      break;
    case 'fail':
      title = 'Failed sign-ins';
      html = signinTable(data.filter((s) => s.status.errorCode !== 0), true);
      break;
    case 'apps':
      title = 'Unique applications';
      html = groupTable(data, (s) => s.appDisplayName, 'Application');
      break;
    case 'ips':
      title = 'Unique IPs';
      html = ipTable(data);
      break;
    case 'countries':
      title = 'Countries';
      html = groupTable(data, (s) => s.location && s.location.countryOrRegion, 'Country');
      break;
  }

  $('#detail-title').textContent = `${title} — ${period}`;
  $('#detail-body').innerHTML = html;
  detailOverlay.classList.remove('hidden');
}

function signinTable(records, showReason) {
  if (!records.length) return '<p class="empty">No records in this period.</p>';
  const sorted = records.slice().sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
  const rows = sorted
    .map((s) => {
      const ok = s.status.errorCode === 0;
      const place = s.location ? [s.location.city, s.location.countryOrRegion].filter(Boolean).join(', ') : '-';
      const reasonCell = showReason ? `<td>${esc(s.status.failureReason || '-')}</td>` : '';
      return `<tr>
        <td>${esc(new Date(s.createdDateTime).toLocaleString())}</td>
        <td>${esc(s.appDisplayName || '-')}</td>
        <td class="${ok ? 'ok' : 'fail'}">${ok ? 'Success' : 'Failure (' + s.status.errorCode + ')'}</td>
        <td>${esc(s.ipAddress || '-')}</td>
        <td>${esc(place || '-')}</td>
        <td>${esc(s.clientAppUsed || '-')}</td>
        ${reasonCell}
      </tr>`;
    })
    .join('');
  return `<table><thead><tr>
      <th>Date/Time</th><th>Application</th><th>Status</th><th>IP</th><th>Location</th><th>Client</th>
      ${showReason ? '<th>Failure reason</th>' : ''}
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function groupTable(records, keyFn, label) {
  const map = new Map();
  for (const s of records) {
    const k = keyFn(s);
    if (!k) continue;
    if (!map.has(k)) map.set(k, { count: 0, last: s.createdDateTime, success: 0 });
    const e = map.get(k);
    e.count++;
    if (s.status.errorCode === 0) e.success++;
    if (new Date(s.createdDateTime) > new Date(e.last)) e.last = s.createdDateTime;
  }
  if (!map.size) return '<p class="empty">No records in this period.</p>';
  const rows = [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([k, e]) => `<tr>
        <td>${esc(k)}</td>
        <td>${e.count}</td>
        <td class="ok">${e.success}</td>
        <td class="fail">${e.count - e.success}</td>
        <td>${esc(new Date(e.last).toLocaleString())}</td>
      </tr>`
    )
    .join('');
  return `<table><thead><tr>
      <th>${esc(label)}</th><th>Accesses</th><th>Success</th><th>Failure</th><th>Last access</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

function ipTable(records) {
  const map = new Map();
  for (const s of records) {
    const ip = s.ipAddress;
    if (!ip) continue;
    if (!map.has(ip)) map.set(ip, { count: 0, last: s.createdDateTime, place: '' });
    const e = map.get(ip);
    e.count++;
    if (s.location) {
      const p = [s.location.city, s.location.state, s.location.countryOrRegion].filter(Boolean).join(', ');
      if (p) e.place = p;
    }
    if (new Date(s.createdDateTime) > new Date(e.last)) e.last = s.createdDateTime;
  }
  if (!map.size) return '<p class="empty">No records in this period.</p>';
  const rows = [...map.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(
      ([ip, e]) => `<tr>
        <td>${esc(ip)}</td>
        <td>${esc(e.place || '-')}</td>
        <td>${e.count}</td>
        <td>${esc(new Date(e.last).toLocaleString())}</td>
      </tr>`
    )
    .join('');
  return `<table><thead><tr>
      <th>IP</th><th>Location</th><th>Accesses</th><th>Last access</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/* ----------------------- Company logo ----------------------- */

async function loadLogo() {
  try {
    const res = await fetch('/api/branding');
    const data = await res.json();
    const img = $('#company-logo');
    if (data.logo) {
      img.src = data.logo;
      img.classList.remove('hidden');
    }
  } catch { /* no logo */ }
}
loadLogo();

/* ----------------------- Settings (gear) ----------------------- */

const overlay = $('#settings-overlay');
const STORAGE_KEY = 'm365-forensics-creds';

$('#gear-btn').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', () => overlay.classList.add('hidden'));
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  await saveConfig();
});
$('#cfg-test').addEventListener('click', testConfig);

function openSettings() {
  overlay.classList.remove('hidden');
  $('#cfg-msg').textContent = '';
  const saved = loadLocalCreds();
  if (saved) {
    $('#cfg-tenant').value = saved.tenantId || '';
    $('#cfg-client').value = saved.clientId || '';
    $('#cfg-secret').value = saved.clientSecret || '';
    $('#cfg-workspace').value = saved.workspaceId || '';
    $('#cfg-remember').checked = true;
  }
  refreshConfigStatus();
}

function loadLocalCreds() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return null; }
}

async function refreshConfigStatus() {
  try {
    const res = await fetch('/api/config');
    const s = await res.json();
    const el = $('#config-status');
    if (s.configured) {
      const ws = s.workspaceConfigured ? ` · Workspace ${s.workspaceId}` : ' · no Log Analytics workspace';
      el.className = 'config-status ok';
      el.textContent = `✔️ Configured — Tenant ${s.tenantId}, Client ${s.clientId}${ws}`;
    } else {
      el.className = 'config-status no';
      el.textContent = '⚠️ No credentials configured on the server.';
    }
  } catch { /* ignore */ }
}

function readConfigForm() {
  return {
    tenantId: $('#cfg-tenant').value.trim(),
    clientId: $('#cfg-client').value.trim(),
    clientSecret: $('#cfg-secret').value,
    workspaceId: $('#cfg-workspace').value.trim(),
  };
}

async function postConfig(creds) {
  const res = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save credentials.');
  return data;
}

async function saveConfig() {
  const creds = readConfigForm();
  const msg = $('#cfg-msg');
  try {
    await postConfig(creds);
    if ($('#cfg-remember').checked) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    msg.className = 'cfg-msg ok';
    msg.textContent = '✔️ Credentials saved. Loading tenant overview…';
    refreshConfigStatus();
    loadLogo();
    setTimeout(() => {
      overlay.classList.add('hidden');
      msg.textContent = '';
      loadTenantOverview(); // show the tenant dashboard right after login
    }, 700);
  } catch (err) {
    msg.className = 'cfg-msg err';
    msg.textContent = err.message;
  }
}

async function testConfig() {
  const creds = readConfigForm();
  const msg = $('#cfg-msg');
  msg.className = 'cfg-msg';
  msg.textContent = 'Testing connection...';
  try {
    await postConfig(creds);
    const res = await fetch('/api/config/test', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Connection failed.');
    msg.className = 'cfg-msg ok';
    msg.textContent = `✔️ Connection OK${data.org ? ' — ' + data.org : ''}.`;
  } catch (err) {
    msg.className = 'cfg-msg err';
    msg.textContent = '❌ ' + err.message;
  }
}

// On load: push saved creds to the server; open the panel if not configured.
(async function bootstrapConfig() {
  const saved = loadLocalCreds();
  if (saved && saved.tenantId && saved.clientId && saved.clientSecret) {
    try { await postConfig(saved); } catch { /* ignore */ }
  }
  try {
    const res = await fetch('/api/config');
    const s = await res.json();
    if (!s.configured) openSettings();
    else loadTenantOverview(); // show the tenant dashboard right away
  } catch { /* ignore */ }
})();

/* ----------------------- Rendering ----------------------- */

function render(data) {
  STATE.data = data;
  STATE.mode = data.mode === 'tenant' ? 'tenant' : 'user';
  STATE.tablePage = 1;
  STATE.baselineKind = null;

  // Adjust UI chrome for tenant vs user mode.
  const tenant = STATE.mode === 'tenant';
  document.body.classList.toggle('tenant-mode', tenant);
  $('#profile-card-title').textContent = tenant ? 'Tenant' : 'User';
  $('#roles-card').style.display = tenant ? 'none' : '';
  $('#licenses-card-title').textContent = tenant ? 'Tenant subscriptions' : 'License assignments';

  const deviceN = tenant ? (data.deviceCount || 0) : (data.devices || []).length;
  $('#devices-btn').textContent = `🖥️ Devices (${deviceN})`;

  renderProfile(data.user, data.summary);
  renderRoles(data.roles);
  renderLicenses(data.licenses || []);
  $('#comparison-card').classList.add('hidden');
  applyFilter(STATE.days);
}

function filterByDays(signIns, days) {
  if (!days || days <= 0) return signIns;
  const cutoff = Date.now() - days * 86400000;
  return signIns.filter((s) => new Date(s.createdDateTime).getTime() >= cutoff);
}

function applyFilter(days) {
  STATE.days = days;
  STATE.tablePage = 1;
  const filtered = filterByDays(STATE.data.signIns, days);
  STATE.filtered = filtered;

  renderSummary(computeSummary(filtered, STATE.data.roles));
  renderTimeline(filtered);
  renderToolsUsage(filtered);
  renderAppsUsage(filtered);
  renderToolsTimeline(filtered);
  renderMap(filtered);
  renderCharts(filtered);
  renderTable(filtered);
  renderBaseline();

  const label = days === 1 ? 'Last 24 hours' : `Last ${days} days`;
  const u = STATE.data.user;
  $('#report-period').textContent =
    `Report for ${u.displayName || u.userPrincipalName || '-'} — ${label} — ${filtered.length} sign-ins — source ${sourceLabel(STATE.data.source)} — generated ${new Date().toLocaleString()}`;

  document.querySelectorAll('#filters button').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.days) === days)
  );
}

/* ----------------------- Compare & tenant baseline ----------------------- */

const compareOverlay = $('#compare-overlay');

$('#compare-btn').addEventListener('click', () => {
  if (!STATE.data) return;
  $('#compare-msg').textContent = '';
  $('#compare-upn').value = '';
  compareOverlay.classList.remove('hidden');
  setTimeout(() => $('#compare-upn').focus(), 50);
});
$('#compare-close').addEventListener('click', () => compareOverlay.classList.add('hidden'));
compareOverlay.addEventListener('click', (e) => { if (e.target === compareOverlay) compareOverlay.classList.add('hidden'); });
$('#comparison-clear').addEventListener('click', clearBaseline);

$('#compare-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const upn = $('#compare-upn').value.trim();
  if (!upn) return;
  const msg = $('#compare-msg');
  const btn = $('#compare-go');
  btn.disabled = true;
  msg.className = 'cfg-msg';
  msg.textContent = `Loading ${upn}...`;
  try {
    const lookback = STATE.source === 'loganalytics' ? 90 : 30;
    const res = await fetch(`/api/analyze?user=${encodeURIComponent(upn)}&source=${STATE.source}&days=${lookback}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Query failed.');
    STATE.compareData = data;
    STATE.baselineKind = 'compare';
    compareOverlay.classList.add('hidden');
    renderBaseline();
  } catch (err) {
    msg.className = 'cfg-msg err';
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#tenant-btn').addEventListener('click', () => {
  if (!STATE.data) return;
  STATE.baselineKind = 'tenant';
  STATE.compareData = null;
  renderBaseline();
});

$('#devices-btn').addEventListener('click', () => {
  if (!STATE.data) return;
  if (STATE.mode === 'tenant') {
    const n = STATE.data.deviceCount || 0;
    $('#detail-title').textContent = `Tenant devices (${n})`;
    $('#detail-body').innerHTML = `<p class="empty">The tenant has ${n} registered devices. Analyze a specific user to see their per-device list.</p>`;
    detailOverlay.classList.remove('hidden');
    return;
  }
  openDevicesDetail(STATE.data.devices || []);
});

// Clicking the brand/logo returns to the tenant overview.
$('#brand').addEventListener('click', () => loadTenantOverview());

const DEVICE_TRUST = {
  AzureAd: 'Entra joined',
  ServerAd: 'Hybrid joined',
  Workplace: 'Entra registered (BYOD)',
};

function openDevicesDetail(devices) {
  $('#detail-title').textContent = `Devices (${devices.length})`;
  if (!devices.length) {
    $('#detail-body').innerHTML = '<p class="empty">No devices owned/registered by this user (or Directory.Read.All permission missing).</p>';
    detailOverlay.classList.remove('hidden');
    return;
  }
  const rows = devices
    .slice()
    .sort((a, b) => new Date(b.approximateLastSignInDateTime || 0) - new Date(a.approximateLastSignInDateTime || 0))
    .map((d) => {
      const trust = DEVICE_TRUST[d.trustType] || d.trustType || '-';
      const compliant = d.isCompliant === null ? '-' : d.isCompliant ? '<span class="ok">Yes</span>' : '<span class="fail">No</span>';
      const managed = d.isManaged === null ? '-' : d.isManaged ? 'Yes' : 'No';
      const os = [d.operatingSystem, d.operatingSystemVersion].filter(Boolean).join(' ');
      const last = d.approximateLastSignInDateTime ? new Date(d.approximateLastSignInDateTime).toLocaleString() : '-';
      return `<tr>
        <td>${esc(d.displayName || '-')}</td>
        <td>${esc(os || '-')}</td>
        <td>${esc(trust)}</td>
        <td>${managed}</td>
        <td>${compliant}</td>
        <td>${esc(d.relationship)}</td>
        <td>${esc(last)}</td>
      </tr>`;
    })
    .join('');
  $('#detail-body').innerHTML = `<table><thead><tr>
      <th>Name</th><th>OS</th><th>Trust type</th><th>Managed</th><th>Compliant</th><th>Relationship</th><th>Last activity</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
  detailOverlay.classList.remove('hidden');
}

function clearBaseline() {
  STATE.baselineKind = null;
  STATE.compareData = null;
  if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
  $('#comparison-card').classList.add('hidden');
}

// Grouped bar chart: user vs baseline across the comparison metrics.
function renderComparisonChart(labels, userVals, baseVals, userLabel, baseLabel) {
  $('#comparison-chart-box').style.display = '';
  if (comparisonChart) comparisonChart.destroy();
  comparisonChart = new Chart(document.getElementById('comparison-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: userLabel, data: userVals, backgroundColor: '#2f81f7' },
        { label: baseLabel, data: baseVals, backgroundColor: '#d29922' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: '#8b98a5', font: { size: 10 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: '#8b98a5', precision: 0 }, grid: { color: '#2c3947' } },
      },
    },
  });
}

// Metrics of a sign-in set (the 6 summary numbers).
function metricsOf(signIns) {
  const apps = new Set(signIns.map((s) => s.appDisplayName).filter(Boolean));
  const ips = new Set(signIns.map((s) => s.ipAddress).filter(Boolean));
  const countries = new Set(signIns.map((s) => s.location && s.location.countryOrRegion).filter(Boolean));
  return {
    totalSignIns: signIns.length,
    successfulSignIns: signIns.filter((s) => s.status.errorCode === 0).length,
    failedSignIns: signIns.filter((s) => s.status.errorCode !== 0).length,
    uniqueApps: apps.size,
    uniqueIps: ips.size,
    uniqueCountries: countries.size,
  };
}

async function fetchTenant(days) {
  if (STATE.tenantPending === days) return;
  STATE.tenantPending = days;
  try {
    const res = await fetch(`/api/tenant-average?days=${days}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to compute tenant baseline.');
    STATE.tenantCache[days] = data;
  } catch (e) {
    if (STATE.baselineKind === 'tenant') {
      $('#comparison-body').innerHTML = `<p class="muted">❌ ${esc(e.message)}</p>`;
    }
  } finally {
    STATE.tenantPending = null;
    if (STATE.baselineKind === 'tenant') renderBaseline();
  }
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function deltaCell(user, base) {
  const d = user - base;
  const sign = d > 0 ? '+' : '';
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '=';
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : 'muted';
  return `<td class="delta ${cls}">${arrow} ${sign}${fmt(d)}</td>`;
}

const METRIC_ROWS = [
  ['Total sign-ins', 'totalSignIns'],
  ['Successful', 'successfulSignIns'],
  ['Failures', 'failedSignIns'],
  ['Unique apps', 'uniqueApps'],
  ['Unique IPs', 'uniqueIps'],
  ['Countries', 'uniqueCountries'],
];

function renderBaseline() {
  const card = $('#comparison-card');
  if (!STATE.baselineKind || !STATE.data) { card.classList.add('hidden'); return; }
  card.classList.remove('hidden');

  const userMetrics = metricsOf(STATE.filtered);
  const userLicenses = (STATE.data.licenses || []).length;
  const userPriv = STATE.data.summary.hasPrivilegedAccess;
  const periodLabel = STATE.days === 1 ? 'last 24h' : `last ${STATE.days} days`;

  let baseLabel, base, baseLicenses, privRow;

  if (STATE.baselineKind === 'compare') {
    const b = STATE.compareData;
    const bFiltered = filterByDays(b.signIns, STATE.days);
    base = metricsOf(bFiltered);
    baseLicenses = (b.licenses || []).length;
    baseLabel = b.user.displayName || b.user.userPrincipalName || 'User B';
    $('#comparison-title').textContent = `⚖️ ${STATE.data.user.displayName || 'User'} vs ${baseLabel} — ${periodLabel}`;
    privRow = `<tr><td>Privileged access</td><td>${userPriv ? 'Yes' : 'No'}</td><td>${base && b.summary.hasPrivilegedAccess ? 'Yes' : 'No'}</td><td class="muted">—</td></tr>`;
  } else {
    const t = STATE.tenantCache[STATE.days];
    $('#comparison-title').textContent = `📊 ${STATE.data.user.displayName || 'User'} vs Tenant average — ${periodLabel}`;
    if (!t) {
      $('#comparison-chart-box').style.display = 'none';
      if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
      $('#comparison-body').innerHTML = '<p class="muted">⏳ Sampling tenant users and computing the average… this can take a moment.</p>';
      fetchTenant(STATE.days);
      return;
    }
    base = t.avg;
    baseLicenses = t.avg.licenses;
    baseLabel = `Tenant avg (sample ${t.sampleSize})`;
    privRow = `<tr><td>Privileged access</td><td>${userPriv ? 'Yes' : 'No'}</td><td>${t.pctPrivileged.toFixed(0)}% of users</td><td class="muted">—</td></tr>`;
  }

  const rows = METRIC_ROWS.map(([label, key]) =>
    `<tr><td>${label}</td><td>${fmt(userMetrics[key])}</td><td>${fmt(base[key])}</td>${deltaCell(userMetrics[key], base[key])}</tr>`
  ).join('');

  $('#comparison-body').innerHTML = `
    <table class="cmp-table">
      <thead><tr><th>Metric</th><th>${esc(STATE.data.user.displayName || 'User')}</th><th>${esc(baseLabel)}</th><th>Δ</th></tr></thead>
      <tbody>
        ${rows}
        <tr><td>Licenses</td><td>${fmt(userLicenses)}</td><td>${fmt(baseLicenses)}</td>${deltaCell(userLicenses, baseLicenses)}</tr>
        ${privRow}
      </tbody>
    </table>
    <p class="cmp-note">${STATE.baselineKind === 'tenant'
      ? 'Tenant average is a sampled estimate (per-user values are capped) — directional, not exact.'
      : 'Both users compared over the same selected period.'}</p>`;

  // Grouped bar chart of the same metrics.
  const chartLabels = ['Total', 'Success', 'Failures', 'Apps', 'IPs', 'Countries', 'Licenses'];
  const userVals = METRIC_ROWS.map(([, k]) => userMetrics[k]).concat(userLicenses);
  const baseVals = METRIC_ROWS.map(([, k]) => base[k]).concat(baseLicenses);
  renderComparisonChart(chartLabels, userVals, baseVals, STATE.data.user.displayName || 'User', baseLabel);
}

function computeSummary(signIns, roles) {
  const apps = new Set(signIns.map((s) => s.appDisplayName).filter(Boolean));
  const ips = new Set(signIns.map((s) => s.ipAddress).filter(Boolean));
  const countries = new Set(signIns.map((s) => s.location && s.location.countryOrRegion).filter(Boolean));
  return {
    totalSignIns: signIns.length,
    successfulSignIns: signIns.filter((s) => s.status.errorCode === 0).length,
    failedSignIns: signIns.filter((s) => s.status.errorCode !== 0).length,
    uniqueApps: apps.size,
    uniqueIps: ips.size,
    uniqueCountries: countries.size,
    hasPrivilegedAccess: roles.some((r) => r.isPrivileged),
  };
}

function renderProfile(u, summary) {
  const avatar = $('#profile-avatar');
  if (u.photoDataUri) {
    avatar.innerHTML = `<img src="${u.photoDataUri}" alt="Photo" />`;
  } else {
    const initials = (u.displayName || u.userPrincipalName || '?')
      .split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
    avatar.innerHTML = `<span>${esc(initials)}</span>`;
  }

  const fields = STATE.mode === 'tenant'
    ? [
        ['Organization', u.displayName],
        ['Primary domain', u.userPrincipalName],
        ['Country', u.department],
        ['Devices (tenant)', String(STATE.data.deviceCount || 0)],
        ['Created', u.createdDateTime ? new Date(u.createdDateTime).toLocaleDateString() : '-'],
        ['Tenant ID', u.id],
      ]
    : [
        ['Name', u.displayName],
        ['UPN', u.userPrincipalName],
        ['Email', u.mail],
        ['Job title', u.jobTitle],
        ['Department', u.department],
        ['Account enabled', u.accountEnabled === null ? '-' : u.accountEnabled ? 'Yes' : 'No'],
        ['Devices', String((STATE.data.devices || []).length)],
        ['Created', u.createdDateTime ? new Date(u.createdDateTime).toLocaleDateString() : '-'],
        ['Object ID', u.id],
      ];
  $('#profile').innerHTML = fields
    .map(([label, val]) => `<div><span>${label}</span><strong>${esc(val || '-')}</strong></div>`)
    .join('');

  const banner = $('#priv-banner');
  if (STATE.mode === 'tenant') {
    banner.innerHTML = `<div class="banner info">🏢 Tenant-wide overview — ${STATE.data.privilegedAssignments || 0} privileged role assignments · ${(STATE.data.licenses || []).length} subscriptions.</div>`;
  } else if (summary.hasPrivilegedAccess) {
    banner.innerHTML = `<div class="banner danger">⚠️ User HAS privileged access in the directory.</div>`;
  } else {
    banner.innerHTML = `<div class="banner safe">✔️ No privileged role directly assigned.</div>`;
  }
}

function renderSummary(s) {
  const metrics = [
    { key: 'total', label: 'Total sign-ins', value: s.totalSignIns, cls: '' },
    { key: 'success', label: 'Successful', value: s.successfulSignIns, cls: 'green' },
    { key: 'fail', label: 'Failures', value: s.failedSignIns, cls: 'red' },
    { key: 'apps', label: 'Unique apps', value: s.uniqueApps, cls: '' },
    { key: 'ips', label: 'Unique IPs', value: s.uniqueIps, cls: '' },
    { key: 'countries', label: 'Countries', value: s.uniqueCountries, cls: '' },
  ];
  $('#summary').innerHTML = metrics
    .map(
      (m) =>
        `<div class="metric clickable ${m.cls}" data-metric="${m.key}">
          <div class="value">${m.value}</div>
          <div class="label">${m.label}</div>
          <div class="hint">▸ view details</div>
        </div>`
    )
    .join('');
}

function renderRoles(roles) {
  const el = $('#roles');
  if (!roles.length) {
    el.innerHTML = '<p class="muted">No directory role assigned (or RoleManagement.Read.Directory permission missing).</p>';
    return;
  }
  el.innerHTML = roles
    .map((r) => `<span class="role-pill ${r.isPrivileged ? 'priv' : ''}" title="${esc(r.description || '')}">${r.isPrivileged ? '🔑 ' : ''}${esc(r.displayName)}</span>`)
    .join('');
}

function renderMap(signIns) {
  if (!map) {
    map = L.map('map').setView([20, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18,
    }).addTo(map);
  }
  if (markerLayer) markerLayer.clearLayers();
  else markerLayer = L.markerClusterGroup();

  const byCoord = new Map();
  for (const s of signIns) {
    const g = s.location && s.location.geoCoordinates;
    if (!g || g.latitude == null || g.longitude == null) continue;
    const key = `${g.latitude.toFixed(3)},${g.longitude.toFixed(3)}`;
    if (!byCoord.has(key)) byCoord.set(key, { lat: g.latitude, lon: g.longitude, count: 0, loc: s.location, ips: new Set() });
    const entry = byCoord.get(key);
    entry.count++;
    if (s.ipAddress) entry.ips.add(s.ipAddress);
  }

  const bounds = [];
  for (const e of byCoord.values()) {
    const place = [e.loc.city, e.loc.state, e.loc.countryOrRegion].filter(Boolean).join(', ');
    const m = L.marker([e.lat, e.lon]).bindPopup(
      `<b>${esc(place || 'Unknown')}</b><br>Accesses: ${e.count}<br>IPs: ${esc([...e.ips].join(', ') || '-')}`
    );
    markerLayer.addLayer(m);
    bounds.push([e.lat, e.lon]);
  }
  map.addLayer(markerLayer);
  if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  setTimeout(() => map.invalidateSize(), 100);
}

// Daily timeline of successful vs failed sign-ins.
function renderTimeline(signIns) {
  const byDay = new Map();
  for (const s of signIns) {
    const d = new Date(s.createdDateTime);
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!byDay.has(key)) byDay.set(key, { success: 0, fail: 0 });
    const b = byDay.get(key);
    if (s.status.errorCode === 0) b.success++;
    else b.fail++;
  }
  const days = [...byDay.keys()].sort();
  const labels = days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString());
  const success = days.map((d) => byDay.get(d).success);
  const fail = days.map((d) => byDay.get(d).fail);

  if (timelineChart) timelineChart.destroy();
  timelineChart = new Chart(document.getElementById('timeline-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Success', data: success, borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.15)', fill: true, tension: 0.3, pointRadius: 2 },
        { label: 'Failures', data: fail, borderColor: '#f85149', backgroundColor: 'rgba(248,81,73,0.15)', fill: true, tension: 0.3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: '#e6edf3' } } },
      scales: {
        x: { ticks: { color: '#8b98a5', maxRotation: 0, autoSkip: true }, grid: { color: '#2c3947' } },
        y: { beginAtZero: true, ticks: { color: '#8b98a5', precision: 0 }, grid: { color: '#2c3947' } },
      },
    },
  });
}

function renderLicenses(licenses) {
  $('#license-count').textContent = licenses.length;
  const el = $('#licenses');
  if (!licenses.length) {
    el.innerHTML = '<p class="muted">No licenses assigned (or User.Read.All / Directory.Read.All permission missing).</p>';
    return;
  }
  el.innerHTML = licenses
    .map(
      (l, i) =>
        `<span class="license-pill" data-idx="${i}" title="${esc(l.skuPartNumber)} · ${l.enabledServices.length} services enabled — click for details">🎫 ${esc(l.displayName)} <em>(${l.enabledServices.length})</em></span>`
    )
    .join('');
}

// Click a license pill -> show enabled service plans in the detail modal.
$('#licenses').addEventListener('click', (e) => {
  const pill = e.target.closest('.license-pill[data-idx]');
  if (!pill || !STATE.data) return;
  const lic = (STATE.data.licenses || [])[Number(pill.dataset.idx)];
  if (lic) openLicenseDetail(lic);
});

function openLicenseDetail(lic) {
  $('#detail-title').textContent = `License: ${lic.displayName} (${lic.skuPartNumber})`;
  const services = lic.enabledServices || [];
  $('#detail-body').innerHTML = services.length
    ? `<table><thead><tr><th>#</th><th>Enabled service plan</th></tr></thead><tbody>${services
        .slice()
        .sort()
        .map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="empty">No enabled service plans.</p>';
  detailOverlay.classList.remove('hidden');
}

// Tool key: the accessed resource (the actual M365 service), falling back to the client app.
function toolKey(s) {
  return s.resourceDisplayName || s.appDisplayName;
}

// Shared doughnut builder with a "sign-in events" tooltip.
function drawDoughnut(existing, canvasId, counts) {
  if (existing) existing.destroy();
  return new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    data: {
      labels: counts.map((c) => c[0]),
      datasets: [{ data: counts.map((c) => c[1]), backgroundColor: TOOL_COLORS, borderColor: '#1a2129', borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0) || 1;
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

// Doughnut of usage share across the top M365 resources/services.
function renderToolsUsage(signIns) {
  toolsUsageChart = drawDoughnut(toolsUsageChart, 'tools-usage-chart', topCounts(signIns.map(toolKey), 8));
}

// Doughnut of the top client apps the user signed in through.
function renderAppsUsage(signIns) {
  appsUsageChart = drawDoughnut(appsUsageChart, 'apps-usage-chart', topCounts(signIns.map((s) => s.appDisplayName), 8));
}

// Multi-line timeline of access per top M365 tool over time.
function renderToolsTimeline(signIns) {
  const top = topCounts(signIns.map(toolKey), 5).map((c) => c[0]);
  const byDay = new Map();
  const daySet = new Set();
  for (const s of signIns) {
    const d = new Date(s.createdDateTime);
    if (isNaN(d.getTime())) continue;
    const tool = toolKey(s);
    if (!tool || !top.includes(tool)) continue;
    const day = d.toISOString().slice(0, 10);
    daySet.add(day);
    if (!byDay.has(day)) byDay.set(day, {});
    const b = byDay.get(day);
    b[tool] = (b[tool] || 0) + 1;
  }
  const days = [...daySet].sort();
  const labels = days.map((d) => new Date(d + 'T00:00:00').toLocaleDateString());
  const datasets = top.map((tool, i) => ({
    label: tool,
    data: days.map((d) => (byDay.get(d) || {})[tool] || 0),
    borderColor: TOOL_COLORS[i % TOOL_COLORS.length],
    backgroundColor: 'transparent',
    tension: 0.3,
    pointRadius: 2,
  }));

  if (toolsTimelineChart) toolsTimelineChart.destroy();
  toolsTimelineChart = new Chart(document.getElementById('tools-timeline-chart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#e6edf3', boxWidth: 12, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#8b98a5', maxRotation: 0, autoSkip: true }, grid: { color: '#2c3947' } },
        y: { beginAtZero: true, ticks: { color: '#8b98a5', precision: 0 }, grid: { color: '#2c3947' } },
      },
    },
  });
}

function renderCharts(signIns) {
  const apps = topCounts(signIns.map((s) => s.appDisplayName), 8);
  const ips = topCounts(signIns.map((s) => s.ipAddress), 8);
  appsChart = drawBar(appsChart, 'apps-chart', apps, '#2f81f7');
  ipsChart = drawBar(ipsChart, 'ips-chart', ips, '#3fb950');
}

function topCounts(arr, n) {
  const counts = {};
  for (const v of arr) {
    if (!v) continue;
    counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function drawBar(existing, canvasId, data, color) {
  if (existing) existing.destroy();
  return new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: {
      labels: data.map((d) => d[0]),
      datasets: [{ data: data.map((d) => d[1]), backgroundColor: color }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#8b98a5' }, grid: { color: '#2c3947' } },
        y: { ticks: { color: '#e6edf3' }, grid: { display: false } },
      },
    },
  });
}

function renderTable(signIns) {
  const sorted = signIns.slice().sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime));
  const total = sorted.length;
  $('#signin-count').textContent = total;

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (STATE.tablePage > pages) STATE.tablePage = pages;
  if (STATE.tablePage < 1) STATE.tablePage = 1;
  const start = (STATE.tablePage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(start, start + PAGE_SIZE);

  const rows = pageRows
    .map((s) => {
      const ok = s.status.errorCode === 0;
      const place = s.location ? [s.location.city, s.location.countryOrRegion].filter(Boolean).join(', ') : '-';
      const risk = (s.riskLevelDuringSignIn || 'none');
      const riskCls = risk === 'high' ? 'risk-high' : risk === 'medium' ? 'risk-medium' : 'muted';
      const who = s.userDisplayName || s.userPrincipalName || '-';
      return `<tr>
        <td>${esc(new Date(s.createdDateTime).toLocaleString())}</td>
        <td class="col-user">${esc(who)}</td>
        <td>${esc(s.appDisplayName || '-')}</td>
        <td class="${ok ? 'ok' : 'fail'}">${ok ? 'Success' : 'Failure (' + s.status.errorCode + ')'}</td>
        <td>${esc(s.ipAddress || '-')}</td>
        <td>${esc(place || '-')}</td>
        <td>${esc(s.clientAppUsed || '-')}</td>
        <td class="${riskCls}">${esc(risk)}</td>
      </tr>`;
    })
    .join('');
  $('#signins-table tbody').innerHTML = rows || '<tr><td colspan="8" class="muted">No sign-in records.</td></tr>';
  renderPager(total, pages);
}

function renderPager(total, pages) {
  const el = $('#signins-pager');
  if (total <= PAGE_SIZE) { el.innerHTML = ''; return; }
  const p = STATE.tablePage;
  const from = (p - 1) * PAGE_SIZE + 1;
  const to = Math.min(p * PAGE_SIZE, total);
  el.innerHTML = `
    <button type="button" data-action="first" ${p <= 1 ? 'disabled' : ''}>« First</button>
    <button type="button" data-action="prev" ${p <= 1 ? 'disabled' : ''}>‹ Prev</button>
    <span>Page ${p} / ${pages} — ${from}–${to} of ${total}</span>
    <button type="button" data-action="next" ${p >= pages ? 'disabled' : ''}>Next ›</button>
    <button type="button" data-action="last" ${p >= pages ? 'disabled' : ''}>Last »</button>`;
}

$('#signins-pager').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b || !STATE.filtered) return;
  const pages = Math.max(1, Math.ceil(STATE.filtered.length / PAGE_SIZE));
  const a = b.dataset.action;
  if (a === 'first') STATE.tablePage = 1;
  else if (a === 'prev') STATE.tablePage = Math.max(1, STATE.tablePage - 1);
  else if (a === 'next') STATE.tablePage = Math.min(pages, STATE.tablePage + 1);
  else if (a === 'last') STATE.tablePage = pages;
  renderTable(STATE.filtered);
});

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
