// 📂 routes/admin.js - CORRIGÉ POUR MATCHER VOTRE AUTH.JS
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware pour vérifier JWT et rôle admin - CORRIGÉ
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Token manquant" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Token mal formaté" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérification du rôle - SELON VOTRE AUTH.JS
    // Votre auth.js met 'role' et 'type' dans le token
    console.log("🔍 Token décodé:", decoded);
    
    const userRole = decoded.role;
    const isAdmin = userRole === "administrateur" || userRole === "admin";
    
    if (!isAdmin) {
      return res.status(403).json({ 
        message: "Accès réservé aux administrateurs",
        votreRole: userRole 
      });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Erreur token admin:", err.message);
    return res.status(401).json({ message: "Token invalide" });
  }
};

// -------------------------
// GET utilisateurs
// -------------------------
router.get("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  
  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    const result = await pool.query(`
      SELECT 
        id,
        email,
        role,
        date_creation,
        COALESCE(statut, 'actif') as statut,
        dernier_connexion
      FROM ${table} 
      ORDER BY id
    `);
    
    res.json({ data: result.rows });
  } catch (err) {
    console.error("Erreur GET /admin/:type:", err);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

// -------------------------
// CREATE utilisateur - CORRIGÉ POUR MATCHER VOTRE AUTH.JS
// -------------------------
router.post("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const { email, motDePasse } = req.body; // CHANGÉ: motDePasse au lieu de mot_de_passe

  console.log("📥 Création utilisateur:", { type, email });

  if (!email || !motDePasse) {
    return res.status(400).json({ message: "Email et mot de passe requis" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    const role = type === "administrateurs" ? "administrateur" : "gestionnaire";
    
    // Vérifier existence
    const exist = await pool.query(`SELECT id FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    await pool.query(
      `INSERT INTO ${table} (email, mot_de_passe, role, date_creation, statut) 
       VALUES ($1, $2, $3, NOW(), 'actif')`,
      [email, hashedPassword, role]
    );

    console.log("✅ Utilisateur créé:", email);
    res.status(201).json({ 
      message: `${role} créé avec succès`
    });
  } catch (err) {
    console.error("❌ Erreur création:", err);
    res.status(500).json({ message: "Erreur lors de la création" });
  }
});

// -------------------------
// UPDATE utilisateur - CORRIGÉ
// -------------------------
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;
  const { email, motDePasse, role, statut } = req.body; // CHANGÉ: motDePasse

  console.log("✏️ Update user:", { type, id, email, statut });

  if (!id) {
    return res.status(400).json({ message: "ID utilisateur requis" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
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

    if (role) {
      fields.push(`role = $${counter++}`);
      values.push(role);
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

    await pool.query(query, values);
    
    res.json({ 
      message: "Utilisateur mis à jour avec succès"
    });
  } catch (err) {
    console.error("❌ Erreur update:", err);
    res.status(500).json({ message: "Erreur lors de la mise à jour" });
  }
});

// -------------------------
// DELETE utilisateur
// -------------------------
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;

  console.log("🗑️ Delete user:", { type, id });

  if (!id) {
    return res.status(400).json({ message: "ID utilisateur requis" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
    res.json({ 
      message: "Utilisateur supprimé avec succès"
    });
  } catch (err) {
    console.error("❌ Erreur suppression:", err);
    res.status(500).json({ message: "Erreur lors de la suppression" });
  }
});

module.exports = router;