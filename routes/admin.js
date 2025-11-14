const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware COMPLÈTEMENT CORRIGÉ
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
    
    // Vérification robuste du token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("🔐 Token décodé:", decoded);
    
    // CORRECTION : Vérification flexible des rôles admin
    const userRole = decoded.role;
    const rolesAdmin = ["admin", "administrateur", "superadmin"];
    const isAdmin = rolesAdmin.includes(userRole?.toLowerCase());
    
    console.log("🔐 Rôle utilisateur:", userRole, "Est admin:", isAdmin);
    
    if (!isAdmin) {
      return res.status(403).json({ 
        message: "Accès réservé aux administrateurs",
        votreRole: userRole,
        rolesAutorises: rolesAdmin
      });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Erreur vérification token:", err.message);
    
    // Gestion détaillée des erreurs JWT
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expiré - Veuillez vous reconnecter" });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Token invalide" });
    } else if (err.name === "NotBeforeError") {
      return res.status(401).json({ message: "Token pas encore valide" });
    } else {
      return res.status(401).json({ message: "Erreur d'authentification: " + err.message });
    }
  }
};

// GET utilisateurs - VERSION AMÉLIORÉE
router.get("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 GET reçu - Type:", req.params.type);
    console.log("👤 Utilisateur faisant la requête:", req.user);
    
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
      total: result.rows.length,
      type: req.params.type
    });
  } catch (err) {
    console.error("❌ GET error:", err);
    res.status(500).json({ 
      message: "Erreur serveur lors du chargement",
      error: err.message 
    });
  }
});

// CREATE utilisateur - VERSION ROBUSTE
router.post("/:type", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 POST reçu - Type:", req.params.type);
    console.log("📦 Body reçu:", req.body);
    console.log("👤 Créateur:", req.user);
    
    const { email, motDePasse } = req.body;
    
    // Validation des champs
    if (!email || !motDePasse) {
      return res.status(400).json({ 
        message: "Email et mot de passe requis",
        champsManquants: {
          email: !email,
          motDePasse: !motDePasse
        }
      });
    }

    // Validation email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Format d'email invalide" });
    }

    const table = req.params.type === "administrateurs" ? "admin" : "gestionnaires";
    const role = req.params.type === "administrateurs" ? "admin" : "gestionnaire";
    
    console.log("🔍 Vérification existence email:", email);
    
    // Vérifier existence avec gestion d'erreur
    const exist = await pool.query(`SELECT id, email FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      console.log("❌ Email déjà utilisé:", email);
      return res.status(409).json({ 
        message: "Email déjà utilisé",
        emailExistant: exist.rows[0].email
      });
    }

    console.log("🔐 Hashage du mot de passe...");
    const hashedPassword = await bcrypt.hash(motDePasse, 12);

    console.log("💾 Insertion en base...");
    const result = await pool.query(
      `INSERT INTO ${table} (email, mot_de_passe, role, date_creation, statut) 
       VALUES ($1, $2, $3, NOW(), 'actif') 
       RETURNING id, email, role, date_creation, statut`,
      [email, hashedPassword, role]
    );

    const nouvelUtilisateur = result.rows[0];
    console.log("✅ Utilisateur créé:", nouvelUtilisateur);
    
    res.status(201).json({ 
      message: `${req.params.type === "administrateurs" ? "Administrateur" : "Gestionnaire"} créé avec succès`,
      success: true,
      user: nouvelUtilisateur,
      type: req.params.type
    });
  } catch (err) {
    console.error("❌ CREATE error détaillé:", err);
    res.status(500).json({ 
      message: "Erreur lors de la création: " + err.message,
      code: err.code,
      detail: err.detail
    });
  }
});

// UPDATE utilisateur - VERSION AMÉLIORÉE
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 PUT reçu - Type:", req.params.type, "ID:", req.params.id);
    console.log("📦 Body:", req.body);
    
    const { email, motDePasse, role, statut } = req.body;
    const { type, id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: "ID utilisateur valide requis" });
    }

    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT id, email FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ 
        message: "Utilisateur non trouvé",
        id: id,
        table: table
      });
    }

    let query = `UPDATE ${table} SET `;
    const fields = [];
    const values = [];
    let counter = 1;

    if (email) {
      // Validation email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ message: "Format d'email invalide" });
      }
      
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
      if (motDePasse.length < 6) {
        return res.status(400).json({ message: "Le mot de passe doit faire au moins 6 caractères" });
      }
      const hash = await bcrypt.hash(motDePasse, 12);
      fields.push(`mot_de_passe = $${counter++}`);
      values.push(hash);
    }

    if (role) {
      const rolesValides = ["admin", "gestionnaire", "superadmin"];
      if (!rolesValides.includes(role)) {
        return res.status(400).json({ 
          message: "Rôle invalide",
          rolesValides: rolesValides 
        });
      }
      fields.push(`role = $${counter++}`);
      values.push(role);
    }

    if (statut) {
      if (!['actif', 'inactif'].includes(statut)) {
        return res.status(400).json({ 
          message: "Statut doit être 'actif' ou 'inactif'",
          statutRecu: statut
        });
      }
      fields.push(`statut = $${counter++}`);
      values.push(statut);
    }

    if (fields.length === 0) {
      return res.status(400).json({ message: "Aucun champ à mettre à jour" });
    }

    query += fields.join(", ") + `, date_maj = NOW() WHERE id = $${counter}`;
    values.push(id);

    console.log("🛠️ Query UPDATE:", query);
    console.log("📋 Values:", values);

    const result = await pool.query(query, values);
    
    console.log("✅ UPDATE réussi - Rows affected:", result.rowCount);
    
    res.json({ 
      message: "Utilisateur mis à jour avec succès",
      success: true,
      rowsUpdated: result.rowCount
    });
  } catch (err) {
    console.error("❌ UPDATE error:", err);
    res.status(500).json({ 
      message: "Erreur lors de la mise à jour: " + err.message,
      code: err.code
    });
  }
});

// DELETE utilisateur - VERSION SÉCURISÉE
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  try {
    console.log("📥 DELETE reçu - Type:", req.params.type, "ID:", req.params.id);
    console.log("👤 Demandeur:", req.user);
    
    const { type, id } = req.params;

    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: "ID utilisateur valide requis" });
    }

    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT id, email FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      return res.status(404).json({ 
        message: "Utilisateur non trouvé",
        id: id,
        table: table
      });
    }

    const userToDelete = userExists.rows[0];
    
    // Empêcher l'auto-suppression
    if (req.user.id === parseInt(id)) {
      return res.status(403).json({ 
        message: "Vous ne pouvez pas supprimer votre propre compte",
        votreId: req.user.id,
        idTentative: id
      });
    }

    console.log("🗑️ Suppression de:", userToDelete.email);
    
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
    console.log("✅ DELETE réussi - Rows affected:", result.rowCount);
    
    res.json({ 
      message: "Utilisateur supprimé avec succès",
      success: true,
      userSupprime: userToDelete.email,
      rowsDeleted: result.rowCount
    });
  } catch (err) {
    console.error("❌ DELETE error:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression: " + err.message,
      code: err.code
    });
  }
});

// Route santé pour tester le middleware
router.get("/sante/check-auth", verifyAdmin, (req, res) => {
  res.json({
    message: "Middleware admin fonctionnel",
    user: req.user,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;