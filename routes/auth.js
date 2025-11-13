// routes/auth.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

router.post('/login', async (req, res) => {
  const { email, motDePasse, type } = req.body;
  // type = 'admin' ou 'gestionnaire' (par défaut gestionnaire)
  const table = type === 'admin' ? 'admin' : 'gestionnaires';

  if (!email || !motDePasse) return res.status(400).json({ message: 'Email et mot de passe requis.' });

  try {
    const result = await pool.query(
      `SELECT id, email, mot_de_passe, role FROM ${table} WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0)
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

    const user = result.rows[0];
    const match = await bcrypt.compare(motDePasse, user.mot_de_passe);

    if (!match)
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });

    if (!process.env.JWT_SECRET) {
      console.error('🚨 JWT_SECRET non défini !');
      return res.status(500).json({ message: 'Erreur serveur interne.' });
    }

    const token = jwt.sign({ id: user.id, role: user.role, type }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.json({
      message: 'Connexion réussie',
      user: { id: user.id, email: user.email, role: user.role, type },
      token
    });
  } catch (err) {
    console.error('/api/auth/login error:', err);
    res.status(500).json({ message: 'Erreur serveur interne.', error: err.message });
  }
});

module.exports = router;
