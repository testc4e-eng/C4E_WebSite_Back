// routes/candidatures.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;

// 🔥 CORRECTION : Importez verifyAdmin depuis auth.js
const { verifyAdmin } = require('./auth');

// Middleware pour servir les fichiers CV et lettres de motivation
router.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ... TOUT LE CODE EXISTANT DE VOTRE FICHIER CANDIDATURES.JS ...

// 📂 routes/candidatures.js - AJOUTEZ CES ROUTES AVEC verifyAdmin

// Route pour récupérer toutes les candidatures Stage/PFE
router.get("/stage/toutes", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        nom,
        prenom,
        email,
        telephone,
        cv_path as "cvUrl",
        lettre_motivation as "lettreMotivationUrl",
        domaine,
        duree,
        poste,
        type_etablissement,
        diplome,
        experience,
        competences,
        date_soumission as "dateSoumission",
        statut,
        type
      FROM candidatures_stage 
      ORDER BY date_soumission DESC
    `);
    
    console.log(`✅ ${result.rows.length} candidatures Stage/PFE trouvées`);
    
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération candidatures Stage/PFE:', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des candidatures Stage/PFE',
      error: err.message 
    });
  }
});

// Route pour récupérer toutes les candidatures spontanées générales
router.get("/spontanees/toutes", verifyAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id,
        nom,
        prenom,
        email,
        telephone,
        cv_path as "cvUrl",
        lettre_motivation as "lettreMotivationUrl",
        poste,
        type_etablissement,
        diplome,
        experience,
        competences,
        score as "competenceScore",
        date_soumission as "dateSoumission",
        statut,
        type
      FROM candidatures_spontanees 
      ORDER BY date_soumission DESC
    `);
    
    console.log(`✅ ${result.rows.length} candidatures spontanées générales trouvées`);
    
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Erreur récupération candidatures spontanées:', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des candidatures spontanées',
      error: err.message 
    });
  }
});

module.exports