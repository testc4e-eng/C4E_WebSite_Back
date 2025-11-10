// routes/offres.js
const express = require('express');
const pool = require('../db.js');

const router = express.Router();

// POST ajouter offre
router.post('/', async (req, res) => {
  let client;
  try {
    let { titre, description, salaire, date_expiration, type, localisation, exigences } = req.body;

    if (!titre || !description || !date_expiration || !localisation)
      return res.status(400).json({ message: 'Champs obligatoires manquants' });

    // 🔧 S'assurer que exigences est un JSON valide
    if (typeof exigences === 'string') {
      try {
        exigences = JSON.parse(exigences);
      } catch {
        exigences = [exigences]; // transforme en tableau si c'est juste un texte
      }
    }

    const id_gestionnaire = 1; // temporaire

    client = await pool.connect();
    await client.query('BEGIN');

    const insertQuery = `
      INSERT INTO offres_emploi
      (titre, description, salaire, date_expiration, statut, type, localisation, exigences, id_gestionnaire)
      VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8)
      RETURNING *;
    `;
    const values = [titre, description, salaire, date_expiration, type, localisation, JSON.stringify(exigences), id_gestionnaire];

    const result = await client.query(insertQuery, values);
    await client.query('COMMIT');

    console.log('✅ Offre ajoutée avec succès:', result.rows[0].id);
    res.status(201).json({ message: 'Offre ajoutée avec succès', offre: result.rows[0] });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Erreur ajout offre:', err.message);
    res.status(500).json({ 
      message: 'Erreur serveur lors de l\'ajout de l\'offre',
      error: err.message 
    });
  } finally {
    if (client) client.release();
  }
});

// PUT modifier une offre
router.put('/:id', async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    let { titre, description, salaire, date_expiration, type, localisation, exigences, statut } = req.body;

    if (!titre || !description || !date_expiration || !localisation)
      return res.status(400).json({ message: 'Champs obligatoires manquants' });

    if (typeof exigences === 'string') {
      try {
        exigences = JSON.parse(exigences);
      } catch {
        exigences = [exigences];
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');

    const updateQuery = `
      UPDATE offres_emploi
      SET titre=$1, description=$2, salaire=$3, date_expiration=$4, type=$5,
          localisation=$6, exigences=$7, statut=$8
      WHERE id=$9
      RETURNING *;
    `;
    const values = [titre, description, salaire, date_expiration, type, localisation, JSON.stringify(exigences), statut, id];
    const result = await client.query(updateQuery, values);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Offre non trouvée' });
    }

    await client.query('COMMIT');

    console.log('✅ Offre modifiée avec succès:', id);
    res.json({ message: 'Offre modifiée avec succès', offre: result.rows[0] });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Erreur modification offre', err);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la modification',
      error: err.message 
    });
  } finally {
    if (client) client.release();
  }
});

// DELETE supprimer une offre - VERSION CORRIGÉE
router.delete("/:id", async (req, res) => {
  let client;
  try {
    const { id } = req.params;
    
    console.log('🔍 DELETE Offre - ID:', id);
    
    client = await pool.connect();
    await client.query('BEGIN');

    // 1. Vérifier d'abord si l'offre existe
    const checkOffre = await client.query(
      "SELECT id, titre FROM offres_emploi WHERE id = $1", 
      [id]
    );
    
    if (checkOffre.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Offre non trouvée:', id);
      return res.status(404).json({ message: "Offre non trouvée" });
    }

    const offreTitre = checkOffre.rows[0].titre;
    console.log('🔍 Offre trouvée:', { id, titre: offreTitre });

    // 2. Vérifier les candidatures liées
    const candidaturesLiees = await client.query(
      "SELECT COUNT(*) as count FROM candidatures_emploi WHERE offre_id = $1",
      [id]
    );

    const nbCandidatures = parseInt(candidaturesLiees.rows[0].count);
    console.log('🔍 Candidatures liées:', nbCandidatures);

    if (nbCandidatures > 0) {
      // OPTION 1: Dissocier les candidatures (conserver les candidatures mais les rendre "spontanées")
      await client.query(
        "UPDATE candidatures_emploi SET offre_id = NULL WHERE offre_id = $1",
        [id]
      );
      console.log('✅ Candidatures dissociées:', nbCandidatures);
      
      // OPTION 2: Si vous préférez supprimer les candidatures (décommentez cette ligne)
      // await client.query("DELETE FROM candidatures_emploi WHERE offre_id = $1", [id]);
    }

    // 3. Supprimer l'offre
    const result = await client.query(
      "DELETE FROM offres_emploi WHERE id = $1 RETURNING titre",
      [id]
    );

    await client.query('COMMIT');

    console.log('✅ Offre supprimée avec succès:', offreTitre);
    res.json({ 
      message: "Offre supprimée avec succès",
      details: {
        offre: offreTitre,
        candidatures_dissociees: nbCandidatures
      }
    });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Erreur suppression offre:', err);
    
    // Vérifier si c'est une erreur de contrainte de clé étrangère
    if (err.code === '23503') { // Code d'erreur PostgreSQL pour foreign key violation
      return res.status(409).json({ 
        message: "Impossible de supprimer cette offre car elle est liée à des candidatures",
        error: "Contrainte de clé étrangère",
        details: "Des candidatures sont associées à cette offre. Elles ont été automatiquement dissociées."
      });
    }
    
    res.status(500).json({ 
      message: "Erreur serveur lors de la suppression",
      error: err.message,
      code: err.code
    });
  } finally {
    if (client) client.release();
  }
});

// GET toutes les offres actives
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Récupération de toutes les offres');
    const result = await pool.query("SELECT * FROM offres_emploi ORDER BY date_expiration ASC");
    
    console.log('✅ Offres récupérées:', result.rows.length);
    res.json(result.rows);

  } catch (err) {
    console.error('❌ Erreur récupération offres:', err.message);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des offres',
      error: err.message 
    });
  }
});

// GET une offre spécifique
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM offres_emploi WHERE id = $1", [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Offre non trouvée' });
    }
    
    res.json(result.rows[0]);

  } catch (err) {
    console.error('Erreur récupération offre:', err.message);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

module.exports = router;