// 📂 routes/admin.js - VERSION COMPLÈTE CORRIGÉE
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

// ==================== ROUTES DE DIAGNOSTIC ====================

// Route de test simple
router.post("/test-debug", verifyAdmin, async (req, res) => {
  console.log("=== 🧪 ROUTE TEST DEBUG ===");
  console.log("📦 Body reçu:", req.body);
  
  try {
    // Test simple avec des données fixes
    const testEmail = `test${Date.now()}@test.com`;
    const testPassword = "test123";
    const hashedPassword = await bcrypt.hash(testPassword, 10);

    console.log("💾 Insertion test...");
    const result = await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
       VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
       RETURNING id, nom, email`,
      ['Test User', testEmail, hashedPassword, 'gestionnaire', 'gestionnaire']
    );

    console.log("✅ Test réussi:", result.rows[0]);
    
    res.json({ 
      success: true,
      message: "Test réussi - La base de données fonctionne",
      user: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Test échoué:", err.message);
    console.error("🔴 Détails:", err);
    
    res.status(500).json({ 
      success: false,
      error: err.message,
      code: err.code,
      detail: err.detail
    });
  }
});

// Route pour vérifier la structure de la table
router.get("/check-table", verifyAdmin, async (req, res) => {
  try {
    console.log("🔍 Vérification structure table...");
    
    // Vérifier si la table existe
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'utilisateurs'
      );
    `);
    
    // Vérifier la structure
    const structure = await pool.query(`
      SELECT column_name, data_type, is_nullable, character_maximum_length
      FROM information_schema.columns 
      WHERE table_name = 'utilisateurs'
      ORDER BY ordinal_position;
    `);
    
    // Vérifier les données existantes
    const existingUsers = await pool.query(`
      SELECT id, email, type, role FROM utilisateurs LIMIT 5;
    `);
    
    res.json({
      tableExists: tableExists.rows[0].exists,
      structure: structure.rows,
      existingUsers: existingUsers.rows,
      totalUsers: existingUsers.rows.length
    });
    
  } catch (err) {
    console.error("❌ Erreur vérification:", err);
    res.status(500).json({ error: err.message });
  }
});

// Route de création ultra-simplifiée
router.post("/simple-create", verifyAdmin, async (req, res) => {
  console.log("=== 🎯 SIMPLE CREATE ===");
  console.log("📦 Body:", JSON.stringify(req.body, null, 2));
  
  try {
    const { email, motDePasse, nom } = req.body;
    
    // Validation minimale
    if (!email || !motDePasse) {
      return res.status(400).json({ 
        message: "Email et mot de passe requis",
        received: { email: !!email, motDePasse: !!motDePasse }
      });
    }
    
    // Hash simple
    const hashedPassword = await bcrypt.hash(motDePasse, 10);
    
    // Insertion simple
    const result = await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
       VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
       RETURNING id, nom, email, role, type`,
      [nom || 'Utilisateur', email, hashedPassword, 'gestionnaire', 'gestionnaire']
    );
    
    res.json({ 
      success: true,
      message: "Utilisateur créé",
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ Simple create error:", err);
    res.status(500).json({ 
      success: false,
      error: err.message,
      code: err.code
    });
  }
});

// ==================== ROUTES PRINCIPALES ====================

// CREATE utilisateur - VERSION CORRIGÉE ET SIMPLIFIÉE
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("=== DÉBUT CRÉATION UTILISATEUR ===");
    console.log("📦 Body reçu:", req.body);
    console.log("🔍 Type demandé:", req.params.type);
    
    const { email, motDePasse, nom } = req.body;
    
    // Validation
    if (!email || !motDePasse) {
      return res.status(400).json({ 
        message: "Email et mot de passe requis",
        received: { email: !!email, motDePasse: !!motDePasse, nom: !!nom }
      });
    }

    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Format d'email invalide" });
    }

    // Déterminer le type d'utilisateur
    const userType = req.params.type === "administrateurs" ? "administrateur" : "gestionnaire";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    // Vérifier si l'email existe déjà
    const exist = await pool.query(`SELECT id FROM utilisateurs WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    // Hashage du mot de passe
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    // Insertion
    const result = await pool.query(
      `INSERT INTO utilisateurs (nom, email, mot_de_passe, role, type, statut, date_creation) 
       VALUES ($1, $2, $3, $4, $5, 'actif', NOW()) 
       RETURNING id, nom, email, role, type, date_creation, statut`,
      [nom || 'Utilisateur', email, hashedPassword, role, userType]
    );

    console.log("✅ Utilisateur créé avec succès");
    
    res.status(201).json({ 
      message: `${userType === "administrateur" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: result.rows[0]
    });
    
  } catch (err) {
    console.error("❌ ERREUR CREATE:", err);
    
    // Gestion d'erreur détaillée
    let errorMessage = "Erreur serveur lors de la création";
    let statusCode = 500;
    
    if (err.code === '23505') {
      errorMessage = "Cet email est déjà utilisé";
      statusCode = 409;
    } else if (err.code === '23502') {
      errorMessage = "Données manquantes requises";
      statusCode = 400;
    }
    
    res.status(statusCode).json({ 
      message: errorMessage,
      error: err.message,
      code: err.code
    });
  }
});

// GET gestionnaires
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

// GET tous les utilisateurs
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

// DELETE utilisateur
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    
    const result = await pool.query(
      `DELETE FROM utilisateurs WHERE id = $1 AND type = $2`, 
      [id, type === "administrateurs" ? "administrateur" : "gestionnaire"]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }
    
    res.json({ 
      message: "Utilisateur supprimé avec succès",
      success: true
    });
  } catch (err) {
    console.error("DELETE error:", err);
    res.status(500).json({ message: "Erreur lors de la suppression" });
  }
});

// PUT - Changer le mot de passe
router.put("/:type/:id/password", verifyAdmin, async (req, res) => {
  try {
    console.log("🔄 PUT reçu - Mise à jour mot de passe");
    
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
    
    // Hashage du nouveau mot de passe
    const hashedPassword = await bcrypt.hash(nouveauMotDePasse, 10);
    
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

router.put("/change-password", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { currentPassword, newPassword, confirmPassword } = req.body;

    // validations
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ message: "Tous les champs sont requis" });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ message: "Les mots de passe ne correspondent pas" });
    }

    // Vérifier ancien mot de passe
    const user = await pool.query(
      "SELECT mot_de_passe FROM utilisateurs WHERE id = $1",
      [userId]
    );

    const isValid = await bcrypt.compare(currentPassword, user.rows[0].mot_de_passe);
    if (!isValid) {
      return res.status(400).json({ message: "Mot de passe actuel incorrect" });
    }

    // Hash + update
    const hashed = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE utilisateurs SET mot_de_passe = $1 WHERE id = $2",
      [hashed, userId]
    );

    res.json({ success: true, message: "Mot de passe modifié avec succès" });

  } catch (err) {
    res.status(500).json({ message: "Erreur serveur", error: err.message });
  }
});


// PUT - Changer le statut
router.put("/:type/:id/status", verifyAdmin, async (req, res) => {
  try {
    console.log("🔄 PUT reçu - Changement de statut");
    
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

module.exports = router;