
// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db'); // attention au chemin si ta DB est dans le même dossier

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, motDePasse } = req.body;
  if (!email || !motDePasse) {
    return res.status(400).json({ message: 'Email et mot de passe sont requis.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, mot_de_passe FROM gestionnaires WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Utilisateur non trouvé.' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(motDePasse, user.mot_de_passe);
    if (!ok) return res.status(401).json({ message: 'Mot de passe incorrect.' });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET || 'C4E_AFRICA_2025_SECRET',
      { expiresIn: '8h' }
    );

    res.json({
      message: 'Connexion réussie.',
      token,
      utilisateur: { id: user.id, email: user.email }
    });
  } catch (err) {
    console.error('Erreur lors du login:', err);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
});

module.exports = router;
