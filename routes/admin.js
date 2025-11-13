// 📂 routes/admin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware pour vérifier JWT et rôle admin
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token manquant" });

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "C4E_AFRICA_2025_SECRET");
    if (decoded.userType !== "administrateur") {
      return res.status(403).json({ message: "Accès interdit, uniquement admin" });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Token invalide" });
  }
};

// -------------------------
// GET utilisateurs (gestionnaires ou administrateurs)
// -------------------------
router.get("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type; // gestionnaires ou administrateurs
  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

// -------------------------
// CREATE utilisateur
// -------------------------
router.post("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type; // gestionnaires ou administrateurs
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) return res.status(400).json({ message: "Email et mot de passe requis." });

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    const exist = await pool.query(`SELECT * FROM ${table} WHERE email=$1`, [email]);
    if (exist.rows.length > 0) return res.status(409).json({ message: "Utilisateur déjà existant." });

    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    if (table === "admin") {
      await pool.query(`INSERT INTO admin (email, mot_de_passe, role, date_creation) VALUES ($1, $2, $3, NOW())`, [email, hashedPassword, "administrateur"]);
    } else {
      await pool.query(`INSERT INTO gestionnaires (email, mot_de_passe, role) VALUES ($1, $2, $3)`, [email, hashedPassword, "gestionnaire"]);
    }

    res.status(201).json({ message: "Utilisateur créé avec succès." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

// -------------------------
// UPDATE utilisateur
// -------------------------
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;
  const { email, motDePasse, role, statut } = req.body;

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    let query = "UPDATE " + table + " SET ";
    const fields = [];
    const values = [];
    let counter = 1;

    if (email) {
      fields.push(`email=$${counter++}`);
      values.push(email);
    }
    if (motDePasse) {
      const hash = await bcrypt.hash(motDePasse, 10);
      fields.push(`mot_de_passe=$${counter++}`);
      values.push(hash);
    }
    if (role) {
      fields.push(`role=$${counter++}`);
      values.push(role);
    }
    if (statut) {
      fields.push(`statut=$${counter++}`);
      values.push(statut);
    }

    if (fields.length === 0) return res.status(400).json({ message: "Aucun champ à mettre à jour." });

    const sql = `${query} ${fields.join(", ")} WHERE id=$${counter}`;
    values.push(id);

    await pool.query(sql, values);
    res.json({ message: "Utilisateur mis à jour avec succès." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

// -------------------------
// DELETE utilisateur
// -------------------------
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    res.json({ message: "Utilisateur supprimé avec succès." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Erreur serveur." });
  }
});

module.exports = router;
