const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'c4eafrica',
  password: process.env.DB_PASSWORD || 'c4e@test@2025',
  port: process.env.DB_PORT || 5432,
});

// ------------------- Dossier Uploads -------------------
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ------------------- Configuration Multer -------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

// 🔥 NOUVEAU : Filtre pour n'accepter que les PDF
const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers PDF sont autorisés'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter, // 🔥 Ajout du filtre PDF
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  }
});

// ===================== ROUTE POST =====================
router.post('/', upload.fields([
  { name: 'cv', maxCount: 1 },
  { name: 'lettre_motivation', maxCount: 1 }
]), async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      nom, prenom, email, telephone,
      domaine, duree, poste,
      type_etablissement, diplome, competences, experience
    } = req.body;

    // Vérification des fichiers uploadés
    if (!req.files || !req.files['cv'] || !req.files['lettre_motivation']) {
      return res.status(400).json({ 
        message: 'Les fichiers CV et lettre de motivation sont obligatoires.' 
      });
    }

    // 🔥 NOUVEAU : Vérification que les fichiers sont bien des PDF
    const cvFile = req.files['cv'][0];
    const lettreFile = req.files['lettre_motivation'][0];

    if (cvFile.mimetype !== 'application/pdf' || lettreFile.mimetype !== 'application/pdf') {
      // Supprimer les fichiers uploadés si ce ne sont pas des PDF
      if (req.files['cv']) {
        fs.unlinkSync(path.join(__dirname, '..', `/uploads/${cvFile.filename}`));
      }
      if (req.files['lettre_motivation']) {
        fs.unlinkSync(path.join(__dirname, '..', `/uploads/${lettreFile.filename}`));
      }
      
      return res.status(400).json({ 
        message: 'Les fichiers doivent être au format PDF.' 
      });
    }

    const cvPath = `/uploads/${cvFile.filename}`;
    const lettreMotivationPath = `/uploads/${lettreFile.filename}`;

    // Vérification des champs obligatoires
    if (
      !nom || !prenom || !email || !telephone ||
      !domaine || !duree || !type_etablissement || !diplome
    ) {
      // Supprimer les fichiers uploadés si validation échoue
      if (req.files['cv']) {
        fs.unlinkSync(path.join(__dirname, '..', cvPath));
      }
      if (req.files['lettre_motivation']) {
        fs.unlinkSync(path.join(__dirname, '..', lettreMotivationPath));
      }
      
      return res.status(400).json({ 
        message: 'Tous les champs obligatoires doivent être remplis.' 
      });
    }

    // Conversion du champ "competences" JSON string → objet
    let competencesJSON = null;
    if (competences) {
      try {
        competencesJSON = JSON.stringify(JSON.parse(competences));
      } catch (err) {
        // Supprimer les fichiers uploadés si validation échoue
        if (req.files['cv']) {
          fs.unlinkSync(path.join(__dirname, '..', cvPath));
        }
        if (req.files['lettre_motivation']) {
          fs.unlinkSync(path.join(__dirname, '..', lettreMotivationPath));
        }
        
        return res.status(400).json({ 
          message: 'Le format des compétences est invalide.' 
        });
      }
    }

    // Conversion du champ "experience" en entier
    let experienceInt = null;
    if (experience !== undefined && experience !== null && experience !== '') {
      const parsed = parseInt(experience, 10);
      if (!isNaN(parsed)) experienceInt = parsed;
    }

    // -------------------- INSERT --------------------
    const query = `
      INSERT INTO candidatures_spontanees
      (nom, prenom, email, telephone, cv_path, lettre_motivation,
       domaine, duree, poste, competences, type_etablissement,
       diplome, experience, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      RETURNING *;
    `;

    const values = [
      nom.trim(),
      prenom.trim(),
      email.trim(),
      telephone.trim(),
      cvPath,
      lettreMotivationPath,
      domaine.trim(),
      duree.trim(),
      poste?.trim() || null,
      competencesJSON,
      type_etablissement?.trim() || null,
      diplome?.trim() || null,
      experienceInt
    ];

    const result = await client.query(query, values);

    console.log('✅ Candidature spontanée enregistrée:', {
      id: result.rows[0].id,
      nom: result.rows[0].nom,
      fichiers: {
        cv: cvPath,
        lettre: lettreMotivationPath
      }
    });

    res.status(201).json({
      message: '✅ Candidature enregistrée avec succès.',
      candidature: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Erreur POST candidature spontanée:', error.message);
    
    // Gestion spécifique des erreurs Multer (fichiers non PDF)
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ 
          message: 'Type de fichier non autorisé. Seuls les PDF sont acceptés.' 
        });
      }
    }
    
    // Supprimer les fichiers uploadés en cas d'erreur
    if (req.files) {
      if (req.files['cv']) {
        fs.unlinkSync(path.join(__dirname, '..', `/uploads/${req.files['cv'][0].filename}`));
      }
      if (req.files['lettre_motivation']) {
        fs.unlinkSync(path.join(__dirname, '..', `/uploads/${req.files['lettre_motivation'][0].filename}`));
      }
    }
    
    res.status(500).json({ 
      message: 'Erreur serveur lors de l\'enregistrement de la candidature.',
      error: error.message 
    });
  } finally {
    client.release();
  }
});

module.exports = router;