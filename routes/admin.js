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
    
    // Sélectionner les champs avec des valeurs par défaut pour la cohérence
    let query = `
      SELECT 
        id,
        email,
        role,
        date_creation,
        COALESCE(statut, 'actif') as statut,
        dernier_connexion
      FROM ${table} 
      ORDER BY id
    `;
    
    const result = await pool.query(query);
    
    // Formater les données pour le frontend
    const formattedUsers = result.rows.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      date_creation: user.date_creation,
      statut: user.statut,
      dernier_connexion: user.dernier_connexion
    }));
    
    res.json({ data: formattedUsers });
  } catch (err) {
    console.error("Erreur GET /admin/:type:", err);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des utilisateurs." });
  }
});

// -------------------------
// CREATE utilisateur (CORRIGÉ)
// -------------------------
router.post("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type; // gestionnaires ou administrateurs
  const { email, mot_de_passe } = req.body; // CORRECTION: mot_de_passe au lieu de motDePasse

  console.log("Données reçues:", { email, type }); // Debug

  if (!email || !mot_de_passe) {
    return res.status(400).json({ message: "Email et mot de passe requis." });
  }

  // Validation email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Format d'email invalide." });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier si l'utilisateur existe déjà
    const exist = await pool.query(`SELECT * FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Utilisateur déjà existant." });
    }

    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
    const role = type === "administrateurs" ? "administrateur" : "gestionnaire";

    if (table === "admin") {
      await pool.query(
        `INSERT INTO admin (email, mot_de_passe, role, date_creation, statut) 
         VALUES ($1, $2, $3, NOW(), 'actif')`,
        [email, hashedPassword, role]
      );
    } else {
      // Pour les gestionnaires, s'assurer que tous les champs existent
      await pool.query(
        `INSERT INTO gestionnaires (email, mot_de_passe, role, date_creation, statut) 
         VALUES ($1, $2, $3, NOW(), 'actif')`,
        [email, hashedPassword, role]
      );
    }

    console.log("Utilisateur créé avec succès:", email);
    res.status(201).json({ 
      message: `${role} créé avec succès.`,
      user: { email, role, statut: 'actif' }
    });
  } catch (err) {
    console.error("Erreur création utilisateur:", err);
    res.status(500).json({ message: "Erreur serveur lors de la création de l'utilisateur." });
  }
});

// -------------------------
// UPDATE utilisateur (CORRIGÉ)
// -------------------------
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;
  const { email, mot_de_passe, role, statut } = req.body; // CORRECTION: mot_de_passe

  console.log("Update user:", { type, id, email, statut }); // Debug

  if (!id) {
    return res.status(400).json({ message: "ID utilisateur requis." });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    let query = `UPDATE ${table} SET `;
    const fields = [];
    const values = [];
    let counter = 1;

    if (email) {
      // Vérifier si le nouvel email n'est pas déjà utilisé par un autre utilisateur
      const emailCheck = await pool.query(
        `SELECT id FROM ${table} WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ message: "Cet email est déjà utilisé par un autre utilisateur." });
      }
      fields.push(`email = $${counter++}`);
      values.push(email);
    }

    if (mot_de_passe) {
      const hash = await bcrypt.hash(mot_de_passe, 10);
      fields.push(`mot_de_passe = $${counter++}`);
      values.push(hash);
    }

    if (role) {
      fields.push(`role = $${counter++}`);
      values.push(role);
    }

    if (statut) {
      if (!['actif', 'inactif'].includes(statut)) {
        return res.status(400).json({ message: "Statut doit être 'actif' ou 'inactif'." });
      }
      fields.push(`statut = $${counter++}`);
      values.push(statut);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Aucun champ à mettre à jour." });
    }

    query += fields.join(", ") + ` WHERE id = $${counter}`;
    values.push(id);

    await pool.query(query, values);
    
    res.json({ 
      message: "Utilisateur mis à jour avec succès.",
      updatedFields: fields
    });
  } catch (err) {
    console.error("Erreur update utilisateur:", err);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour." });
  }
});

// -------------------------
// DELETE utilisateur
// -------------------------
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;

  console.log("Delete user:", { type, id }); // Debug

  if (!id) {
    return res.status(400).json({ message: "ID utilisateur requis." });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé." });
    }

    // Empêcher la suppression du dernier administrateur
    if (table === "admin") {
      const adminCount = await pool.query(`SELECT COUNT(*) FROM admin`);
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ message: "Impossible de supprimer le dernier administrateur." });
      }
    }

    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
    res.json({ 
      message: "Utilisateur supprimé avec succès.",
      deletedUser: userExists.rows[0].email
    });
  } catch (err) {
    console.error("Erreur suppression utilisateur:", err);
    res.status(500).json({ message: "Erreur serveur lors de la suppression." });
  }
});

// -------------------------
// GET statistiques (NOUVEAU)
// -------------------------
router.get("/:type/stats", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  
  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN COALESCE(statut, 'actif') = 'actif' THEN 1 END) as actifs,
        COUNT(CASE WHEN COALESCE(statut, 'actif') = 'inactif' THEN 1 END) as inactifs
      FROM ${table}
    `);
    
    res.json(stats.rows[0]);
  } catch (err) {
    console.error("Erreur stats:", err);
    res.status(500).json({ message: "Erreur serveur lors du calcul des statistiques." });
  }
});

module.exports = router;