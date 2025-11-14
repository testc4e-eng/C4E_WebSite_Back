const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// POST /api/auth/login - VERSION CORRIGÉE
router.post('/login', async (req, res) => {
  const { email, motDePasse } = req.body; // On ne prend plus 'type' depuis le frontend
  
  console.log("🔐 Tentative de connexion:", { 
    email: email, 
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
    // 🔄 RECHERCHE DANS LES DEUX TABLES (admin puis gestionnaires)
    let user = null;
    let table = null;

    console.log("🔍 Recherche dans la table admin...");
    const adminResult = await pool.query(
      `SELECT id, email, mot_de_passe, role, COALESCE(statut, 'actif') as statut 
       FROM admin 
       WHERE email = $1`,
      [email]
    );

    if (adminResult.rows.length > 0) {
      user = adminResult.rows[0];
      table = 'admin';
      console.log("✅ Administrateur trouvé");
    } else {
      console.log("🔍 Recherche dans la table gestionnaires...");
      const gestionnaireResult = await pool.query(
        `SELECT id, email, mot_de_passe, role, COALESCE(statut, 'actif') as statut 
         FROM gestionnaires 
         WHERE email = $1`,
        [email]
      );

      if (gestionnaireResult.rows.length > 0) {
        user = gestionnaireResult.rows[0];
        table = 'gestionnaires';
        console.log("✅ Gestionnaire trouvé");
      }
    }

    if (!user) {
      console.log("❌ Utilisateur non trouvé dans aucune table:", email);
      return res.status(401).json({ 
        message: 'Email ou mot de passe incorrect.',
        code: 'UTILISATEUR_NON_TROUVE'
      });
    }

    console.log("👤 Utilisateur trouvé:", { 
      id: user.id, 
      email: user.email, 
      role: user.role,
      statut: user.statut,
      table: table
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
        `UPDATE ${table} SET dernier_connexion = NOW() WHERE id = $1`,
        [user.id]
      );
      console.log("✅ Dernière connexion mise à jour");
    } catch (updateErr) {
      console.warn("⚠️ Erreur mise à jour dernière connexion:", updateErr.message);
    }

    // Détermination du type pour le frontend
    const userType = table === 'admin' ? 'administrateur' : 'gestionnaire';

    // Génération du token JWT
    console.log("🎫 Génération du token JWT...");
    const tokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      type: userType // 'administrateur' ou 'gestionnaire'
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
      expiresIn: '24h' 
    });

    console.log("✅ Connexion réussie pour:", user.email);
    console.log("👤 Type d'utilisateur:", userType);
    console.log("🔑 Token généré - Expiration: 24h");

    // Réponse réussie - IMPORTANT: utiliser 'type' au lieu de 'userType' pour correspondre au frontend
    res.json({
      message: 'Connexion réussie',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        type: userType, // 'administrateur' ou 'gestionnaire'
        statut: user.statut
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

// Les autres routes (verify et me) restent inchangées
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
    
    // Déterminer la table en fonction du type
    const table = decoded.type === 'administrateur' ? 'admin' : 'gestionnaires';
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
    
    // Déterminer la table en fonction du type
    const table = decoded.type === 'administrateur' ? 'admin' : 'gestionnaires';
    
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