// routes/admin.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');

// GET utilisateurs par rôle
router.get('/:role', async (req, res) => {
  const role = req.params.role === 'administrateurs' ? 'administrateur' : 'gestionnaire';
  try {
    const result = await pool.query(
      'SELECT id, email, role, statut, date_creation, dernier_connexion FROM utilisateurs WHERE role = $1 ORDER BY id ASC',
      [role]
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error('GET utilisateurs error:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// CREATE utilisateur
router.post('/:role', async (req, res) => {
  const role = req.params.role === 'administrateurs' ? 'administrateur' : 'gestionnaire';
  const { email, motDePasse } = req.body;

  if (!email || !motDePasse) return res.status(400).json({ message: 'Email et mot de passe requis.' });

  try {
    const hash = await bcrypt.hash(motDePasse, 10);
    const result = await pool.query(
      `INSERT INTO utilisateurs (email, mot_de_passe, role, statut, date_creation)
       VALUES ($1,$2,$3,'actif',NOW()) RETURNING id, email, role, statut, date_creation`,
      [email, hash, role]
    );
    res.status(201).json({ message: 'Utilisateur créé.', user: result.rows[0] });
  } catch (err) {
    console.error('POST utilisateur error:', err);
    if (err.code === '23505') return res.status(400).json({ message: 'Email déjà utilisé.' });
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// UPDATE utilisateur (statut ou mot de passe)
router.put('/:role/:id', async (req, res) => {
  const { id } = req.params;
  const { email, motDePasse, statut } = req.body;

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (email) { updates.push(`email = $${idx++}`); values.push(email); }
    if (motDePasse) { 
      const hash = await bcrypt.hash(motDePasse, 10); 
      updates.push(`mot_de_passe = $${idx++}`);
      values.push(hash);
    }
    if (statut) { updates.push(`statut = $${idx++}`); values.push(statut); }

    if (updates.length === 0) return res.status(400).json({ message: 'Aucune donnée à mettre à jour.' });

    values.push(id);
    const result = await pool.query(
      `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, role, statut, date_creation`,
      values
    );

    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    res.json({ message: 'Utilisateur mis à jour.', user: result.rows[0] });
  } catch (err) {
    console.error('PUT utilisateur error:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// DELETE utilisateur
router.delete('/:role/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM utilisateurs WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    res.json({ message: 'Utilisateur supprimé.' });
  } catch (err) {
    console.error('DELETE utilisateur error:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
