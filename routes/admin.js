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
// 📂 routes/admin.js - CORRECTION DE LA ROUTE CREATE
// 📂 routes/admin.js - VERSION AVEC DEBUG COMPLET
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("=== DÉBUT CRÉATION UTILISATEUR ===");
    console.log("📥 POST reçu - Type:", req.params.type);
    console.log("📦 Body reçu:", JSON.stringify(req.body, null, 2));
    
    const { email, motDePasse, nom } = req.body;
    
    // Validation détaillée
    if (!email) {
      console.log("❌ Email manquant");
      return res.status(400).json({ message: "Email requis" });
    }
    if (!motDePasse) {
      console.log("❌ Mot de passe manquant");
      return res.status(400).json({ message: "Mot de passe requis" });
    }

    console.log("🔍 Validation de l'email...");
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log("❌ Format email invalide:", email);
      return res.status(400).json({ message: "Format d'email invalide" });
    }

    // Déterminer le type d'utilisateur
    const userType = req.params.type === "administrateurs" ? "administrateur" : "gestionnaire";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🎯 Type utilisateur:", userType, "Role:", role);
    
    console.log("🔍 Vérification email dans la base...");
    // Vérifier si l'email existe déjà
    const exist = await pool.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      console.log("❌ Email déjà utilisé:", email);
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    console.log("🔐 Hashage mot de passe...");
    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(motDePasse, 10);
    console.log("✅ Mot de passe hashé");

    console.log("💾 Préparation insertion en base...");
    const query = `
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
      VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
      RETURNING id, nom, email, role, type, date_creation, statut
    `;
    const values = [nom || 'Utilisateur', email, hashedPassword, role, userType];
    
    console.log("📝 Query:", query);
    console.log("🎯 Values:", values);

    console.log("🚀 Exécution de la requête...");
    const result = await pool.query(query, values);
    console.log("✅ Insertion réussie:", result.rows[0]);

    console.log("=== FIN CRÉATION UTILISATEUR ===");
    
    res.status(201).json({ 
      message: `${userType === "administrateur" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ ERREUR CRITIQUE DANS CREATE:");
    console.error("🔴 Message:", err.message);
    console.error("🔴 Code:", err.code);
    console.error("🔴 Stack:", err.stack);
    console.error("🔴 Detail:", err.detail);
    
    let errorMessage = "Erreur serveur lors de la création";
    let statusCode = 500;
    
    if (err.code === '23505') {
      errorMessage = "Cet email est déjà utilisé";
      statusCode = 409;
    } else if (err.code === '23502') {
      errorMessage = "Données manquantes requises";
      statusCode = 400;
    } else if (err.code === '22P02') {
      errorMessage = "Format de données invalide";
      statusCode = 400;
    }
    
    res.status(statusCode).json({ 
      message: errorMessage,
      error: err.message,
      code: err.code,
      detail: err.detail
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
router.put("/:type/:id/password", verifyAdmin, async (req, res) => {
  try {
    console.log("🔄 PUT reçu - Mise à jour mot de passe");
    console.log("📦 Body reçu:", req.body);
    
    const { type, id } = req.params;
    const { nouveauMotDePasse, confirmationMotDePasse } = req.body;
    
    // Validation des données
    if (!nouveauMotDePasse || !confirmationMotDePasse) {
      return res.status(400).json({ 
        message: "Le nouveau mot de passe et la confirmation sont requis" 
      });
    }
    
    if (nouveauMotDePasse !== confirmationMotDePasse) {
      return res.status(400).json({ 
        message: "Les mots de passe ne correspondent pas" 
      });
    }
    
    if (nouveauMotDePasse.length < 6) {
      return res.status(400).json({ 
        message: "Le mot de passe doit contenir au moins 6 caractères" 
      });
    }
    
    // Vérifier que l'utilisateur existe
    const userCheck = await pool.query(
      `SELECT id, email FROM utilisateurs WHERE id = $1 AND type = $2`,
      [id, type === "administrateurs" ? "administrateur" : "gestionnaire"]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: "Utilisateur non trouvé" 
      });
    }
    
    console.log("🔐 Hashage du nouveau mot de passe...");
    // Hashage du nouveau mot de passe
    const hashedPassword = await bcrypt.hash(nouveauMotDePasse, 10);
    
    console.log("💾 Mise à jour en base...");
    // Mise à jour du mot de passe
    await pool.query(
      `UPDATE utilisateurs 
       SET mot_de_passe = $1, date_modification = NOW() 
       WHERE id = $2`,
      [hashedPassword, id]
    );
    
    console.log("✅ Mot de passe mis à jour avec succès");
    
    res.json({ 
      message: "Mot de passe mis à jour avec succès",
      success: true
    });
    
  } catch (err) {
    console.error("❌ ERREUR UPDATE PASSWORD:", err);
    
    res.status(500).json({ 
      message: "Erreur serveur lors de la mise à jour du mot de passe",
      error: err.message 
    });
  }
});
router.put("/:type/:id/status", verifyAdmin, async (req, res) => {
  try {
    console.log("🔄 PUT reçu - Changement de statut");
    console.log("📦 Body reçu:", req.body);
    
    const { type, id } = req.params;
    const { statut } = req.body;
    
    // Validation
    if (!statut || !["actif", "inactif"].includes(statut)) {
      return res.status(400).json({ 
        message: "Statut invalide. Doit être 'actif' ou 'inactif'" 
      });
    }
    
    // Vérifier que l'utilisateur existe
    const userCheck = await pool.query(
      `SELECT id, email FROM utilisateurs WHERE id = $1 AND type = $2`,
      [id, type === "administrateurs" ? "administrateur" : "gestionnaire"]
    );
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ 
        message: "Utilisateur non trouvé" 
      });
    }
    
    console.log("💾 Mise à jour du statut en base...");
    // Mise à jour du statut
    const result = await pool.query(
      `UPDATE utilisateurs 
       SET statut = $1, date_modification = NOW() 
       WHERE id = $2
       RETURNING id, nom, email, role, type, statut, date_creation`,
      [statut, id]
    );
    
    console.log("✅ Statut mis à jour avec succès");
    
    res.json({ 
      message: "Statut utilisateur mis à jour avec succès",
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ ERREUR UPDATE STATUS:", err);
    
    res.status(500).json({ 
      message: "Erreur serveur lors de la mise à jour du statut",
      error: err.message 
    });
  }
});

router.get("/utilisateurs", verifyAdmin, async (req, res) => {
  try {
    console.log("🔍 Récupération de tous les utilisateurs...");
    
    const result = await pool.query(`
      SELECT id, nom, email, role, type, statut, 
             date_creation, dernier_connexion, sites_geres
      FROM utilisateurs 
      WHERE type IN ('gestionnaire', 'administrateur')
      ORDER BY date_creation DESC
    `);
    
    console.log(`✅ ${result.rows.length} utilisateurs trouvés`);
    res.json(result.rows);
    
  } catch (err) {
    console.error('❌ Erreur /api/admin/utilisateurs:', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des utilisateurs',
      error: err.message 
    });
  }
});

module.exports = router;