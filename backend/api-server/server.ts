// Hedera Creator Kit — API Server
import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import swaggerDocument from './swagger.json';
import { previewCollection } from './routes/preview';
import { generateCollection } from './routes/generate';
import { uploadLayers } from './routes/upload-layers';
import { previewFromSession } from './routes/preview-session';
import { generateFromSession } from './routes/generate-session';
import { pinCollectionMetadata } from './routes/pin-collection-metadata';
import { pinNftMetadata } from './routes/pin-nft-metadata';
import { mintNfts } from './routes/mint-nfts';
import { calculateMintFee } from './routes/calculate-mint-fee';
import {
  createSwapProgram,
  listSwapPrograms,
  listPublicSwapPrograms,
  updateSwapStatus,
  deleteSwapProgram,
  executeSwap,
  prepareSwap,
  submitSwap,
} from './routes/swap';
import {
  initTopics,
  checkDomain,
  registerDomain,
  listDomainsByTld,
  listDomainsByOwner,
  transferDomain,
  renewDomain,
  resolveDomain,
  purgeRegistrations,
} from './routes/domains';
import {
  createStakingProgram,
  listStakingPrograms,
  listPublicStakingPrograms,
  updateStakingStatus,
  deleteStakingProgram,
  markAllowanceGranted,
  registerParticipant,
  listParticipants,
  listDistributions,
  triggerDrip,
  runAllDrips,
  resetDistributionClock,
} from './routes/staking';
import {
  externalListPrograms,
  externalGetProgram,
  externalGetPosition,
  externalGetEligibility,
  externalRegister,
  externalListParticipants,
  externalListDistributions,
} from './routes/staking-external';
import { generateApiKey } from './routes/admin';
import { requireApiKey, requireProgramOwnership } from './middleware/auth';
import { insertSnapshotCredits, clearAndReinsertSnapshotCredits } from '../scripts/insert-snapshot-credits-direct';
import { initDb, pool } from './db';


// Resolve the backend root directory regardless of ts-node vs compiled mode.
// ts-node:  __dirname = <repo>/backend/api-server
// compiled: __dirname = <repo>/backend/dist/api-server
export const BACKEND_ROOT = __dirname.includes('dist')
  ? path.join(__dirname, '../..')   // dist/api-server -> backend
  : path.join(__dirname, '..');     // api-server      -> backend

dotenv.config({ path: path.join(BACKEND_ROOT, '.env') });

const app = express();
const PORT = process.env.PORT || process.env.API_PORT || 3001;

// Middleware
app.use(cors({
  origin: true,              // reflect any requesting origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = path.join(BACKEND_ROOT, 'temp-uploads');
      await fs.ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed') {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed'));
    }
  }
});

// Multer for image uploads (collection image, etc.)
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = path.join(BACKEND_ROOT, 'temp-uploads');
      await fs.ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max for images
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Session storage for preview tracking
export const previewSessions = new Map<string, { count: number; lastAccess: number }>();

// Clean up old sessions every hour
setInterval(() => {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  
  for (const [sessionId, session] of previewSessions.entries()) {
    if (now - session.lastAccess > ONE_HOUR) {
      previewSessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);

// Routes
app.post('/api/upload-layers', upload.single('zipFile'), uploadLayers);
app.post('/api/preview-collection', upload.single('zipFile'), previewCollection);
app.post('/api/generate-collection', upload.single('zipFile'), generateCollection);
app.post('/api/preview-session', previewFromSession);
app.post('/api/generate-session', generateFromSession);
app.post('/api/pin-collection-metadata', imageUpload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 },
  { name: 'featuredImage', maxCount: 1 },
]), (req, res, next) => {
  pinCollectionMetadata(req, res).catch(next);
});

// Multer for NFT media uploads — accepts images OR MP4 video (for HIP-412 video NFTs)
const nftMediaUpload = multer({
  storage: multer.diskStorage({
    destination: async (req, file, cb) => {
      const uploadDir = path.join(BACKEND_ROOT, 'temp-uploads');
      await fs.ensureDir(uploadDir);
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${uuidv4()}-${file.originalname}`;
      cb(null, uniqueName);
    }
  }),
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB — accommodates MP4s
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype === 'video/mp4') {
      cb(null, true);
    } else {
      cb(new Error('Only image files or MP4 video files are allowed'));
    }
  }
});

app.post('/api/pin-nft-metadata', nftMediaUpload.fields([
  { name: 'image', maxCount: 1 },
]), (req, res, next) => {
  pinNftMetadata(req, res).catch(next);
});

app.post('/api/calculate-mint-fee', (req, res, next) => {
  calculateMintFee(req, res).catch(next);
});

app.post('/api/mint-nfts', (req, res, next) => {
  mintNfts(req, res).catch(next);
});

// Swap program routes
app.post('/api/swap-programs', (req, res, next) => createSwapProgram(req, res).catch(next));
app.get('/api/swap-programs', (req, res, next) => listSwapPrograms(req, res).catch(next));
app.get('/api/swap-programs/public', (req, res, next) => listPublicSwapPrograms(req, res).catch(next));
app.put('/api/swap-programs/:id/status', (req, res, next) => updateSwapStatus(req, res).catch(next));
app.delete('/api/swap-programs/:id', (req, res, next) => deleteSwapProgram(req, res).catch(next));
app.post('/api/swap-programs/:id/prepare', (req, res, next) => prepareSwap(req, res).catch(next));
app.post('/api/swap-programs/:id/submit', (req, res, next) => submitSwap(req, res).catch(next));
app.post('/api/swap-programs/:id/execute', (req, res, next) => executeSwap(req, res).catch(next));

// Staking program routes
app.post('/api/staking-programs',                         (req, res, next) => createStakingProgram(req, res).catch(next));
app.get('/api/staking-programs',                          (req, res, next) => listStakingPrograms(req, res).catch(next));
app.get('/api/staking-programs/public',                   (req, res, next) => listPublicStakingPrograms(req, res).catch(next));
app.post('/api/staking-programs/run-all-drips',           (req, res, next) => runAllDrips(req, res).catch(next));
app.post('/api/staking-programs/reset-distribution-clock',(req, res, next) => resetDistributionClock(req, res).catch(next));
app.post('/api/staking-programs/insert-snapshot-credits',(req, res, next) => insertSnapshotCredits(req, res).catch(next));
app.post('/api/staking-programs/clear-and-reinsert-snapshot',(req, res, next) => clearAndReinsertSnapshotCredits(req, res).catch(next));

// Diagnostic endpoint to check serial credits
app.get('/api/staking-programs/:id/check-serial/:serial', async (req, res) => {
  try {
    const { id, serial } = req.params;
    const result = await pool.query(
      `SELECT * FROM staking_nft_period_credits WHERE program_id = $1 AND nft_serial = $2`,
      [id, parseInt(serial)]
    );
    const programInfo = await pool.query(
      `SELECT last_distributed_at FROM staking_programs WHERE id = $1`,
      [id]
    );
    res.json({
      serial: parseInt(serial),
      found: (result.rowCount ?? 0) > 0,
      credits: result.rows,
      program_last_distributed_at: programInfo.rows[0]?.last_distributed_at
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/staking-programs/:id/status',               (req, res, next) => updateStakingStatus(req, res).catch(next));
app.put('/api/staking-programs/:id/allowance',            (req, res, next) => markAllowanceGranted(req, res).catch(next));
app.delete('/api/staking-programs/:id',                   (req, res, next) => deleteStakingProgram(req, res).catch(next));
app.post('/api/staking-programs/:id/register',            (req, res, next) => registerParticipant(req, res).catch(next));
app.get('/api/staking-programs/:id/participants',         (req, res, next) => listParticipants(req, res).catch(next));
app.get('/api/staking-programs/:id/distributions',        (req, res, next) => listDistributions(req, res).catch(next));
app.post('/api/staking-programs/:id/drip',                (req, res, next) => triggerDrip(req, res).catch(next));

// Domain registration routes
app.post('/api/domains/init-topics',                  (req, res, next) => initTopics(req, res).catch(next));
app.get('/api/domains/check',                         (req, res, next) => checkDomain(req, res).catch(next));
app.post('/api/domains/register',                     (req, res, next) => registerDomain(req, res).catch(next));
app.post('/api/domains/renew',                        (req, res, next) => renewDomain(req, res).catch(next));
app.get('/api/domains/resolve/:name/:tld',            (req, res, next) => resolveDomain(req, res).catch(next));
app.get('/api/domains/list/:tld',                     (req, res, next) => listDomainsByTld(req, res).catch(next));
app.get('/api/domains/owned/:accountId',              (req, res, next) => listDomainsByOwner(req, res).catch(next));
app.post('/api/domains/admin/purge-registrations',    (req, res, next) => purgeRegistrations(req, res).catch(next));

// ─── External API (v1) ────────────────────────────────────────────────────
// Staking — external endpoints for third-party integrations (API key + program ownership required)
const stakingExternal = express.Router();
stakingExternal.get('/staking-programs',                    (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalListPrograms(req, res).catch(next));
stakingExternal.get('/staking-programs/:id',                 (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalGetProgram(req, res).catch(next));
stakingExternal.get('/staking-programs/:id/position/:accountId', (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalGetPosition(req, res).catch(next));
stakingExternal.get('/staking-programs/:id/eligibility/:accountId', (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalGetEligibility(req, res).catch(next));
stakingExternal.post('/staking-programs/:id/register',       (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalRegister(req, res).catch(next));
stakingExternal.get('/staking-programs/:id/participants',     (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalListParticipants(req, res).catch(next));
stakingExternal.get('/staking-programs/:id/distributions',   (req, res, next) => requireApiKey(req, res, next), (req, res, next) => externalListDistributions(req, res).catch(next));
app.use('/api/v1/external', stakingExternal);

// Admin — API key generation (protected by DRIP_SECRET)
app.post('/api/admin/api-keys', (req, res, next) => generateApiKey(req, res).catch(next));

// SLIME logo for Swagger UI header
app.get('/slime-logo.png', (req: Request, res: Response) => {
  const logoPath = path.resolve('/Users/davidconklin/Hedera-toolkit/SLIMEGraphic.png');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(logoPath);
});

// Swagger JSON spec (for programmatic consumption)
app.get('/api-docs.json', (req: Request, res: Response) => {
  res.json(swaggerDocument);
});

// Swagger UI — self-contained HTML, dark theme, SLIME branded. Zero npm dependencies.
app.get('/api-docs', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SLIME Tools — External API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.20.0/swagger-ui.css">
  <style>
    body { margin: 0; background: #15202B; }
    .swagger-ui { background: #15202B; color: #e2e8f0; }
    .swagger-ui .topbar { display: none; }
    .swagger-ui .info { margin: 20px 0; }
    .swagger-ui .info .title { color: #fff; font-size: 1.8rem; font-weight: 700; }
    .swagger-ui .info .title small { background: #00ff40; color: #000; font-weight: 700; }
    .swagger-ui .info p, .swagger-ui .info li { color: #94a3b8; }
    .swagger-ui .info a { color: #00ff40; }
    .swagger-ui .scheme-container { background: #15202B; box-shadow: none; border: 1px solid #1e293b; }
    .swagger-ui .schemes > .schemes-server-container > .servers > label { color: #94a3b8; }
    .swagger-ui .opblock { background: #111827; border: 1px solid #1e293b; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
    .swagger-ui .opblock .opblock-summary { border-bottom: 1px solid #1e293b; }
    .swagger-ui .opblock .opblock-summary-method { border-radius: 4px; font-weight: 700; }
    .swagger-ui .opblock .opblock-summary-path { color: #e2e8f0; }
    .swagger-ui .opblock .opblock-summary-description { color: #94a3b8; }
    .swagger-ui .opblock-tag { color: #fff; font-size: 1.1rem; font-weight: 600; border-bottom: 1px solid #1e293b; }
    .swagger-ui .opblock-tag-section .operations-container { padding-top: 8px; }
    .swagger-ui .tab li { color: #94a3b8; }
    .swagger-ui .tab li.active { color: #fff; }
    .swagger-ui .opblock-body { background: #0f172a; }
    .swagger-ui .execute-wrapper { padding: 16px; }
    .swagger-ui .responses-wrapper { padding: 16px; }
    .swagger-ui .responses-inner h4, .swagger-ui .responses-inner h5 { color: #e2e8f0; }
    .swagger-ui table thead tr td, .swagger-ui table thead tr th { color: #94a3b8; border-bottom: 1px solid #1e293b; }
    .swagger-ui table tbody tr td { color: #e2e8f0; border-bottom: 1px solid #1e293b; }
    .swagger-ui .parameter__name { color: #e2e8f0; }
    .swagger-ui .parameter__type { color: #00ff40; }
    .swagger-ui .markdown, .swagger-ui .renderedMarkdown { color: #94a3b8; }
    .swagger-ui .markdown p, .swagger-ui .renderedMarkdown p { color: #94a3b8; }
    .swagger-ui .model { color: #e2e8f0; }
    .swagger-ui .model-title { color: #fff; }
    .swagger-ui .prop-type { color: #00ff40; }
    .swagger-ui .prop-format { color: #64748b; }
    .swagger-ui .response-col_status { color: #e2e8f0; font-weight: 700; }
    .swagger-ui .response-col_description { color: #94a3b8; }
    .swagger-ui .highlight-code .microlight { background: #0f172a !important; color: #e2e8f0 !important; }
    .swagger-ui .download-contents { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
    .swagger-ui .auth-container { background: #15202B; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
    .swagger-ui .auth-container .wrapper { color: #e2e8f0; }
    .swagger-ui .auth-container input[type=text] { background: #0f172a; color: #e2e8f0; border: 1px solid #334155; }
    .swagger-ui .btn.authorize { background: transparent; border-color: #00ff40; color: #00ff40; }
    .swagger-ui .btn.authorize svg { fill: #00ff40; }
    .swagger-ui .btn.execute { background: #00ff40; color: #000; font-weight: 700; border: none; }
    .swagger-ui .btn.execute:hover { background: #00e639; }
    .swagger-ui .curl-command { background: #0f172a; color: #e2e8f0; }
    /* ─── Unify all POST greens to #00ff40 ─── */
    .swagger-ui .opblock.opblock-post { border-color: #00ff40; }
    .swagger-ui .opblock.opblock-post .opblock-summary { border-color: #00ff40; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #00ff40; color: #000; }
    .swagger-ui .opblock.opblock-post .opblock-body { border-color: #00ff40; background: #0f172a; }
    .swagger-ui .opblock.opblock-post .opblock-section-header { background: rgba(0,255,64,0.05); }
    .swagger-ui .opblock.opblock-post .execute-wrapper .btn { background: #00ff40; color: #000; }
    .swagger-ui .opblock.opblock-post .execute-wrapper .btn:hover { background: #00e639; }
    .swagger-ui .opblock.opblock-post .try-out__btn { color: #00ff40; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.20.0/swagger-ui-bundle.js"></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.20.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api-docs.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: 'StandaloneLayout',
      validatorUrl: null,
    });
  </script>
</body>
</html>`);
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Start server — bind to 0.0.0.0 so Railway's proxy can reach the app
initDb()
  .then(() => {
    app.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`Art Generator API Server running on 0.0.0.0:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

export default app;

