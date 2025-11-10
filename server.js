require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('./db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3001;

/* ---------- CORS via env ---------- */
// ALLOWED_ORIGINS="http://localhost:5173,https://c4e-africa.com,https://www.c4e-africa.com,https://<ton-front>.onrender.com"
// ---- CORS dynamique depuis env ----
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:8080",
  "https://c4e-website-front.onrender.com",   // ton front Render
  "https://www.c4e-africa.com",               // (si domaine GoDaddy plus tard)
];

app.set('trust proxy', 1);

app.use(cors({
  origin: function (origin, cb) {
    // autoriser aussi les requêtes sans origin (ex: curl, health checks)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin non autorisée -> ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

// très utile pour les preflight
app.options("*", cors());

app.use(express.json());

/* ---------- UPLOADS dossier/disque ---------- */
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error('Seuls les fichiers PDF sont autorisés !'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Servir les fichiers uploadés
app.use('/uploads', express.static(uploadDir));

/* ---------- Erreurs Multer ---------- */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Erreur fichier : ${err.message}` });
  }
  if (err && err.message && err.message.includes('fichier')) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

/* ---------- ROUTES ---------- */
const contactRoutes = require('./routes/contact');
const candidaturesRoutes = require('./routes/candidatures');
const offresRoutes = require('./routes/offres');

app.use('/contact', contactRoutes);
app.use('/api/candidatures', candidaturesRoutes);
app.use('/api/offres', offresRoutes);

/* ---------- Endpoints upload ---------- */
app.post('/api/candidature-emploi', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, poste,
      type_etablissement, diplome, competences, experience, offre_id
    } = req.body;

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: {
          nom: !nom, prenom: !prenom, email: !email,
          telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath
        }
      });
    }

    let competencesObj = {};
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
      } catch {
        competencesObj = {};
      }
    }

    const experienceInt = parseInt(experience, 10) || 0;
    const offreIdInt = offre_id ? parseInt(offre_id, 10) : null;

    const query = `
      INSERT INTO candidatures_emploi
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, type_etablissement, diplome, competences, experience, offre_id, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, poste?.trim() || null,
      type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt, offreIdInt
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ message: '✅ Candidature emploi enregistrée.', candidature: result.rows[0] });
  } catch (err) {
    console.error('❌ /api/candidature-emploi:', err);
    res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

app.post('/api/candidature-stage', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, domaine, duree,
      type_etablissement, diplome, competences, experience
    } = req.body;

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !domaine || !duree || !cvPath || !lettrePath) {
      return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis.' });
    }

    let competencesObj = {};
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
      } catch {
        competencesObj = {};
      }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_stage
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       domaine, duree, type_etablissement, diplome, competences, experience, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, domaine.trim(), duree.trim(),
      type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ message: '✅ Candidature stage enregistrée.', candidature: result.rows[0] });
  } catch (err) {
    console.error('❌ /api/candidature-stage:', err);
    res.status(500).json({ message: 'Erreur interne du serveur.', error: err.message });
  }
});

app.post('/api/candidature-spontanee', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const { nom, prenom, email, telephone, poste, competences, type_etablissement, diplome, experience } = req.body;

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: { nom: !nom, prenom: !prenom, email: !email, telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath }
      });
    }

    // Score proportionnel
    let competencesObj = {};
    let score = 0;
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
        const vals = Object.values(competencesObj).map(v => parseInt(v) || 0).filter(v => v > 0);
        if (vals.length === 5) {
          const avg = vals.reduce((a,b)=>a+b,0) / vals.length;
          score = Math.round((avg / 5) * 100);
        }
      } catch { competencesObj = {}; }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_spontanees
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       poste, competences, type_etablissement, diplome, experience, score, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;
    `;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, poste?.trim() || null, JSON.stringify(competencesObj),
      type_etablissement?.trim() || null, diplome?.trim() || null, experienceInt, score
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ message: `✅ Candidature spontanée enregistrée. Score: ${score}%`, candidature: result.rows[0], score });
  } catch (err) {
    console.error('❌ /api/candidature-spontanee:', err);
    if (err.code === '23505') return res.status(400).json({ message: 'Cette adresse email est déjà utilisée.' });
    if (err.code === '23502') return res.status(400).json({ message: 'Données manquantes obligatoires.' });
    res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

/* ---------- Auth ---------- */
app.post('/api/auth/login', async (req, res) => {
  const { email, motDePasse } = req.body;
  if (!email || !motDePasse) return res.status(400).json({ message: 'Email et mot de passe sont requis.' });

  try {
    const result = await pool.query('SELECT * FROM gestionnaires WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ message: 'Utilisateur non trouvé.' });

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(motDePasse, user.mot_de_passe);
    if (!isMatch) return res.status(401).json({ message: 'Mot de passe incorrect.' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret_c4eafrica', { expiresIn: '8h' });
    res.json({ message: 'Connexion réussie.', token, utilisateur: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Erreur lors du login:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
});

/* ---------- Health ---------- */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Serveur fonctionne correctement', timestamp: new Date().toISOString() });
});

/* ---------- Diagnostics ---------- */
app.get('/api/candidatures_stage', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM candidatures_stage ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

app.get('/api/candidatures_emploi/stages', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM candidatures_emploi WHERE type IN ('stage','pfe') ORDER BY id ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📁 Dossier uploads: ${uploadDir}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  pool.end().then(() => console.log('🛑 PostgreSQL pool fermé.'));
});
