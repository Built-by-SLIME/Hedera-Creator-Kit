import express, { Request, Response } from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import { previewCollection } from './routes/preview';
import { generateCollection } from './routes/generate';
import { uploadLayers } from './routes/upload-layers';
import { previewFromSession } from './routes/preview-session';
import { generateFromSession } from './routes/generate-session';
import { pinCollectionMetadata } from './routes/pin-collection-metadata';
import { pinNftMetadata } from './routes/pin-nft-metadata';


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

app.post('/api/pin-nft-metadata', imageUpload.fields([
  { name: 'image', maxCount: 1 },
]), (req, res, next) => {
  pinNftMetadata(req, res).catch(next);
});



// Health check
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
app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`🚀 Art Generator API Server running on 0.0.0.0:${PORT}`);
});

export default app;

