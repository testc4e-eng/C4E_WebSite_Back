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

// -------------------- IMPORT ROUTES --------------------
const contactRoutes = require('./routes/contact');
const candidaturesRoutes = require('./routes/candidatures');
const offresRoutes = require('./routes/offres');

// -------------------- MIDDLEWARE --------------------
app.use(cors({ origin: ["http://localhost:5173", "http://localhost:8080"] }));
app.use(express.json());

// -------------------- UPLOAD CONFIGURATION --------------------
const uploadDir = path.join(__dirname, 'uploads');
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
    // ✅ SEULEMENT LES FICHIERS PDF AUTORISÉS
    const allowedTypes = /pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont autorisés !'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

app.use('/uploads', express.static(uploadDir));

// Middleware pour capturer les erreurs Multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: `Erreur fichier : ${err.message}` });
  }
  if (err.message && err.message.includes('fichier')) {
    return res.status(400).json({ message: err.message });
  }
  next(err);
});

// -------------------- ROUTES --------------------

// Contact
app.use('/contact', contactRoutes);

// -------------------- API ROUTES --------------------
app.use('/api/candidatures', candidaturesRoutes);
app.use('/api/offres', offresRoutes);

// -------------------- CANDIDATURES --------------------

// Candidatures emploi (CV + lettre de motivation PDF)
app.post('/api/candidature-emploi', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom, prenom, email, telephone, poste,
      type_etablissement, diplome, competences, experience, offre_id
    } = req.body;

    console.log('📨 Candidature emploi - Données:', req.body);
    console.log('📎 Candidature emploi - Fichiers:', req.files);

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    // Validation des champs obligatoires
    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({ 
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: {
          nom: !nom, prenom: !prenom, email: !email, 
          telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath
        }
      });
    }

    // Parsing des compétences
    let competencesObj = {};
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
      } catch (e) {
        console.warn('⚠️ Erreur parsing competences:', e);
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

    console.log('💾 Insertion candidature emploi:', values);

    const result = await pool.query(query, values);

    res.status(201).json({
      message: '✅ Candidature emploi enregistrée avec succès.',
      candidature: result.rows[0]
    });

  } catch (err) {
    console.error('❌ Erreur /api/candidature-emploi:', err);
    res.status(500).json({ 
      message: 'Erreur serveur interne.',
      error: err.message 
    });
  }
});

// Candidatures stage (CV + lettre de motivation PDF)
app.post('/api/candidature-stage', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      nom, prenom, email, telephone, domaine, duree, 
      type_etablissement, diplome, competences, experience 
    } = req.body;

    console.log('📨 Candidature stage - Données:', req.body);
    console.log('📎 Candidature stage - Fichiers:', req.files);

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    if (!nom || !prenom || !email || !telephone || !domaine || !duree || !cvPath || !lettrePath) {
      return res.status(400).json({ 
        message: 'Tous les champs obligatoires doivent être remplis.' 
      });
    }

    let competencesObj = {};
    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
      } catch (e) {
        console.warn('⚠️ Erreur parsing competences:', e);
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

    console.log('💾 Insertion candidature stage:', values);

    const result = await pool.query(query, values);

    res.status(201).json({
      message: '✅ Candidature stage enregistrée avec succès.',
      candidature: result.rows[0]
    });

  } catch (err) {
    console.error('❌ Erreur serveur /api/candidature-stage:', err);
    res.status(500).json({ 
      message: 'Erreur interne du serveur.',
      error: err.message 
    });
  }
});

// Candidatures spontanées (CV + lettre de motivation PDF) - SCORE CORRIGÉ
app.post('/api/candidature-spontanee', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      nom, prenom, email, telephone, poste, 
      competences, type_etablissement, diplome, experience 
    } = req.body;

    console.log('📨 Candidature spontanée - Données:', req.body);
    console.log('📎 Candidature spontanée - Fichiers:', req.files);

    const cvPath = req.files?.['cv']?.[0] ? `/uploads/${req.files['cv'][0].filename}` : null;
    const lettrePath = req.files?.['lettre_motivation']?.[0] ? `/uploads/${req.files['lettre_motivation'][0].filename}` : null;

    // Validation des champs obligatoires
    if (!nom || !prenom || !email || !telephone || !cvPath || !lettrePath) {
      return res.status(400).json({ 
        message: 'Tous les champs obligatoires doivent être remplis.',
        details: {
          nom: !nom, prenom: !prenom, email: !email, 
          telephone: !telephone, cv: !cvPath, lettre_motivation: !lettrePath
        }
      });
    }

    // Parsing des compétences et calcul du score PROPORTIONNEL
    let competencesObj = {};
    let score = 0;

    if (competences) {
      try {
        competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
        console.log('🎯 Compétences parsées:', competencesObj);

        // ✅ CALCUL PROPORTIONNEL DU SCORE
        if (competencesObj && typeof competencesObj === 'object') {
          const valeurs = Object.values(competencesObj)
            .map(v => parseInt(v) || 0)
            .filter(v => v > 0);

          console.log('📊 Valeurs des compétences:', valeurs);

          if (valeurs.length === 5) {
            // Score = moyenne des compétences * 20 (pour avoir un pourcentage)
            const somme = valeurs.reduce((acc, val) => acc + val, 0);
            const moyenne = somme / valeurs.length;
            score = Math.round((moyenne / 5) * 100);
            console.log(`🎯 Score calculé: ${score}% (somme: ${somme}, moyenne: ${moyenne.toFixed(2)})`);
          } else {
            score = 0;
            console.log('🎯 Score: 0% - Nombre de compétences incorrect');
          }
        }
      } catch (e) {
        console.warn('⚠️ Erreur parsing competences:', e);
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

    console.log('💾 Insertion candidature spontanée:', values);

    const result = await pool.query(query, values);

    console.log('✅ Candidature spontanée enregistrée avec score:', score);

    res.status(201).json({
      message: `✅ Candidature spontanée enregistrée avec succès. Score: ${score}%`,
      candidature: result.rows[0],
      score: score
    });

  } catch (err) {
    console.error('❌ Erreur route /api/candidature-spontanee:', err);
    
    // Gestion des erreurs de base de données spécifiques
    if (err.code === '23505') { // Violation de contrainte unique
      return res.status(400).json({ 
        message: 'Cette adresse email est déjà utilisée.' 
      });
    }
    
    if (err.code === '23502') { // Violation de contrainte NOT NULL
      return res.status(400).json({ 
        message: 'Données manquantes obligatoires.' 
      });
    }

    res.status(500).json({ 
      message: 'Erreur serveur interne.',
      error: err.message 
    });
  }
});

// -------------------- AUTH LOGIN --------------------
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

// -------------------- HEALTH CHECK --------------------
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Serveur fonctionne correctement',
    timestamp: new Date().toISOString()
  });
});

// 📄 Récupérer les candidatures de stage (table candidatures_stage)
app.get('/api/candidatures_stage', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM candidatures_stage ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

// 📄 Récupérer les stages/PFE depuis candidatures_emploi
app.get('/api/candidatures_emploi/stages', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM candidatures_emploi 
      WHERE type IN ('stage', 'pfe')
      ORDER BY id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Erreur serveur');
  }
});

// -------------------- SERVER --------------------
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  console.log(`📁 Dossier uploads: ${uploadDir}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`📊 Calcul du score: Proportionnel (moyenne des compétences)`);
  console.log(`📈 Routes disponibles:`);
  console.log(`   - GET  /api/candidatures`);
  console.log(`   - GET  /api/offres`);
  console.log(`   - POST /api/candidature-emploi`);
  console.log(`   - POST /api/candidature-stage`);
  console.log(`   - POST /api/candidature-spontanee`);
  console.log(`   - POST /api/auth/login`);
});

process.on('SIGINT', () => {
  pool.end().then(() => console.log('🛑 PostgreSQL pool fermé.'));
});