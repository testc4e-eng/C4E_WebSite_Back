const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');

// ------------------- Création du dossier uploads -------------------
// ✅ CORRECTION : Même chemin que server.js
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ------------------- Configuration Multer pour 2 fichiers -------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const fileFilter = (req, file, cb) => {
  // ✅ CORRECTION : Seulement PDF comme server.js
  const allowedTypes = /pdf/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers PDF sont autorisés !'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// ------------------- ROUTE POST : Ajouter une candidature spontanée -------------------
router.post('/', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  try {
    const {
      nom,
      prenom,
      email,
      telephone,
      poste,
      competences,
      type_etablissement,
      diplome,
      experience
    } = req.body;

    console.log('Données reçues:', req.body);
    console.log('Fichiers reçus:', req.files);

    // ------------------- Vérification des champs obligatoires -------------------
    const missingFields = [];
    if (!nom) missingFields.push('nom');
    if (!prenom) missingFields.push('prenom');
    if (!email) missingFields.push('email');
    if (!telephone) missingFields.push('telephone');
    if (!req.files?.cv) missingFields.push('cv');
    if (!req.files?.lettre_motivation) missingFields.push('lettre_motivation');

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `⚠️ Champs obligatoires manquants : ${missingFields.join(', ')}`,
        missingFields
      });
    }

    // ✅ CORRECTION : Même chemin que server.js
    const cvPath = `/uploads/${req.files.cv[0].filename}`;
    const lettreMotivationPath = `/uploads/${req.files.lettre_motivation[0].filename}`;

    // ------------------- Parsing du JSON compétences -------------------
    let competencesObj = null;

    try {
      competencesObj = typeof competences === 'string' 
        ? JSON.parse(competences) 
        : competences;
      console.log('Competences parsées:', competencesObj);
    } catch (err) {
      console.warn('⚠️ Erreur parsing competences:', err);
      competencesObj = null;
    }

    // ------------------- Calcul du score global -------------------
    let score = 0;

    if (competencesObj && typeof competencesObj === 'object') {
      const valeurs = Object.values(competencesObj)
        .map(v => parseInt(v) || 0)
        .filter(v => v > 0);
      
      console.log('Valeurs des compétences:', valeurs);
      console.log('Nombre de compétences:', valeurs.length);

      if (valeurs.length === 5) {
        if (valeurs.every(v => v === 5)) {
          score = 100;
          console.log('Toutes les compétences sont à 5, score = 100%');
        } else {
          score = 0;
          console.log('Au moins une compétence n\'est pas à 5, score = 0%');
        }
      } else {
        score = 0;
        console.log('Nombre de compétences incorrect, score = 0%');
      }
    } else {
      console.log('Aucun objet compétences valide, score = 0%');
    }

    // ------------------- Conversion expérience -------------------
    let experienceInt = 0;
    if (experience !== undefined && experience !== null && experience !== '') {
      const parsed = parseInt(experience, 10);
      if (!isNaN(parsed)) experienceInt = parsed;
    }

    // ------------------- Insertion dans la base -------------------
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
      lettreMotivationPath,
      poste?.trim() || null,
      competencesObj ? JSON.stringify(competencesObj) : null,
      type_etablissement?.trim() || null,
      diplome?.trim() || null,
      experienceInt,
      score
    ];

    console.log('Valeurs pour insertion:', values);

    const result = await pool.query(query, values);

    // ------------------- Réponse -------------------
    console.log('Candidature enregistrée');
    return res.status(201).json({
      message: '✅ Candidature spontanée enregistrée avec succès.'
    });

  } catch (err) {
    console.error('❌ Erreur POST candidature spontanée:', err);

    if (err instanceof multer.MulterError) {
      return res.status(400).json({ 
        message: `Erreur téléchargement fichier : ${err.message}` 
      });
    }

    return res.status(500).json({ 
      message: 'Erreur serveur interne.', 
      error: err.message 
    });
  }
});
router.get('/toutes', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM candidatures_spontanees ORDER BY date_soumission DESC`
    );

    res.status(200).json({
      message: 'Candidatures spontanées récupérées avec succès',
      data: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('❌ Erreur GET toutes les candidatures spontanées:', error);
    res.status(500).json({
      message: 'Erreur serveur',
      error: error.message
    });
  }
});

module.exports = router;