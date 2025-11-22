// server.js - VERSION COMPLÈTEMENT CORRIGÉE
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
   CORS CORRIGÉ - SOLUTION DÉFINITIVE
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

// 🔥 CORRECTION CORS - Configuration simplifiée et efficace
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Headers'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

// Appliquer CORS globalement
app.use(cors(corsOptions));

// 🔥 Gestion MANUELLE des pré-vols OPTIONS pour TOUTES les routes
app.options('*', (req, res) => {
  const origin = req.headers.origin;
  
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  
  res.status(200).send();
});

// Middleware pour logs des requêtes (debug)
app.use((req, res, next) => {
  console.log(`🌐 ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  console.log(`   Origin: ${req.headers.origin || 'none'}`);
  console.log(`   User-Agent: ${req.headers['user-agent']?.substring(0, 50)}...`);
  next();
});

// Middleware pour parser le JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* ----------------------------
   Routes API
   ---------------------------- */
// 🔥 IMPORT CORRECT des routes
const authRoutes = require('./routes/auth');// Correction ici
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const candidaturesRoutes = require('./routes/candidatures');
const candidatureSpontaneeRoutes = require('./routes/candidatureSpontanee');
const offresRoutes = require('./routes/offres');


// 🔥 MONTAGE CORRECT des routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/contact', contactRoutes); // Changé de '/contact' à '/api/contact'
app.use('/api/candidatures', candidaturesRoutes);
app.use('/api/candidatures/spontanees', candidatureSpontaneeRoutes);
app.use('/api/offres', offresRoutes);
app.use("/api/candidatures/spontanees", require("./routes/candidatureStage"));/* ----------------------------
   UPLOADS (PDF seulement)
   ---------------------------- */
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`📁 Dossier upload créé: ${uploadDir}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const isPDF = file.mimetype === 'application/pdf';
    const hasPDFExtension = path.extname(file.originalname).toLowerCase() === '.pdf';
    
    if (isPDF && hasPDFExtension) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés !'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Servir les fichiers uploadés statiquement
app.use('/uploads', express.static(uploadDir));

/* ----------------------------
   ENDPOINTS SANTÉ / DIAGNOSTIC
   ---------------------------- */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Serveur fonctionne correctement', 
    timestamp: new Date().toISOString(),
    cors: {
      allowedOrigins: allowedOrigins,
      clientOrigin: req.headers.origin || 'none',
      yourIP: req.ip
    }
  });
});

app.get('/api/db/ping', async (req, res) => {
  try {
    const result = await pool.query('SELECT current_user, current_database(), now() as timestamp');
    res.json({ 
      ok: true, 
      database: result.rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ DB ping error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error.message,
      code: error.code
    });
  }
});

// Endpoint de test CORS spécifique
app.get('/api/cors-test', (req, res) => {
  res.json({ 
    message: 'CORS test réussi!',
    yourOrigin: req.headers.origin || 'none',
    allowedOrigins: allowedOrigins,
    timestamp: new Date().toISOString(),
    headers: {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-credentials': 'true'
    }
  });
});

// Route de test pour vérifier que le serveur répond
app.get('/', (req, res) => {
  res.json({
    message: '🚀 Serveur C4E Africa Backend',
    version: '1.0.0',
    status: 'online',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      candidatures: '/api/candidatures',
      offres: '/api/offres',
      contact: '/api/contact'
    }
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

    console.log('📨 Candidature emploi reçue:', { nom, prenom, email, poste });

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    // Validation des champs obligatoires
    if (!nom || !prenom || !email || !telephone || !cvPath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: { 
          nom: !nom, 
          prenom: !prenom, 
          email: !email, 
          telephone: !telephone, 
          cv: !cvPath 
        }
      });
    }

    let competencesObj = {};
    if (competences) {
      try { 
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences; 
      } catch (error) {
        console.warn('⚠️ Erreur parsing compétences:', error);
        competencesObj = {};
      }
    }

    const experienceInt = parseInt(experience, 10) || 0;
    const offreIdInt = offre_id ? parseInt(offre_id, 10) : null;

    const query = `
      INSERT INTO candidatures_emploi
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, type_etablissement, diplome, competences, experience, offre_id, date_soumission)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *;
    `;
    
    const values = [
      nom.trim(), 
      prenom.trim(), 
      email.trim(), 
      telephone.trim(),
      cvPath, 
      lettrePath, 
      poste?.trim() || null,
      type_etablissement?.trim() || null, 
      diplome?.trim() || null,
      JSON.stringify(competencesObj), 
      experienceInt, 
      offreIdInt
    ];
    
    const result = await pool.query(query, values);
    
    console.log('✅ Candidature emploi enregistrée - ID:', result.rows[0].id);
    
    res.status(201).json({ 
      message: '✅ Candidature emploi enregistrée avec succès.', 
      candidature: result.rows[0] 
    });
    
  } catch (error) {
    console.error('❌ /api/candidature-emploi error:', error);
    
    if (error.code === '23505') { // Violation de contrainte unique
      return res.status(400).json({ 
        message: 'Cette adresse email a déjà soumis une candidature.' 
      });
    }
    
    res.status(500).json({ 
      message: 'Erreur serveur interne lors de l\'enregistrement.', 
      error: process.env.NODE_ENV === 'production' ? {} : error.message 
    });
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

    console.log('📨 Candidature stage reçue:', { nom, prenom, email, domaine });

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !domaine || !duree || !cvPath) {
      return res.status(400).json({ 
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: {
          nom: !nom, prenom: !prenom, email: !email, telephone: !telephone,
          domaine: !domaine, duree: !duree, cv: !cvPath
        }
      });
    }

    let competencesObj = {};
    if (competences) {
      try { 
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences; 
      } catch (error) {
        console.warn('⚠️ Erreur parsing compétences:', error);
        competencesObj = {};
      }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_stage
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       domaine, duree, type_etablissement, diplome, competences, experience, date_soumission)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *;
    `;
    
    const values = [
      nom.trim(), 
      prenom.trim(), 
      email.trim(), 
      telephone.trim(),
      cvPath, 
      lettrePath, 
      domaine.trim(), 
      duree.trim(),
      type_etablissement?.trim() || null, 
      diplome?.trim() || null,
      JSON.stringify(competencesObj), 
      experienceInt
    ];
    
    const result = await pool.query(query, values);
    
    console.log('✅ Candidature stage enregistrée - ID:', result.rows[0].id);
    
    res.status(201).json({ 
      message: '✅ Candidature stage enregistrée avec succès.', 
      candidature: result.rows[0] 
    });
    
  } catch (error) {
    console.error('❌ /api/candidature-stage error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        message: 'Cette adresse email a déjà soumis une candidature.' 
      });
    }
    
    res.status(500).json({ 
      message: 'Erreur interne du serveur.', 
      error: process.env.NODE_ENV === 'production' ? {} : error.message 
    });
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
    const { 
      nom, prenom, email, telephone, poste, 
      competences, type_etablissement, diplome, experience 
    } = req.body;

    console.log('📨 Candidature spontanée reçue:', { nom, prenom, email, poste });

    const cvPath = req.files?.cv?.[0] ? `/uploads/${req.files.cv[0].filename}` : null;
    const lettrePath = req.files?.lettre_motivation?.[0] ? `/uploads/${req.files.lettre_motivation[0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !cvPath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: { 
          nom: !nom, 
          prenom: !prenom, 
          email: !email, 
          telephone: !telephone, 
          cv: !cvPath 
        }
      });
    }

    let competencesObj = {};
    let score = 0;
    
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
        const values = Object.values(competencesObj)
          .map(v => parseInt(v, 10) || 0)
          .filter(v => v > 0);
          
        if (values.length > 0) {
          const average = values.reduce((a, b) => a + b, 0) / values.length;
          score = Math.max(0, Math.min(100, Math.round((average / 5) * 100)));
        }
      } catch (error) {
        console.warn('⚠️ Erreur calcul score compétences:', error);
        competencesObj = {};
      }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_spontanees
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, competences, type_etablissement, diplome, experience, score, date_soumission)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING *;
    `;
    
    const values = [
      nom.trim(), 
      prenom.trim(), 
      email.trim(), 
      telephone.trim(),
      cvPath, 
      lettrePath, 
      poste?.trim() || null, 
      JSON.stringify(competencesObj),
      type_etablissement?.trim() || null, 
      diplome?.trim() || null, 
      experienceInt, 
      score
    ];
    
    const result = await pool.query(query, values);
    
    console.log('✅ Candidature spontanée enregistrée - ID:', result.rows[0].id, 'Score:', score);
    
    res.status(201).json({ 
      message: `✅ Candidature spontanée enregistrée. Score: ${score}%`, 
      candidature: result.rows[0], 
      score 
    });
    
  } catch (error) {
    console.error('❌ /api/candidature-spontanee error:', error);
    
    if (error.code === '23505') {
      return res.status(400).json({ 
        message: 'Cette adresse email a déjà soumis une candidature.' 
      });
    }
    
    if (error.code === '23502') {
      return res.status(400).json({ 
        message: 'Données manquantes obligatoires.' 
      });
    }
    
    res.status(500).json({ 
      message: 'Erreur serveur interne.', 
      error: process.env.NODE_ENV === 'production' ? {} : error.message 
    });
  }
});

/* ----------------------------
   DIAGNOSTICS (lecture)
   ---------------------------- */
app.get('/api/candidatures_stage', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM candidatures_stage ORDER BY id DESC LIMIT 50');
    res.json({
      count: result.rows.length,
      candidatures: result.rows
    });
  } catch (error) {
    console.error('❌ /api/candidatures_stage error:', error);
    res.status(500).json({ 
      message: 'Erreur serveur', 
      error: error.message 
    });
  }
});

app.get('/api/candidatures_emploi/stages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM candidatures_emploi 
      WHERE type IN ('stage','pfe') 
      ORDER BY id DESC 
      LIMIT 50
    `);
    res.json({
      count: result.rows.length,
      candidatures: result.rows
    });
  } catch (error) {
    console.error('❌ /api/candidatures_emploi/stages error:', error);
    res.status(500).json({ 
      message: 'Erreur serveur', 
      error: error.message 
    });
  }
});

/* ----------------------------
   HANDLERS D'ERREURS (APRÈS routes)
   ---------------------------- */
app.use((error, req, res, next) => {
  // Gestion des erreurs Multer (upload de fichiers)
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        message: 'Le fichier est trop volumineux (max 10MB).' 
      });
    }
    return res.status(400).json({ 
      message: `Erreur fichier : ${error.message}` 
    });
  }
  
  // Gestion des erreurs de validation de fichiers
  if (error.message && error.message.includes('fichier')) {
    return res.status(400).json({ 
      message: error.message 
    });
  }
  
  // Gestion spécifique des erreurs CORS
  if (error.message && error.message.includes('CORS')) {
    console.log('🚫 CORS Error:', error.message);
    return res.status(403).json({ 
      message: 'Accès interdit par la politique CORS',
      error: 'Origin non autorisée'
    });
  }
  
  // Erreur générale
  console.error('❌ Unhandled error:', error);
  res.status(500).json({ 
    message: 'Erreur serveur interne.',
    error: process.env.NODE_ENV === 'production' ? {} : error.message
  });
});

// Route 404 - Doit être la dernière
app.use('*', (req, res) => {
  res.status(404).json({ 
    message: 'Route non trouvée',
    path: req.originalUrl,
    method: req.method,
    availableEndpoints: [
      '/api/health',
      '/api/auth/login',
      '/api/candidatures',
      '/api/offres',
      '/api/contact'
    ]
  });
});

// ===================== ROUTE PUT UNIVERSELLE POUR TOUS LES TYPES =====================
app.put('/api/candidatures/:type/:id', async (req, res) => {
  const client = await pool.connect();
  const { type, id } = req.params;
  const { statut } = req.body;

  try {
    console.log(`🔄 Mise à jour statut ${type} ${id}:`, { statut });

    // Déterminer la table en fonction du type
    let tableName;
    switch (type) {
      case 'emploi':
        tableName = 'candidatures_emploi';
        break;
      case 'stage':
      case 'pfe':
        tableName = 'candidatures_stage';
        break;
      case 'spontanee':
      case 'stage_spontane':
        tableName = 'candidatures_spontanees';
        break;
      default:
        return res.status(400).json({ 
          message: 'Type de candidature non supporté' 
        });
    }

    // Vérifier que la candidature existe
    const checkQuery = `SELECT * FROM ${tableName} WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Candidature non trouvée' 
      });
    }

    // Valider le statut
    const statutsValides = ['en_attente', 'acceptee', 'refusee'];
    if (!statutsValides.includes(statut)) {
      return res.status(400).json({ 
        message: 'Statut invalide. Valeurs acceptées: en_attente, acceptee, refusee' 
      });
    }

    // Mettre à jour le statut
    const updateQuery = `
      UPDATE ${tableName} 
      SET statut = $1, date_mise_a_jour = NOW()
      WHERE id = $2 
      RETURNING *
    `;
    
    const values = [statut, id];
    const result = await client.query(updateQuery, values);

    console.log(`✅ Statut ${type} ${id} mis à jour: ${statut}`);

    res.status(200).json({
      message: 'Statut mis à jour avec succès',
      candidature: result.rows[0]
    });

  } catch (error) {
    console.error(`❌ Erreur PUT ${type} ${id}:`, error.message);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la mise à jour',
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ----------------------------
   START SERVEUR
   ---------------------------- */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`\n🚀 ✅ Backend C4E Africa démarré sur le port ${PORT}`);
  console.log(`📁 Dossier upload: ${uploadDir}`);
  console.log(`🌐 Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`\n📊 Endpoints disponibles:`);
  console.log(`   🔧 Santé:        /api/health`);
  console.log(`   🗄️  DB test:      /api/db/ping`);
  console.log(`   🔄 CORS test:    /api/cors-test`);
  console.log(`   🔐 Auth:         /api/auth/login`);
  console.log(`   📧 Contact:      /api/contact`);
  console.log(`   📄 Candidatures: /api/candidatures`);
  console.log(`   💼 Offres:       /api/offres`);
  console.log(`\n⏰ Démarrage: ${new Date().toISOString()}\n`);
});