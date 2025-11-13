const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

router.post("/login", async (req, res) => {
  const { email, motDePasse, userType } = req.body;

  if (!email || !motDePasse || !userType) {
    return res.status(400).json({ message: "Email, mot de passe et type d'utilisateur sont requis." });
  }

  try {
    // Choisir la table selon le type
    const table = userType === "administrateur" ? "admin" : "gestionnaires";

    // Récupérer l’utilisateur depuis la table correspondante
const result = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);
const rows = result.rows;

    if (rows.length === 0) {
      return res.status(401).json({ message: "Utilisateur non trouvé." });
    }

    const user = rows[0];

    // Vérifier le mot de passe haché
    const isMatch = await bcrypt.compare(motDePasse, user.mot_de_passe);
    if (!isMatch) {
      return res.status(401).json({ message: "Mot de passe incorrect." });
    }

    // Génération du token
    const token = jwt.sign(
      { id: user.id, email: user.email, userType },
      process.env.JWT_SECRET || "C4E_AFRICA_2025_SECRET",
      { expiresIn: "8h" }
    );

    // Réponse au frontend
    res.json({
      token,
      user: { id: user.id, email: user.email, userType },
    });
  } catch (err) {
    console.error("Erreur lors du login:", err);
    res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
});

module.exports = router;
