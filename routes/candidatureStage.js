const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const pool = require('../db');

// ------------------- Dossier Uploads -------------------
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ------------------- Configuration Multer -------------------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Seuls les fichiers PDF sont autorisés'), false);
  }
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  }
});

// ===================== ROUTES GET =====================

// 🔥 ROUTE POUR RÉCUPÉRER TOUTES LES CANDIDATURES STAGE
router.get('/toutes', async (req, res) => {
  try {
const result = await pool.query(
  `SELECT * FROM candidatures_stage ORDER BY date_soumission DESC`
);

    res.status(200).json({
      message: 'Liste des candidatures spontanées',
      candidatures: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error("❌ Erreur GET spontanées/toutes:", error.message);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// 🔥 ROUTE POUR RÉCUPÉRER UNE CANDIDATURE SPÉCIFIQUE
router.get('/:id', async (req, res) => {
  const client = await pool.connect();
  const { id } = req.params;
  
  try {
    const query = `
      SELECT * FROM candidatures_stage 
      WHERE id = $1
    `;
    
    const result = await client.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Candidature non trouvée' 
      });
    }
    
    console.log(`✅ Candidature stage ${id} récupérée`);
    
    res.status(200).json({
      message: 'Candidature récupérée avec succès',
      candidature: result.rows[0]
    });
    
  } catch (error) {
    console.error(`❌ Erreur GET candidature stage ${id}:`, error.message);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération de la candidature',
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// ===================== ROUTE POST EXISTANTE =====================
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

    const cvFile = req.files['cv'][0];
    const lettreFile = req.files['lettre_motivation'][0];

    if (cvFile.mimetype !== 'application/pdf' || lettreFile.mimetype !== 'application/pdf') {
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
      INSERT INTO candidatures_stage
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
    
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ 
          message: 'Type de fichier non autorisé. Seuls les PDF sont acceptés.' 
        });
      }
    }
    
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