// 📂 routes/admin.js - VERSION FINALE CORRECTE
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware CORRIGÉ - Accepte "admin" comme rôle valide
const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Token manquant ou mal formaté" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // CORRECTION : Accepte "admin" comme rôle administrateur
    const userRole = decoded.role;
    const isAdmin = userRole === "admin" || userRole === "administrateur";
    
    console.log("🔐 Vérification admin - Rôle:", userRole, "Est admin:", isAdmin);
    
    if (!isAdmin) {
      return res.status(403).json({ 
        message: "Accès réservé aux administrateurs",
        votreRole: userRole
      });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Middleware admin error:", err.message);
    return res.status(401).json({ message: "Token invalide ou expiré" });
  }
};

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

// CREATE utilisateur
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    const { email, motDePasse } = req.body;
    
    if (!email || !motDePasse) {
      return res.status(400).json({ message: "Email et mot de passe requis" });
    }

    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire"; // CORRIGÉ: "admin" au lieu de "administrateur"
    
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

    res.status(201).json({ 
      message: `${req.params.type === "administrateurs" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true
    });
  } catch (err) {
    console.error("CREATE error:", err);
    res.status(500).json({ message: "Erreur lors de la création" });
  }
});

// UPDATE utilisateur
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    const { email, motDePasse, role, statut } = req.body;
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
      message: "Utilisateur mis à jour avec succès",
      success: true
    });
  } catch (err) {
    console.error("UPDATE error:", err);
    res.status(500).json({ message: "Erreur lors de la mise à jour" });
  }
});

// DELETE utilisateur
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "ID utilisateur requis" });
    }

    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT id, email FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

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