// 📂 routes/admin.js - VERSION COMPLÈTEMENT CORRIGÉE
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware CORRIGÉ
const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("🔐 Headers reçus:", authHeader);
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log("❌ Token manquant ou mal formaté");
      return res.status(401).json({ message: "Token manquant ou mal formaté" });
    }

    const token = authHeader.split(" ")[1];
    console.log("🔐 Token reçu:", token.substring(0, 20) + "...");
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("🔐 Token décodé:", decoded);
    
    // Vérification des rôles admin
    const userRole = decoded.role;
    const rolesAdmin = ["admin", "administrateur", "superadmin"];
    const isAdmin = rolesAdmin.includes(userRole?.toLowerCase());
    
    console.log("🔐 Rôle utilisateur:", userRole, "Est admin:", isAdmin);
    
    if (!isAdmin) {
      return res.status(403).json({ 
        message: "Accès réservé aux administrateurs",
        votreRole: userRole
      });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Erreur vérification token:", err.message);
    
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expiré" });
    } else {
      return res.status(401).json({ message: "Token invalide" });
    }
  }
};

// GET utilisateurs - CORRIGÉ
router.get("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 GET reçu - Type:", req.params.type);
    
    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    console.log("📊 Table cible:", table);
    
    const result = await pool.query(`
      SELECT id, email, role, date_creation, 
             COALESCE(statut, 'actif') as statut, 
             dernier_connexion
      FROM ${table} 
      ORDER BY date_creation DESC
    `);
    
    console.log(`✅ ${result.rows.length} ${table} récupérés`);
    res.json({ 
      data: result.rows,
      total: result.rows.length
    });
  } catch (err) {
    console.error("❌ GET error:", err);
    res.status(500).json({ 
      message: "Erreur serveur lors du chargement",
      error: err.message 
    });
  }
});

// CREATE utilisateur - CORRECTION COMPLÈTE
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 POST reçu - Type:", req.params.type);
    console.log("📦 Body reçu:", req.body);
    
    const { email, motDePasse } = req.body;
    
    // Validation
    if (!email || !motDePasse) {
      return res.status(400).json({ 
        message: "Email et mot de passe requis"
      });
    }

    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🔍 Vérification existence email:", email);
    
    // Vérifier existence
    const exist = await pool.query(`SELECT id FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      console.log("❌ Email déjà utilisé:", email);
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    console.log("🔐 Hashage du mot de passe...");
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    console.log("💾 Insertion en base...");
    const result = await pool.query(
      `INSERT INTO ${table} (email, mot_de_passe, role, date_creation, statut) 
       VALUES ($1, $2, $3, NOW(), 'actif') 
       RETURNING id, email, role, date_creation, statut`,
      [email, hashedPassword, role]
    );

    console.log("✅ Utilisateur créé:", result.rows[0]);
    
    res.status(201).json({ 
      message: `${req.params.type === "administrateurs" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: result.rows[0]
    });
  } catch (err) {
    console.error("❌ CREATE error détaillé:", err);
    res.status(500).json({ 
      message: "Erreur lors de la création",
      error: err.message
    });
  }
});

// UPDATE utilisateur - CORRIGÉ
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 PUT reçu - Type:", req.params.type, "ID:", req.params.id);
    console.log("📦 Body:", req.body);
    
    const { email, motDePasse, statut } = req.body;
    const { type, id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    let query = `UPDATE ${table} SET `;
    const fields = [];
    const values = [];
    let counter = 1;

    if (email) {
      const emailCheck = await pool.query(
        `SELECT id FROM ${table} WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ message: "Cet email est déjà utilisé" });
      }
      fields.push(`email = $${counter++}`);
      values.push(email);
    }

    if (motDePasse) {
      const hash = await bcrypt.hash(motDePasse, 10);
      fields.push(`mot_de_passe = $${counter++}`);
      values.push(hash);
    }

    if (statut) {
      if (!['actif', 'inactif'].includes(statut)) {
        return res.status(400).json({ message: "Statut doit être 'actif' ou 'inactif'" });
      }
      fields.push(`statut = $${counter++}`);
      values.push(statut);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Aucun champ à mettre à jour" });
    }

    query += fields.join(", ") + ` WHERE id = $${counter}`;
    values.push(id);

    console.log("🛠️ Query UPDATE:", query);
    console.log("📋 Values:", values);

    await pool.query(query, values);
    
    res.json({ 
      message: "Utilisateur mis à jour avec succès",
      success: true
    });
  } catch (err) {
    console.error("❌ UPDATE error:", err);
    res.status(500).json({ 
      message: "Erreur lors de la mise à jour",
      error: err.message
    });
  }
});

// DELETE utilisateur - CORRIGÉ
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 DELETE reçu - Type:", req.params.type, "ID:", req.params.id);
    
    const { type, id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
    res.json({ 
      message: "Utilisateur supprimé avec succès",
      success: true
    });
  } catch (err) {
    console.error("❌ DELETE error:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression",
      error: err.message
    });
  }
});
// Route de test
router.get("/test/connection", verifyAdmin, async (req, res) => {
  try {
    const testAdmin = await pool.query("SELECT COUNT(*) FROM admin");
    const testGestionnaires = await pool.query("SELECT COUNT(*) FROM gestionnaires");
    
    res.json({
      message: "Connexion DB OK",
      admin_count: testAdmin.rows[0].count,
      gestionnaires_count: testGestionnaires.rows[0].count,
      user: req.user
    });
  } catch (err) {
    console.error("Test connection error:", err);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;