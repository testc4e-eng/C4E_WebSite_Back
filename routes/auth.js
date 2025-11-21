const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// POST /api/auth/login - VERSION ROBUSTE
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
    
    // Vérifier que l'utilisateur existe toujours
    const table = decoded.type === 'admin' ? 'admin' : 'gestionnaires';
    const userExists = await pool.query(
      `SELECT id, email, role, COALESCE(statut, 'actif') as statut 
       FROM ${table} 
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
        type: decoded.type
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
    const table = decoded.type === 'admin' ? 'admin' : 'gestionnaires';
    
    const userResult = await pool.query(
      `SELECT id, email, role, COALESCE(statut, 'actif') as statut, 
              date_creation, dernier_connexion
       FROM ${table} 
       WHERE id = $1 AND email = $2`,
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
        type: decoded.type,
        statut: user.statut,
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

module.exports = router;