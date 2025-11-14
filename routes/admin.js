// 📂 routes/admin.js - VERSION TABLE UNIFIÉE
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware
const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Token manquant" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userRole = decoded.role;
    const isAdmin = ["admin", "administrateur"].includes(userRole?.toLowerCase());
    
    if (!isAdmin) {
      return res.status(403).json({ message: "Accès réservé aux administrateurs" });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Middleware error:", err.message);
    return res.status(401).json({ message: "Token invalide" });
  }
};

// CREATE utilisateur - VERSION TABLE UNIFIÉE
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 POST reçu - Type:", req.params.type);
    console.log("📦 Body reçu:", req.body);
    
    const { email, motDePasse, nom } = req.body;
    
    // Validation
    if (!email || !motDePasse) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    // Déterminer le type d'utilisateur
    const userType = req.params.type === "administrateurs" ? "administrateur" : "gestionnaire";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🔍 Vérification email...");
    
    // Vérifier si l'email existe déjà dans utilisateurs
    const exist = await pool.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    console.log("🔐 Hashage mot de passe...");
    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    console.log("💾 Insertion en base...");
    // Insertion dans la table unifiée utilisateurs
    const result = await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
       VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
       RETURNING id, nom, email, role, type, date_creation, statut`,
      [nom || 'Utilisateur', email, hashedPassword, role, userType]
    );

    console.log("✅ Utilisateur créé");
    
    res.status(201).json({ 
      message: `${userType === "administrateur" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ ERREUR CREATE:", err);
    
    res.status(500).json({ 
      message: "Erreur serveur lors de la création",
      error: err.message 
    });
  }
});

// GET gestionnaires - ROUTE SPÉCIFIQUE CORRIGÉE
router.get("/gestionnaires", verifyAdmin, async (req, res) => {
  try {
    console.log("🔍 Récupération des gestionnaires...");
    
    const result = await pool.query(`
      SELECT id, nom, email, role, type, statut, 
             date_creation, dernier_connexion, sites_geres
      FROM utilisateurs 
      WHERE type = 'gestionnaire' 
      ORDER BY date_creation DESC
    `);
    
    console.log(`✅ ${result.rows.length} gestionnaires trouvés`);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Erreur /api/admin/gestionnaires:', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des gestionnaires',
      error: err.message 
    });
  }
});

// GET administrateurs
router.get("/administrateurs", verifyAdmin, async (req, res) => {
  try {
    console.log("🔍 Récupération des administrateurs...");
    
    const result = await pool.query(`
      SELECT id, nom, email, role, type, statut, 
             date_creation, dernier_connexion
      FROM utilisateurs 
      WHERE type = 'administrateur' 
      ORDER BY date_creation DESC
    `);
    
    console.log(`✅ ${result.rows.length} administrateurs trouvés`);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Erreur /api/admin/administrateurs:', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des administrateurs',
      error: err.message 
    });
  }
});

// DELETE utilisateur - VERSION TABLE UNIFIÉE
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    
    await pool.query(`DELETE FROM utilisateurs WHERE id = $1 AND type = $2`, [id, type === "administrateurs" ? "administrateur" : "gestionnaire"]);
    
    res.json({ 
      message: "Utilisateur supprimé avec succès",
      success: true
    });
  } catch (err) {
    console.error("DELETE error:", err);
    res.status(500).json({ message: "Erreur lors de la suppression" });
  }
});

module.exports = router;