// server.js - VERSION CORRIGÉE
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const pool = require('./db');

const app = express();

/* ----------------------------
   CORS CORRIGÉ
   ---------------------------- */
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:8080',
  'http://localhost:3000',
  'https://c4e-website-front.onrender.com',
  'https://www.c4e-africa.com',
  'https://c4e-africa.com',
  'https://www.cdc-africa.com',
  'https://cdc-africa.com'
];

const allowedOrigins = envOrigins.length ? envOrigins : defaultOrigins;
console.log('✅ Allowed origins:', allowedOrigins);

app.set('trust proxy', 1);

// CORRECTION CORS - Configuration améliorée
const corsOptions = {
  origin: function (origin, callback) {
    // Autoriser les requêtes sans origin (curl, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Vérifier si l'origine est dans la liste autorisée
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.log('🚫 CORS blocked:', origin);
    return callback(new Error('CORS: Origin non autorisée'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Gestion explicite des preflight OPTIONS pour toutes les routes
app.options('*', cors(corsOptions));

app.use(express.json({ limit: '10mb' }));

/* ----------------------------
   MIDDLEWARE CORS SPÉCIFIQUE POUR /contact
   ---------------------------- */
app.use('/contact', (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Répondre directement aux preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

/* ----------------------------
   Routes
   ---------------------------- */
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const candidaturesRoutes = require('./routes/candidatures');
const candidaturesSpontaneesRoutes = require('./routes/candidaturesSpontanees');
const offresRoutes = require('./routes/offres');

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/contact', contactRoutes);
app.use('/api/candidatures', candidaturesRoutes);
app.use('/api/offres', offresRoutes);
app.use('/api/candidatures/spontanees', candidaturesSpontaneesRoutes);
/* ----------------------------
   UPLOADS (PDF seulement)
   ---------------------------- */
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = /pdf/.test(file.mimetype) && path.extname(file.originalname).toLowerCase() === '.pdf';
    return ok ? cb(null, true) : cb(new Error('Seuls les fichiers PDF sont autorisés !'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use('/uploads', express.static(uploadDir));

/* ----------------------------
   ENDPOINTS SANTÉ / DIAGNOSTIC
   ---------------------------- */
app.get('/api/health', (_req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Serveur fonctionne correctement', 
    timestamp: new Date().toISOString(),
    cors: {
      allowedOrigins: allowedOrigins,
      clientOrigin: _req.headers.origin || 'none'
    }
  });
});

app.get('/api/db/ping', async (_req, res) => {
  try {
    const r = await pool.query('SELECT current_user, current_database(), now()');
    res.json({ ok: true, result: r.rows[0] });
  } catch (e) {
    console.error('db/ping error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Endpoint de test CORS spécifique
app.get('/api/cors-test', (_req, res) => {
  res.json({ 
    message: 'CORS test réussi!',
    yourOrigin: _req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

/* ----------------------------
   UPLOADS — Emploi
   ---------------------------- */
app.post('/api/candidature-emploi', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, poste,
      type_etablissement, diplome, competences, experience, offre_id
    } = req.body;

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: { nom: !nom, prenom: !prenom, email: !email, telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath }
      });
    }

    let competencesObj = {};
    if (competences) {
      try { competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences; }
      catch { competencesObj = {}; }
    }

    const experienceInt = parseInt(experience, 10) || 0;
    const offreIdInt = offre_id ? parseInt(offre_id, 10) : null;

    const q = `
      INSERT INTO candidatures_emploi
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, type_etablissement, diplome, competences, experience, offre_id, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const vals = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, poste?.trim() || null,
      type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt, offreIdInt
    ];
    const result = await pool.query(q, vals);
    res.status(201).json({ message: '✅ Candidature emploi enregistrée.', candidature: result.rows[0] });
  } catch (err) {
    console.error('/api/candidature-emploi error:', err);
    res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

/* ----------------------------
   UPLOADS — Stage
   ---------------------------- */
app.post('/api/candidature-stage', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, domaine, duree,
      type_etablissement, diplome, competences, experience
    } = req.body;

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !domaine || !duree || !cvPath || !lettrePath) {
      return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis.' });
    }

    let competencesObj = {};
    if (competences) {
      try { competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences; }
      catch { competencesObj = {}; }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const q = `
      INSERT INTO candidatures_stage
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       domaine, duree, type_etablissement, diplome, competences, experience, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const vals = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, domaine.trim(), duree.trim(),
      type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt
    ];
    const result = await pool.query(q, vals);
    res.status(201).json({ message: '✅ Candidature stage enregistrée.', candidature: result.rows[0] });
  } catch (err) {
    console.error('/api/candidature-stage error:', err);
    res.status(500).json({ message: 'Erreur interne du serveur.', error: err.message });
  }
});

/* ----------------------------
   UPLOADS — Spontanée + score
   ---------------------------- */
app.post('/api/candidature-spontanee', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const { nom, prenom, email, telephone, poste, competences, type_etablissement, diplome, experience } = req.body;

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: { nom: !nom, prenom: !prenom, email: !email, telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath }
      });
    }

    let competencesObj = {};
    let score = 0;
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
        const vals = Object.values(competencesObj).map(v => parseInt(v, 10) || 0).filter(v => v > 0);
        if (vals.length) {
          const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
          score = Math.max(0, Math.min(100, Math.round((avg / 5) * 100)));
        }
      } catch { competencesObj = {}; }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const q = `
      INSERT INTO candidatures_spontanees
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, competences, type_etablissement, diplome, experience, score, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const vals = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, poste?.trim() || null, JSON.stringify(competencesObj),
      type_etablissement?.trim() || null, diplome?.trim() || null, experienceInt, score
    ];
    const result = await pool.query(q, vals);
    res.status(201).json({ message: `✅ Candidature spontanée enregistrée. Score: ${score}%`, candidature: result.rows[0], score });
  } catch (err) {
    console.error('/api/candidature-spontanee error:', err);
    if (err.code === '23505') return res.status(400).json({ message: 'Cette adresse email est déjà utilisée.' });
    if (err.code === '23502') return res.status(400).json({ message: 'Données manquantes obligatoires.' });
    res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

/* ----------------------------
   DIAGNOSTICS (lecture)
   ---------------------------- */
app.get('/api/candidatures_stage', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM candidatures_stage ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('/api/candidatures_stage error:', err);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/candidatures_emploi/stages', async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM candidatures_emploi WHERE type IN ('stage','pfe') ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error('/api/candidatures_emploi/stages error:', err);
    res.status(500).send('Erreur serveur');
  }
});

/* ----------------------------
   HANDLERS D'ERREURS (APRÈS routes)
   ---------------------------- */
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Erreur fichier : ${err.message}` });
  }
  if (err && err.message && err.message.includes('fichier')) {
    return res.status(400).json({ message: err.message });
  }
  
  // Gestion spécifique des erreurs CORS
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ 
      message: 'Accès interdit par la politique CORS',
      error: err.message 
    });
  }
  
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Erreur serveur.' });
});

// Route 404
app.use('*', (req, res) => {
  res.status(404).json({ 
    message: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method
  });
});

/* ----------------------------
   START
   ---------------------------- */
const PORT = process.env.PORT;
if (!PORT) {
  console.error('🚨 ERROR: La variable d\'environnement PORT n\'est pas définie.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`✅ Backend démarré sur le port ${PORT}`);
  console.log(`📁 UPLOAD_DIR = ${uploadDir}`);
  console.log(`🌐 Health:        /api/health`);
  console.log(`🗄️  DB ping:      /api/db/ping`);
  console.log(`🔄 CORS test:     /api/cors-test`);
  console.log(`📧 Contact:       /contact`);
});