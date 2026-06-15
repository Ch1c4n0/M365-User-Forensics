import 'dotenv/config';
import express, { Request, Response } from 'express';
import path from 'path';
import {
  analyzeUser,
  setCredentials,
  getCredentialsStatus,
  testConnection,
  getCompanyLogo,
  getTenantBaseline,
  getTenantOverview,
} from './graph';

const TENANT_SAMPLE = parseInt(process.env.TENANT_SAMPLE || '20', 10);

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.use(express.json());
// no-store prevents the browser from holding stale versions of static files.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
);

// Docker healthcheck.
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Current credentials state (without exposing the secret).
app.get('/api/config', (_req: Request, res: Response) => {
  res.json(getCredentialsStatus());
});

// Saves the Service Principal credentials entered through the gear panel.
app.post('/api/config', (req: Request, res: Response) => {
  const { tenantId, clientId, clientSecret, workspaceId } = req.body || {};
  if (!tenantId || !clientId || !clientSecret) {
    res.status(400).json({ error: 'tenantId, clientId and clientSecret are required.' });
    return;
  }
  setCredentials({ tenantId, clientId, clientSecret, workspaceId });
  res.json({ ok: true, status: getCredentialsStatus() });
});

// Tests the Graph connection using the current credentials.
app.post('/api/config/test', async (_req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err?.message || 'Failed to connect to Graph.' });
  }
});

// Company branding logo (best-effort).
app.get('/api/branding', async (_req: Request, res: Response) => {
  try {
    const logo = await getCompanyLogo();
    res.json({ logo });
  } catch (err: any) {
    res.json({ logo: null });
  }
});

// Tenant-wide overview (dashboard shown right after configuring credentials).
app.get('/api/tenant-overview', async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days || ''), 10) || 30;
  try {
    const result = await getTenantOverview(days);
    res.json(result);
  } catch (err: any) {
    console.error('Tenant overview error:', err);
    res.status(500).json({ error: err?.message || 'Failed to build tenant overview.' });
  }
});

// Tenant baseline (sampled average) for the "Tenant average" button.
app.get('/api/tenant-average', async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days || ''), 10) || 30;
  const sample = parseInt(String(req.query.sample || ''), 10) || TENANT_SAMPLE;
  try {
    const result = await getTenantBaseline(days, Math.min(Math.max(sample, 1), 50));
    res.json(result);
  } catch (err: any) {
    console.error('Tenant baseline error:', err);
    res.status(500).json({ error: err?.message || 'Failed to compute tenant baseline.' });
  }
});

// Main analysis API.
app.get('/api/analyze', async (req: Request, res: Response) => {
  const identifier = String(req.query.user || '').trim();
  if (!identifier) {
    res.status(400).json({ error: 'Provide the "user" parameter (UPN, email or objectId).' });
    return;
  }

  const source = req.query.source === 'loganalytics' ? 'loganalytics' : 'graph';
  const days = parseInt(String(req.query.days || ''), 10) || undefined;

  try {
    const result = await analyzeUser(identifier, { source, days });
    res.json(result);
  } catch (err: any) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: err?.message || 'Internal error while querying the data source.' });
  }
});

app.listen(PORT, () => {
  console.log(`M365 User Forensics running at http://localhost:${PORT}`);
});
