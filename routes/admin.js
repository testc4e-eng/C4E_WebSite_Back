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
// 📂 routes/admin.js - VERSION DÉBOGAGE ULTIME
router.post("/:type", verifyAdmin, async (req, res) => {
  let client;
  try {
    console.log("=== 🚨 DÉBUT CRÉATION UTILISATEUR 🚨 ===");
    console.log("📥 Headers:", req.headers);
    console.log("📦 Body COMPLET:", req.body);
    console.log("🔍 Type demandé:", req.params.type);
    
    // Vérifier que le body est bien parsé
    if (!req.body) {
      console.log("❌ Body vide ou non parsé");
      return res.status(400).json({ message: "Données manquantes" });
    }

    const { email, motDePasse, nom } = req.body;
    
    console.log("📋 Données extraites:", { email, motDePasse: motDePasse ? "***" : "MANQUANT", nom });

    // Validation basique
    if (!email || !motDePasse) {
      console.log("❌ Champs manquants - email:", !!email, "motDePasse:", !!motDePasse);
      return res.status(400).json({ 
        message: "Email et mot de passe requis",
        received: { email: !!email, motDePasse: !!motDePasse, nom: !!nom }
      });
    }

    // Tester la connexion à la base FIRST
    console.log("🔌 Test connexion base de données...");
    client = await pool.connect();
    console.log("✅ Connexion BD OK");

    // Vérifier si la table existe
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'utilisateurs'
      );
    `);
    console.log("📊 Table utilisateurs existe:", tableCheck.rows[0].exists);

    if (!tableCheck.rows[0].exists) {
      throw new Error("Table 'utilisateurs' n'existe pas");
    }

    // Vérifier la structure de la table
    const structure = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'utilisateurs'
      ORDER BY ordinal_position;
    `);
    console.log("🏗️ Structure table:", structure.rows);

    // Vérifier email unique
    console.log("🔎 Vérification email unique...");
    const exist = await client.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email]);
    console.log("📧 Email existe déjà:", exist.rows.length > 0);

    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    // Hashage mot de passe
    console.log("🔐 Hashage mot de passe...");
    const hashedPassword = await bcrypt.hash(motDePasse, 10);
    console.log("✅ Mot de passe hashé");

    // Déterminer type et rôle
    const userType = req.params.type === "administrateurs" ? "administrateur" : "gestionnaire";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🎯 Type final:", userType, "Rôle:", role);

    // Insertion
    console.log("💾 Insertion en cours...");
    const query = `
      INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
      VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
      RETURNING id, nom, email, role, type, date_creation, statut
    `;
    const values = [nom || 'Utilisateur', email, hashedPassword, role, userType];
    
    console.log("📝 Query:", query);
    console.log("🎯 Values:", values);

    const result = await client.query(query, values);
    console.log("✅ Insertion réussie:", result.rows[0]);

    console.log("=== 🎉 CRÉATION RÉUSSIE 🎉 ===");
    
    res.status(201).json({ 
      message: "Utilisateur créé avec succès",
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ 🚨 ERREUR CRITIQUE 🚨");
    console.error("🔴 Message:", err.message);
    console.error("🔴 Code:", err.code);
    console.error("🔴 Stack:", err.stack);
    
    // Erreur détaillée
    const errorResponse = {
      message: "Erreur lors de la création",
      error: err.message,
      code: err.code,
      detail: err.detail,
      routine: err.routine
    };
    
    console.error("📤 Réponse d'erreur:", errorResponse);
    
    res.status(500).json(errorResponse);
    
  } finally {
    if (client) {
      client.release();
      console.log("🔌 Connexion BD libérée");
    }
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