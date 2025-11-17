const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// POST /api/auth/login - VERSION TABLE UNIFIÉE
router.post('/login', async (req, res) => {
  // AJOUT: Log complet de la requête
  console.log("📨 REQUÊTE LOGIN REÇUE:");
  console.log("📨 Headers:", req.headers);
  console.log("📨 Body:", req.body);
  console.log("📨 Content-Type:", req.headers['content-type']);
  
  const { email, motDePasse } = req.body;
  
  // AJOUT: Vérification détaillée du body
  if (!email || !motDePasse) {
    console.log("❌ Champs manquants détaillés:", {
      email: email, 
      motDePasse: motDePasse,
      bodyExists: !!req.body,
      bodyKeys: req.body ? Object.keys(req.body) : 'no body'
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
    // 🔄 RECHERCHE DANS LA TABLE UNIFIÉE
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
      type: user.type,
      statut: user.statut
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
      type: user.type // 'administrateur' ou 'gestionnaire'
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { 
      expiresIn: '24h' 
    });

    console.log("✅ Connexion réussie pour:", user.email);
    console.log("👤 Type d'utilisateur:", user.type);

    // Réponse réussie avec redirection appropriée
    res.json({
      message: 'Connexion réussie',
      token: token,
      user: {
        id: user.id,
        nom: user.nom,
        email: user.email,
        role: user.role,
        type: user.type, // 'administrateur' ou 'gestionnaire'
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

// 🔧 ROUTE TEMPORAIRE POUR METTRE À JOUR LES MOTS DE PASSE - À SUPPRIMER APRÈS USAGE
router.post('/update-passwords', async (req, res) => {
  try {
    const newPassword = 'c4e@test@2025';
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    console.log('🔄 Mise à jour des mots de passe...');
    console.log('📧 Emails concernés: c4e.africa@gmail.com, rhc4eafrica@gmail.com');
    
    // Mettre à jour les deux comptes
    const result = await pool.query(
      'UPDATE utilisateurs SET mot_de_passe = $1 WHERE email IN ($2, $3)',
      [hashedPassword, 'c4e.africa@gmail.com', 'rhc4eafrica@gmail.com']
    );
    
    console.log('✅ Mots de passe mis à jour pour', result.rowCount, 'utilisateurs');
    
    // Vérifier quels comptes ont été mis à jour
    const updatedUsers = await pool.query(
      'SELECT email, nom, type FROM utilisateurs WHERE email IN ($1, $2)',
      ['c4e.africa@gmail.com', 'rhc4eafrica@gmail.com']
    );
    
    res.json({ 
      message: 'Mots de passe mis à jour avec succès',
      usersUpdated: result.rowCount,
      updatedUsers: updatedUsers.rows
    });
    
  } catch (err) {
    console.error('❌ Erreur mise à jour mots de passe:', err);
    res.status(500).json({ 
      error: err.message,
      code: 'ERREUR_MISE_A_JOUR_MDP'
    });
  }
});

// Route pour vérifier le token (keep existing)
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

// Route pour obtenir les infos de l'utilisateur connecté (keep existing)
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

// 📂 routes/auth.js - AJOUTER CETTE ROUTE
router.put("/change-password", verifyToken, async (req, res) => {
  try {
    console.log("🔄 Changement de mot de passe utilisateur");
    
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        message: "Le mot de passe actuel et le nouveau mot de passe sont requis" 
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
    await pool.query(
      `UPDATE utilisateurs 
       SET mot_de_passe = $1, date_modification = NOW() 
       WHERE id = $2`,
      [hashedNewPassword, userId]
    );

    console.log("✅ Mot de passe utilisateur mis à jour avec succès");

    res.json({ 
      message: "Mot de passe mis à jour avec succès",
      success: true
    });

  } catch (err) {
    console.error("❌ ERREUR CHANGE PASSWORD:", err);
    
    res.status(500).json({ 
      message: "Erreur serveur lors du changement de mot de passe",
      error: err.message 
    });
  }
});

module.exports = router;