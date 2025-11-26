const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Middleware de vérification de token
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        message: 'Token d\'authentification requis',
        code: 'TOKEN_MANQUANT'
      });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
    
  } catch (err) {
    console.error("❌ Erreur vérification token:", err.message);
    
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ 
        message: 'Token invalide',
        code: 'TOKEN_INVALIDE'
      });
    } else if (err.name === "TokenExpiredError") {
      return res.status(401).json({ 
        message: 'Token expiré',
        code: 'TOKEN_EXPIRE'
      });
    }
    
    return res.status(401).json({ 
      message: 'Erreur d\'authentification',
      code: 'ERREUR_AUTHENTIFICATION'
    });
  }
};

// POST /api/auth/login - VERSION CORRIGÉE
router.post('/login', async (req, res) => {
  const { email, motDePasse, type } = req.body;
  
  console.log("🔐 Tentative de connexion:", { 
    email: email, 
    type: type,
    hasPassword: !!motDePasse 
  });

  // Validation des champs requis
  if (!email || !motDePasse) {
    console.log("❌ Champs manquants");
    return res.status(400).json({ 
      message: 'Email et mot de passe requis.',
      champsManquants: {
        email: !email,
        motDePasse: !motDePasse
      }
    });
  }

  // Vérification JWT_SECRET
  if (!process.env.JWT_SECRET) {
    console.error('🚨 JWT_SECRET non défini !');
    return res.status(500).json({ 
      message: 'Erreur de configuration serveur.',
      code: 'JWT_SECRET_MANQUANT'
    });
  }

  try {
    // Recherche de l'utilisateur dans la table utilisateurs
    console.log("🔍 Recherche utilisateur:", email);
    const result = await pool.query(
      `SELECT id, nom, email, mot_de_passe, role, type, COALESCE(statut, 'actif') as statut 
       FROM utilisateurs 
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      console.log("❌ Utilisateur non trouvé:", email);
      return res.status(401).json({ 
        message: 'Email ou mot de passe incorrect.',
        code: 'UTILISATEUR_NON_TROUVE'
      });
    }

    const user = result.rows[0];
    console.log("👤 Utilisateur trouvé:", { 
      id: user.id, 
      nom: user.nom,
      email: user.email, 
      role: user.role,
      type: user.type,
      statut: user.statut 
    });

    // Vérification du statut
    if (user.statut !== 'actif') {
      console.log("❌ Compte inactif:", user.email);
      return res.status(403).json({ 
        message: 'Votre compte est désactivé. Contactez un administrateur.',
        code: 'COMPTE_DESACTIVE',
        statut: user.statut
      });
    }

    // Vérification du type si spécifié
    if (type && user.type !== type) {
      console.log("❌ Type incorrect:", { expected: type, actual: user.type });
      return res.status(401).json({ 
        message: 'Type de compte incorrect.',
        code: 'TYPE_INCORRECT'
      });
    }

    // Vérification du mot de passe
    console.log("🔐 Vérification mot de passe...");
    const match = await bcrypt.compare(motDePasse, user.mot_de_passe);

    if (!match) {
      console.log("❌ Mot de passe incorrect pour:", email);
      return res.status(401).json({ 
        message: 'Email ou mot de passe incorrect.',
        code: 'MOT_DE_PASSE_INCORRECT'
      });
    }

    // Mise à jour dernière connexion
    try {
      await pool.query(
        `UPDATE utilisateurs SET dernier_connexion = NOW() WHERE id = $1`,
        [user.id]
      );
      console.log("✅ Dernière connexion mise à jour");
    } catch (updateErr) {
      console.warn("⚠️ Erreur mise à jour dernière connexion:", updateErr.message);
    }

    // Génération du token JWT
    console.log("🎫 Génération du token JWT...");
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      type: user.type
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
      expiresIn: '24h' 
    });

    console.log("✅ Connexion réussie pour:", user.email);
    console.log("🔑 Token généré - Expiration: 24h");

    // Réponse réussie
    res.json({
      message: 'Connexion réussie',
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        type: user.type,
        statut: user.statut
      },
      token: token,
      expiresIn: '24h'
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/login:', err);
    res.status(500).json({ 
      message: 'Erreur serveur interne.',
      error: err.message,
      code: err.code
    });
  }
});

// POST /api/auth/verify - Vérification de token
router.post('/verify', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ 
      message: 'Token requis',
      valid: false
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier que l'utilisateur existe toujours dans la table utilisateurs
    const userExists = await pool.query(
      `SELECT id, email, role, type, COALESCE(statut, 'actif') as statut 
       FROM utilisateurs 
       WHERE id = $1 AND email = $2`,
      [decoded.id, decoded.email]
    );

    if (userExists.rows.length === 0) {
      return res.status(401).json({ 
        message: 'Utilisateur non trouvé',
        valid: false
      });
    }

    const user = userExists.rows[0];
    
    if (user.statut !== 'actif') {
      return res.status(403).json({ 
        message: 'Compte désactivé',
        valid: false,
        statut: user.statut
      });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        type: user.type
      },
      expiresIn: decoded.exp
    });

  } catch (err) {
    console.error('❌ Erreur vérification token:', err.message);
    
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ 
        message: 'Token expiré',
        valid: false,
        expired: true
      });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ 
        message: 'Token invalide',
        valid: false
      });
    } else {
      return res.status(401).json({ 
        message: 'Erreur de vérification',
        valid: false
      });
    }
  }
});

// GET /api/auth/me - Récupération info utilisateur connecté
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, nom, email, role, type, COALESCE(statut, 'actif') as statut, 
              date_creation, dernier_connexion, sites_geres
       FROM utilisateurs 
       WHERE id = $1 AND email = $2`,
      [req.user.id, req.user.email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ 
        message: 'Utilisateur non trouvé',
        authenticated: false
      });
    }

    const user = userResult.rows[0];
    
    res.json({
      authenticated: true,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        type: user.type,
        statut: user.statut,
        date_creation: user.date_creation,
        dernier_connexion: user.dernier_connexion,
        sites_geres: user.sites_geres
      }
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/me:', err.message);
    res.status(401).json({ 
      message: 'Erreur de récupération des informations utilisateur',
      authenticated: false,
      error: err.message
    });
  }
});

// 📂 routes/auth.js - CORRECTION ENDPOINT CHANGE-PASSWORD

// PUT /api/auth/change-password - VERSION CORRIGÉE
router.put('/change-password', verifyToken, async (req, res) => {
  console.log("=== 🔐 CHANGEMENT MOT DE PASSE ===");
  
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Log des entrées
    console.log("📦 Body reçu:", req.body);
    console.log("👤 User:", req.user);

    // Validation des champs
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: 'Tous les champs sont obligatoires',
        code: 'CHAMPS_MANQUANTS'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'Le nouveau mot de passe doit contenir au moins 6 caractères',
        code: 'MOT_DE_PASSE_TROP_COURT'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: 'Les nouveaux mots de passe ne correspondent pas',
        code: 'MOTS_DE_PASSE_DIFFERENTS'
      });
    }

    // Recherche de l'utilisateur
    console.log("🔍 Recherche utilisateur ID:", req.user.id);
    const userResult = await pool.query(
      `SELECT id, email, mot_de_passe, role, type, COALESCE(statut, 'actif') as statut 
       FROM utilisateurs 
       WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      console.log("❌ Utilisateur non trouvé");
      return res.status(404).json({ 
        message: 'Utilisateur non trouvé',
        code: 'UTILISATEUR_NON_TROUVE'
      });
    }

    const user = userResult.rows[0];
    
    // Vérification du statut
    if (user.statut !== 'actif') {
      return res.status(403).json({ 
        message: 'Compte désactivé',
        code: 'COMPTE_DESACTIVE'
      });
    }

    // Vérification du mot de passe actuel
    console.log("🔐 Vérification mot de passe actuel...");
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.mot_de_passe);
    
    if (!isCurrentPasswordValid) {
      console.log("❌ Mot de passe actuel incorrect");
      return res.status(401).json({ 
        message: 'Mot de passe actuel incorrect',
        code: 'MOT_DE_PASSE_ACTUEL_INCORRECT'
      });
    }

    // Vérification que le nouveau mot de passe est différent de l'ancien
    const isSamePassword = await bcrypt.compare(newPassword, user.mot_de_passe);
    if (isSamePassword) {
      return res.status(400).json({ 
        message: 'Le nouveau mot de passe doit être différent de l\'ancien',
        code: 'MOT_DE_PASSE_IDENTIQUE'
      });
    }

    // Hash du nouveau mot de passe
    console.log("🔑 Hash du nouveau mot de passe...");
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Mise à jour dans la base de données - SANS date_modification
    console.log("💾 Mise à jour en base de données...");
    const updateResult = await pool.query(
      `UPDATE utilisateurs 
       SET mot_de_passe = $1, date_creation = NOW() 
       WHERE id = $2
       RETURNING id, email`,
      [hashedNewPassword, user.id]
    );

    console.log("✅ Mot de passe changé avec succès pour:", user.email);

    res.json({
      message: 'Mot de passe changé avec succès',
      code: 'MOT_DE_PASSE_MODIFIE',
      success: true
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/change-password:', err);
    
    res.status(500).json({ 
      message: 'Erreur serveur lors du changement de mot de passe',
      code: 'ERREUR_SERVEUR',
      error: err.message
    });
  }
});

// POST /api/auth/change-password - Version alternative CORRIGÉE
router.post('/change-password', verifyToken, async (req, res) => {
  console.log("=== 🔐 CHANGEMENT MOT DE PASSE (POST) ===");
  
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // Validation des champs
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: 'Tous les champs sont obligatoires',
        code: 'CHAMPS_MANQUANTS'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: 'Le nouveau mot de passe doit contenir au moins 6 caractères',
        code: 'MOT_DE_PASSE_TROP_COURT'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: 'Les nouveaux mots de passe ne correspondent pas',
        code: 'MOTS_DE_PASSE_DIFFERENTS'
      });
    }

    // Recherche de l'utilisateur
    const userResult = await pool.query(
      `SELECT id, email, mot_de_passe, role, type, COALESCE(statut, 'actif') as statut 
       FROM utilisateurs 
       WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Utilisateur non trouvé',
        code: 'UTILISATEUR_NON_TROUVE'
      });
    }

    const user = userResult.rows[0];
    
    // Vérification du mot de passe actuel
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.mot_de_passe);
    
    if (!isCurrentPasswordValid) {
      return res.status(401).json({ 
        message: 'Mot de passe actuel incorrect',
        code: 'MOT_DE_PASSE_ACTUEL_INCORRECT'
      });
    }

    // Hash et mise à jour - SANS date_modification
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);
    await pool.query(
      `UPDATE utilisateurs 
       SET mot_de_passe = $1, date_creation = NOW() 
       WHERE id = $2`,
      [hashedNewPassword, user.id]
    );

    console.log("✅ Mot de passe changé avec succès (POST) pour:", user.email);

    res.json({
      message: 'Mot de passe changé avec succès',
      code: 'MOT_DE_PASSE_MODIFIE',
      success: true
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/change-password (POST):', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors du changement de mot de passe',
      code: 'ERREUR_SERVEUR',
      error: err.message
    });
  }
});

// POST /api/auth/forgot-password - Demande de réinitialisation (optionnel)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ 
      message: 'Email requis',
      code: 'EMAIL_REQUIS'
    });
  }

  try {
    // Vérifier si l'email existe
    const userResult = await pool.query(
      `SELECT id, email, nom FROM utilisateurs WHERE email = $1 AND statut = 'actif'`,
      [email]
    );

    if (userResult.rows.length === 0) {
      // Pour des raisons de sécurité, on ne révèle pas si l'email existe
      return res.json({
        message: 'Si votre email existe dans notre système, vous recevrez un lien de réinitialisation',
        code: 'EMAIL_ENVOYE_SI_EXISTE'
      });
    }

    const user = userResult.rows[0];
    
    // Ici vous devriez générer un token de réinitialisation et l'envoyer par email
    // Pour l'instant, on retourne juste un message de succès
    console.log(`📧 Réinitialisation demandée pour: ${email}`);
    
    res.json({
      message: 'Si votre email existe dans notre système, vous recevrez un lien de réinitialisation',
      code: 'DEMANDE_REINITIALISATION'
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/forgot-password:', err);
    res.status(500).json({ 
      message: 'Erreur lors de la demande de réinitialisation',
      code: 'ERREUR_DEMANDE_REINITIALISATION'
    });
  }
});

module.exports = router;