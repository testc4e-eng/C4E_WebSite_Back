// 📂 routes/admin.js - VERSION CORRIGÉE
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

// CREATE utilisateur - VERSION SIMPLIFIÉE ET CORRIGÉE
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 POST reçu - Type:", req.params.type);
    console.log("📦 Body reçu:", req.body);
    
    const { email, motDePasse } = req.body;
    
    // Validation simple
    if (!email || !motDePasse) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    // Déterminer la table et le rôle
    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🔍 Vérification email...");
    
    // Vérifier si l'email existe déjà
    const exist = await pool.query(`SELECT id FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    console.log("🔐 Hashage mot de passe...");
    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    console.log("💾 Insertion en base...");
    // Insertion avec gestion d'erreur
    const result = await pool.query(
      `INSERT INTO ${table} (email, mot_de_passe, role, date_creation, statut) 
       VALUES ($1, $2, $3, NOW(), 'actif') 
       RETURNING id, email, role, date_creation, statut`,
      [email, hashedPassword, role]
    );

    console.log("✅ Utilisateur créé");
    
    res.status(201).json({ 
      message: `${req.params.type === "administrateurs" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ ERREUR CREATE:", err);
    
    // Gestion spécifique des erreurs PostgreSQL
    if (err.code === '42P01') { // Table n'existe pas
      return res.status(500).json({ 
        message: `La table ${req.params.type === "administrateurs" ? "admin" : "gestionnaires"} n'existe pas` 
      });
    }
    
    if (err.code === '23505') { // Violation contrainte unique
      return res.status(409).json({ message: "Email déjà utilisé" });
    }
    
    res.status(500).json({ 
      message: "Erreur serveur lors de la création",
      error: err.message 
    });
  }
});

// GET utilisateurs
router.get("/:type", verifyAdmin, async (req, res) => {
  try {
    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    
    const result = await pool.query(`
      SELECT id, email, role, date_creation, 
             COALESCE(statut, 'actif') as statut, 
             dernier_connexion
      FROM ${table} 
      ORDER BY id
    `);
    
    res.json({ data: result.rows });
  } catch (err) {
    console.error("GET error:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// DELETE utilisateur
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
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