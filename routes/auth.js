const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Middleware verifyToken
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Token manquant" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Middleware verifyToken error:", err.message);
    
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expiré" });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Token invalide" });
    } else {
      return res.status(401).json({ message: "Erreur d'authentification" });
    }
  }
};

// Middleware verifyAdmin
const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Token manquant" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Vérifier si l'utilisateur est admin
    if (decoded.role !== 'admin' && decoded.type !== 'administrateur') {
      return res.status(403).json({ message: "Accès réservé aux administrateurs" });
    }
    
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Middleware verifyAdmin error:", err.message);
    
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Token expiré" });
    } else if (err.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Token invalide" });
    } else {
      return res.status(401).json({ message: "Erreur d'authentification" });
    }
  }
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  console.log("📨 REQUÊTE LOGIN REÇUE:");
  console.log("📨 Body:", req.body);
  
  const { email, motDePasse } = req.body;
  
  if (!email || !motDePasse) {
    console.log("❌ Champs manquants:", {
      email: email, 
      motDePasse: motDePasse
    });
    return res.status(400).json({ 
      message: 'Email et mot de passe requis.',
      champsManquants: {
        email: !email,
        motDePasse: !motDePasse
      }
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error('🚨 JWT_SECRET non défini !');
    return res.status(500).json({ 
      message: 'Erreur de configuration serveur.',
      code: 'JWT_SECRET_MANQUANT'
    });
  }

  try {
    console.log("🔍 Recherche dans la table utilisateurs...");
    const userResult = await pool.query(
      `SELECT id, nom, email, mot_de_passe, role, type, statut, sites_geres
       FROM utilisateurs 
       WHERE email = $1 AND statut = 'actif'`,
      [email]
    );

    if (userResult.rows.length === 0) {
      console.log("❌ Utilisateur non trouvé ou compte inactif:", email);
      return res.status(401).json({ 
        message: 'Email ou mot de passe incorrect.',
        code: 'UTILISATEUR_NON_TROUVE'
      });
    }

    const user = userResult.rows[0];
    console.log("👤 Utilisateur trouvé:", { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      type: user.type
    });

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
    console.log("👤 Type d'utilisateur:", user.type);

    // Réponse réussie
    res.json({
      message: 'Connexion réussie',
      token: token,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        type: user.type,
        statut: user.statut,
        sites_geres: user.sites_geres
      },
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

// Route pour vérifier le token
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
    
    const userExists = await pool.query(
      `SELECT id, email, role, type, statut, nom, prenom
       FROM utilisateurs 
       WHERE id = $1 AND email = $2 AND statut = 'actif'`,
      [decoded.id, decoded.email]
    );

    if (userExists.rows.length === 0) {
      return res.status(401).json({ 
        message: 'Utilisateur non trouvé ou compte inactif',
        valid: false
      });
    }

    const user = userExists.rows[0];
    
    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        type: user.type,
        nom: user.nom,
        prenom: user.prenom
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
    } else {
      return res.status(401).json({ 
        message: 'Token invalide',
        valid: false
      });
    }
  }
});

// Route pour obtenir les infos de l'utilisateur connecté
router.get('/me', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      message: 'Token manquant',
      authenticated: false
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const userResult = await pool.query(
      `SELECT id, email, role, type, statut, nom, prenom, 
              date_creation, dernier_connexion, telephone, sites_geres
       FROM utilisateurs 
       WHERE id = $1 AND email = $2 AND statut = 'actif'`,
      [decoded.id, decoded.email]
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
        email: user.email,
        role: user.role,
        type: user.type,
        statut: user.statut,
        nom: user.nom,
        prenom: user.prenom,
        telephone: user.telephone,
        sites_geres: user.sites_geres,
        date_creation: user.date_creation,
        dernier_connexion: user.dernier_connexion
      }
    });

  } catch (err) {
    console.error('❌ Erreur /api/auth/me:', err.message);
    res.status(401).json({ 
      message: 'Token invalide ou expiré',
      authenticated: false,
      error: err.message
    });
  }
});

// Route changement de mot de passe
router.put("/change-password", verifyToken, async (req, res) => {
  try {
    console.log("🔄 REQUÊTE CHANGE-PASSWORD REÇUE:");
    console.log("📦 Body:", req.body);
    console.log("👤 User from token:", req.user);
    
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        message: "Tous les champs sont requis" 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        message: "Les nouveaux mots de passe ne correspondent pas" 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        message: "Le nouveau mot de passe doit contenir au moins 6 caractères" 
      });
    }

    // Récupérer l'utilisateur
    const userResult = await pool.query(
      `SELECT id, email, mot_de_passe FROM utilisateurs WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        message: "Utilisateur non trouvé" 
      });
    }

    const user = userResult.rows[0];

    // Vérifier le mot de passe actuel
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.mot_de_passe);
    
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ 
        message: "Le mot de passe actuel est incorrect" 
      });
    }

    // Hashage du nouveau mot de passe
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Mise à jour en base
    const updateResult = await pool.query(
      `UPDATE utilisateurs 
       SET mot_de_passe = $1, date_modification = NOW() 
       WHERE id = $2
       RETURNING id, email, date_modification`,
      [hashedNewPassword, userId]
    );

    console.log("✅ Mise à jour réussie:", updateResult.rows[0]);

    res.json({ 
      message: "Mot de passe mis à jour avec succès",
      success: true
    });

  } catch (err) {
    console.error("❌ ERREUR CHANGE PASSWORD:", err);
    res.status(500).json({ 
      message: "Erreur serveur lors du changement de mot de passe",
      error: process.env.NODE_ENV === 'development' ? err.message : 'Erreur interne'
    });
  }
});

// Exportez le router ET les middlewares
module.exports = {
  router,
  verifyAdmin,
  verifyToken
};