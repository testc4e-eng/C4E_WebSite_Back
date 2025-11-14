// 📂 routes/admin.js - VERSION COMPLÈTE AVEC DÉBOGAGE
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// Middleware pour vérifier JWT et rôle admin - AVEC DÉBOGAGE COMPLET
const verifyAdmin = (req, res, next) => {
  console.log("=== MIDDLEWARE ADMIN DEBUG ===");
  console.log("📨 Méthode:", req.method);
  console.log("🔗 URL:", req.url);
  console.log("📋 Authorization Header:", req.headers.authorization ? "Présent" : "Manquant");
  
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    console.log("❌ Aucun header Authorization");
    return res.status(401).json({ message: "Token manquant" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.log("❌ Token mal formaté");
    return res.status(401).json({ message: "Token mal formaté" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token décodé avec succès");
    console.log("🔍 Contenu du token:", decoded);
    
    // DEBUG: Afficher toutes les propriétés du token
    console.log("🎯 Rôle:", decoded.role);
    console.log("📝 Type:", decoded.type);
    console.log("📧 Email:", decoded.email);
    
    // Vérification FLEXIBLE du rôle
    const userRole = decoded.role;
    const userType = decoded.type;
    
    console.log("🔐 Vérification des droits...");
    console.log("   - Rôle:", userRole);
    console.log("   - Type:", userType);
    
    const isAdmin = userRole === "administrateur" || 
                   userRole === "admin" || 
                   userRole === "administrator" ||
                   userType === "admin";
    
    console.log("   - Est admin?", isAdmin);
    
    if (!isAdmin) {
      console.log("❌ Rôle insuffisant");
      console.log("   - Rôle actuel:", userRole);
      console.log("   - Type actuel:", userType);
      console.log("   - Rôles acceptés: administrateur, admin, administrator");
      
      return res.status(403).json({ 
        message: "Accès réservé aux administrateurs",
        votreRole: userRole,
        votreType: userType,
        required: "administrateur ou admin"
      });
    }
    
    console.log("✅ Accès autorisé pour:", decoded.email);
    req.user = decoded;
    next();
  } catch (err) {
    console.log("❌ Erreur de vérification du token:");
    console.log("   - Type:", err.name);
    console.log("   - Message:", err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: "Token expiré" });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: "Token invalide" });
    }
    
    return res.status(401).json({ message: "Erreur token: " + err.message });
  }
};

// -------------------------
// GET utilisateurs
// -------------------------
router.get("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  console.log(`📥 GET ${type} demandé par:`, req.user.email);
  
  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    console.log(`🔍 Récupération depuis la table: ${table}`);
    
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
    
    console.log(`✅ ${result.rows.length} ${type} trouvés`);
    res.json({ data: result.rows });
  } catch (err) {
    console.error("❌ Erreur GET /admin/:type:", err);
    res.status(500).json({ message: "Erreur serveur lors de la récupération" });
  }
});

// -------------------------
// CREATE utilisateur - AVEC DÉBOGAGE COMPLET
// -------------------------
router.post("/:type", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const { email, motDePasse } = req.body;

  console.log("=== CRÉATION UTILISATEUR ===");
  console.log("👤 Demandé par:", req.user.email);
  console.log("📥 Type:", type);
  console.log("📧 Email:", email);
  console.log("🔐 Mot de passe fourni:", motDePasse ? "OUI" : "NON");
  console.log("📦 Body complet:", req.body);

  if (!email || !motDePasse) {
    console.log("❌ Champs manquants:");
    console.log("   - Email:", email ? "Fourni" : "Manquant");
    console.log("   - Mot de passe:", motDePasse ? "Fourni" : "Manquant");
    return res.status(400).json({ message: "Email et mot de passe requis" });
  }

  // Validation email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.log("❌ Format email invalide:", email);
    return res.status(400).json({ message: "Format d'email invalide" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    const role = type === "administrateurs" ? "administrateur" : "gestionnaire";
    
    console.log(`🔍 Vérification existence dans ${table}...`);
    
    // Vérifier existence
    const exist = await pool.query(`SELECT id FROM ${table} WHERE email = $1`, [email]);
    if (exist.rows.length > 0) {
      console.log("❌ Email déjà utilisé:", email);
      return res.status(409).json({ message: "Email déjà utilisé" });
    }

    console.log("🔐 Hashage du mot de passe...");
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    console.log("💾 Insertion en base...");
    const insertQuery = `
      INSERT INTO ${table} (email, mot_de_passe, role, date_creation, statut) 
      VALUES ($1, $2, $3, NOW(), 'actif')
      RETURNING id, email, role
    `;
    
    const result = await pool.query(insertQuery, [email, hashedPassword, role]);

    console.log("✅ Utilisateur créé avec succès:");
    console.log("   - ID:", result.rows[0].id);
    console.log("   - Email:", result.rows[0].email);
    console.log("   - Rôle:", result.rows[0].role);
    
    res.status(201).json({ 
      message: `${role} créé avec succès`,
      user: result.rows[0]
    });
  } catch (err) {
    console.error("❌ Erreur création:", err);
    res.status(500).json({ 
      message: "Erreur lors de la création",
      error: err.message 
    });
  }
});

// -------------------------
// UPDATE utilisateur - AVEC DÉBOGAGE
// -------------------------
router.put("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;
  const { email, motDePasse, role, statut } = req.body;

  console.log("=== MISE À JOUR UTILISATEUR ===");
  console.log("👤 Demandé par:", req.user.email);
  console.log("📝 Type:", type);
  console.log("🆔 ID:", id);
  console.log("📧 Nouvel email:", email);
  console.log("🔐 Nouveau mot de passe:", motDePasse ? "Fourni" : "Non fourni");
  console.log("🎯 Nouveau rôle:", role);
  console.log("📊 Nouveau statut:", statut);

  if (!id) {
    console.log("❌ ID manquant");
    return res.status(400).json({ message: "ID utilisateur requis" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";

    console.log(`🔍 Vérification existence de l'utilisateur ${id} dans ${table}...`);
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      console.log("❌ Utilisateur non trouvé, ID:", id);
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    console.log("✅ Utilisateur trouvé:", userExists.rows[0].email);

    let query = `UPDATE ${table} SET `;
    const fields = [];
    const values = [];
    let counter = 1;

    if (email) {
      console.log("🔍 Vérification disponibilité email...");
      const emailCheck = await pool.query(
        `SELECT id FROM ${table} WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        console.log("❌ Email déjà utilisé:", email);
        return res.status(409).json({ message: "Cet email est déjà utilisé" });
      }
      fields.push(`email = $${counter++}`);
      values.push(email);
      console.log("✅ Email disponible");
    }

    if (motDePasse) {
      console.log("🔐 Hashage du nouveau mot de passe...");
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
        console.log("❌ Statut invalide:", statut);
        return res.status(400).json({ message: "Statut doit être 'actif' ou 'inactif'" });
      }
      fields.push(`statut = $${counter++}`);
      values.push(statut);
    }

    if (fields.length === 0) {
      console.log("❌ Aucun champ à mettre à jour");
      return res.status(400).json({ message: "Aucun champ à mettre à jour" });
    }

    query += fields.join(", ") + ` WHERE id = $${counter}`;
    values.push(id);

    console.log("💾 Exécution de la requête:", query);
    console.log("📋 Valeurs:", values);

    await pool.query(query, values);
    
    console.log("✅ Utilisateur mis à jour avec succès");
    res.json({ 
      message: "Utilisateur mis à jour avec succès",
      updatedFields: fields
    });
  } catch (err) {
    console.error("❌ Erreur mise à jour:", err);
    res.status(500).json({ 
      message: "Erreur lors de la mise à jour",
      error: err.message 
    });
  }
});

// -------------------------
// DELETE utilisateur - AVEC DÉBOGAGE
// -------------------------
router.delete("/:type/:id", verifyAdmin, async (req, res) => {
  const type = req.params.type;
  const id = req.params.id;

  console.log("=== SUPPRESSION UTILISATEUR ===");
  console.log("👤 Demandé par:", req.user.email);
  console.log("🗑️ Type:", type);
  console.log("🆔 ID:", id);

  if (!id) {
    console.log("❌ ID manquant");
    return res.status(400).json({ message: "ID utilisateur requis" });
  }

  try {
    const table = type === "administrateurs" ? "admin" : "gestionnaires";
    
    console.log(`🔍 Vérification existence de l'utilisateur ${id} dans ${table}...`);
    
    // Vérifier que l'utilisateur existe
    const userExists = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    if (userExists.rows.length === 0) {
      console.log("❌ Utilisateur non trouvé, ID:", id);
      return res.status(404).json({ message: "Utilisateur non trouvé" });
    }

    console.log("✅ Utilisateur trouvé:", userExists.rows[0].email);

    // Empêcher la suppression du dernier administrateur
    if (table === "admin") {
      const adminCount = await pool.query(`SELECT COUNT(*) FROM admin`);
      const count = parseInt(adminCount.rows[0].count);
      console.log(`🔢 Nombre d'administrateurs: ${count}`);
      
      if (count <= 1) {
        console.log("❌ Impossible de supprimer le dernier administrateur");
        return res.status(400).json({ message: "Impossible de supprimer le dernier administrateur" });
      }
    }

    console.log("🗑️ Suppression de l'utilisateur...");
    await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    
    console.log("✅ Utilisateur supprimé avec succès");
    res.json({ 
      message: "Utilisateur supprimé avec succès",
      deletedUser: userExists.rows[0].email
    });
  } catch (err) {
    console.error("❌ Erreur suppression:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression",
      error: err.message 
    });
  }
});

module.exports = router;