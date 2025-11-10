// server.js — version prête Render (PORT, health, CORS env-driven, UPLOAD_DIR configurable)

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

// -------------------- CORS piloté par variable --------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Autorise localhost par défaut en dev si ALLOWED_ORIGINS est vide
const dynamicCors = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // requêtes type curl/postman
    if (allowedOrigins.length === 0 && /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    return allowedOrigins.includes(origin)
      ? cb(null, true)
      : cb(new Error('Origin not allowed by CORS'), false);
  },
  credentials: false
});

app.use(dynamicCors);
app.use(express.json());

// -------------------- UPLOAD CONFIGURATION --------------------
// Par défaut: dossier local "uploads" (éphémère sur Render).
// En prod persistant: définir UPLOAD_DIR=/data/uploads (avec Persistent Disk attaché).
const uploadBase = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadBase)) {
  fs.mkdirSync(uploadBase, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadBase),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = /pdf/;
    const extname = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowed.test(file.mimetype);
    return (extname && mimetype) ? cb(null, true) : cb(new Error('Seuls les fichiers PDF sont autorisés !'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Servir les fichiers uploadés
app.use('/uploads', express.static(uploadBase));

// Gestion propre des erreurs Multer
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Erreur fichier : ${err.message}` });
  }
  if (err && err.message && err.message.toLowerCase().includes('fichier')) {
    return res.status(400).json({ message: err.message });
  }
  return next(err);
});

// -------------------- IMPORT ROUTES --------------------
const contactRoutes = require('./routes/contact');
const candidaturesRoutes = require('./routes/candidatures');
const offresRoutes = require('./routes/offres');

// -------------------- ROUTES --------------------
app.use('/contact', contactRoutes);
app.use('/api/candidatures', candidaturesRoutes);
app.use('/api/offres', offresRoutes);

// -------------------- CANDIDATURES --------------------
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

    const query = `
      INSERT INTO candidatures_emploi 
      (nom, prenom, email, telephone, cv_path, lettre_motivation, poste, type_etablissement, diplome, competences, experience, offre_id, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;`;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath,
      poste?.trim() || null, type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt, offreIdInt
    ];
    const result = await pool.query(query, values);
    return res.status(201).json({ message: '✅ Candidature emploi enregistrée avec succès.', candidature: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

app.post('/api/candidature-stage', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const { nom, prenom, email, telephone, domaine, duree, type_etablissement, diplome, competences, experience } = req.body;
    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !domaine || !duree || !cvPath || !lettrePath) {
      return res.status(400).json({ message: 'Tous les champs obligatoires doivent être remplis.' });
    }

    let competencesObj = {};
    if (competences) {
      try { competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences; }
      catch { competencesObj = {}; }
    }
    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_stage 
      (nom, prenom, email, telephone, cv_path, lettre_motivation, domaine, duree, type_etablissement, diplome, competences, experience, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;`;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, domaine.trim(), duree.trim(),
      type_etablissement?.trim() || null, diplome?.trim() || null,
      JSON.stringify(competencesObj), experienceInt
    ];
    const result = await pool.query(query, values);
    return res.status(201).json({ message: '✅ Candidature stage enregistrée avec succès.', candidature: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ message: 'Erreur interne du serveur.', error: err.message });
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

    let competencesObj = {};
    let score = 0;
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
        const vals = Object.values(competencesObj).map(v => parseInt(v) || 0).filter(v => v > 0);
        if (vals.length === 5) { const m = vals.reduce((a,b)=>a+b,0) / 5; score = Math.round((m/5)*100); }
      } catch { competencesObj = {}; }
    }

    const experienceInt = parseInt(experience, 10) || 0;

    const query = `
      INSERT INTO candidatures_spontanees
      (nom, prenom, email, telephone, cv_path, lettre_motivation, poste, competences, type_etablissement, diplome, experience, score, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      RETURNING *;`;
    const values = [
      nom.trim(), prenom.trim(), email.trim(), telephone.trim(),
      cvPath, lettrePath, poste?.trim() || null, JSON.stringify(competencesObj),
      type_etablissement?.trim() || null, diplome?.trim() || null, experienceInt, score
    ];
    const result = await pool.query(query, values);
    return res.status(201).json({ message: `✅ Candidature spontanée enregistrée avec succès. Score: ${score}%`, candidature: result.rows[0], score });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'Cette adresse email est déjà utilisée.' });
    if (err.code === '23502') return res.status(400).json({ message: 'Données manquantes obligatoires.' });
    return res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

// -------------------- AUTH LOGIN --------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, motDePasse } = req.body;
  if (!email || !motDePasse) return res.status(400).json({ message: 'Email et mot de passe sont requis.' });
  try {
    const r = await pool.query('SELECT * FROM gestionnaires WHERE email = $1', [email]);
    if (r.rows.length === 0) return res.status(401).json({ message: 'Utilisateur non trouvé.' });

    const user = r.rows[0];
    const isMatch = await bcrypt.compare(motDePasse, user.mot_de_passe);
    if (!isMatch) return res.status(401).json({ message: 'Mot de passe incorrect.' });

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET || 'secret_c4eafrica', { expiresIn: '8h' });
    return res.json({ message: 'Connexion réussie.', token, utilisateur: { id: user.id, email: user.email } });
  } catch (e) {
    return res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
});

// -------------------- HEALTH CHECK --------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', message: 'Serveur fonctionne correctement', timestamp: new Date().toISOString() });
});

// -------------------- LECTURE (exemples) --------------------
app.get('/api/candidatures_stage', async (_req, res) => {
  try { const r = await pool.query('SELECT * FROM candidatures_stage ORDER BY id ASC'); res.json(r.rows); }
  catch { res.status(500).send('Erreur serveur'); }
});

app.get('/api/candidatures_emploi/stages', async (_req, res) => {
  try { const r = await pool.query(`SELECT * FROM candidatures_emploi WHERE type IN ('stage','pfe') ORDER BY id ASC`); res.json(r.rows); }
  catch { res.status(500).send('Erreur serveur'); }
});

// -------------------- SERVER --------------------
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📁 Dossier uploads: ${uploadBase}`);
});

process.on('SIGINT', () => { pool.end().then(() => console.log('🛑 PostgreSQL pool fermé.')); });
