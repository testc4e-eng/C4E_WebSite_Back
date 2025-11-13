// routes/candidatures.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const path = require('path');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;

// Middleware pour servir les fichiers CV et lettres de motivation
router.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// 🔹 Calcul du score de compétences
const calculateCompetenceScore = (competences) => {
  if (!competences || typeof competences !== 'object') return 0;

  try {
    const competencesObj = typeof competences === 'string' ? JSON.parse(competences) : competences;
    const excludedKeys = ['exigences', 'exigences:', 'compétences', 'competences', 'requirements'];
    const validCompetences = Object.entries(competencesObj)
      .filter(([key, value]) => !excludedKeys.includes(key.toLowerCase().trim()) && typeof value === 'number')
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});
    const scores = Object.values(validCompetences);
    if (scores.length === 0) return 0;
    const totalPoints = scores.reduce((sum, s) => sum + Number(s || 0), 0);
    const maxPoints = scores.length * 5;
    return Math.min(Math.round((totalPoints / maxPoints) * 100), 100);
  } catch (err) {
    console.error('Erreur calcul score compétences:', err);
    return 0;
  }
};

// 🔹 Générateur d'URL pour fichiers
const generateFileUrl = (filePath) => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  return `/uploads/${path.basename(filePath)}`;
};

// 🔹 Fonction sécurisée de récupération et transformation des candidatures
// 🔹 Fonction sécurisée de récupération et transformation des candidatures - CORRIGÉE
const safeQuery = async (client, query, type) => {
  try {
    const { rows } = await client.query(query);
    return rows.map((c, i) => {
      let competencesParsed = null;
      try {
        competencesParsed = c.competences
          ? typeof c.competences === 'string'
            ? JSON.parse(c.competences)
            : c.competences
          : null;
      } catch {
        competencesParsed = null;
      }

      const competenceScore = competencesParsed ? calculateCompetenceScore(competencesParsed) : 0;

      // DÉTERMINER LE TYPE RÉEL basé sur offre_type
      let typeReel = type;
      if (c.offre_type) {
        const offreTypeLower = c.offre_type.toLowerCase();
        if (offreTypeLower.includes('stage')) {
          typeReel = 'stage';
        } else if (offreTypeLower.includes('pfe')) {
          typeReel = 'pfe';
        } else if (offreTypeLower.includes('cdi') || offreTypeLower.includes('cdd')) {
          typeReel = 'emploi';
        }
      }

      const baseData = {
        id: c.id || i + Math.floor(Math.random() * 10000),
        type: typeReel, // ← UTILISER LE TYPE RÉEL
        nom: `${c.nom ?? ''} ${c.prenom ?? ''}`.trim(),
        email: c.email,
        telephone: c.telephone,
        cvUrl: generateFileUrl(c.cv_path),
        lettreMotivationUrl: generateFileUrl(c.lettre_motivation),
        motivation: c.motivation || '',
        dateSoumission: c.date_soumission,
        statut: c.statut || 'en_attente',
        competenceScore,
        competences: competencesParsed,
        poste: c.poste || 'Non spécifié',
        diplome: c.diplome || 'Non spécifié',
        experience: c.experience || '0',
        offre_type: c.offre_type, // ← INCLURE offre_type pour le debug
        offre_id: c.offre_id // ← INCLURE offre_id
      };

      // Champs spécifiques selon type
      if (typeReel === 'emploi') {
        return { ...baseData, poste: c.titre_offre || c.poste, universite: c.universite, type_etablissement: c.type_etablissement };
      }
      if (typeReel === 'stage' || typeReel === 'pfe') {
        return { ...baseData, domaine: c.domaine, duree: c.duree, universite: c.universite, type_etablissement: c.type_etablissement };
      }
      return baseData;
    });
  } catch (err) {
    console.warn(`Erreur chargement ${type}:`, err.message);
    return [];
  }
};
// ---------- Routes principales ----------

// 🔹 Récupérer toutes les candidatures
router.get('/', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const candidatures = [];

    // 🔹 REQUÊTE UNIFIÉE pour toutes les candidatures de la table candidatures_emploi
    const toutesCandidatures = await safeQuery(
      client,
      `SELECT 
         c.*, 
         o.titre AS titre_offre, 
         o.type AS offre_type,
         o.id AS offre_id
       FROM candidatures_emploi c
       LEFT JOIN offres_emploi o ON c.offre_id = o.id
       ORDER BY c.date_soumission DESC`,
      'mixed' // Type mixte, sera déterminé par offre_type
    );
    candidatures.push(...toutesCandidatures);

    // 🔹 Candidatures spontanées (table séparée)
    const spontanee = await safeQuery(
      client,
      `SELECT * FROM candidatures_spontanees ORDER BY date_soumission DESC`,
      'spontanee'
    );
    candidatures.push(...spontanee);

    // DEBUG DÉTAILLÉ
    console.log('📊 DEBUG Backend - Candidatures récupérées:');
    console.log(`   Total: ${candidatures.length}`);
    
    // Analyse par offre_type
    const analyseParType = {};
    candidatures.forEach(c => {
      const type = c.offre_type || 'spontanee';
      if (!analyseParType[type]) analyseParType[type] = 0;
      analyseParType[type]++;
    });
    
    console.log('📊 Répartition par offre_type:');
    Object.entries(analyseParType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    // Analyse par type déterminé
    const emploiCount = candidatures.filter(c => c.type === 'emploi').length;
    const stageCount = candidatures.filter(c => c.type === 'stage').length;
    const pfeCount = candidatures.filter(c => c.type === 'pfe').length;
    const spontaneeCount = candidatures.filter(c => c.type === 'spontanee').length;
    
    console.log('📊 Répartition par type déterminé:');
    console.log(`   Emploi: ${emploiCount}`);
    console.log(`   Stage: ${stageCount}`);
    console.log(`   PFE: ${pfeCount}`);
    console.log(`   Spontanée: ${spontaneeCount}`);

    // Debug des premières candidatures
    console.log('🔍 Détails des premières candidatures:');
    candidatures.slice(0, 10).forEach((c, i) => {
      console.log(`   ${i+1}. id=${c.id}, type=${c.type}, offre_type="${c.offre_type}", nom=${c.nom}, poste=${c.poste}, offre_id=${c.offre_id}`);
    });

    res.json(candidatures);
  } catch (err) {
    console.error('Erreur GET /api/candidatures:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  } finally {
    if (client) client.release();
  }
});

// 🔹 Modifier le statut d'une candidature
router.put('/statut/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  const { statut } = req.body;
  const validStatuts = ['en_attente', 'acceptee', 'refusee'];
  if (!validStatuts.includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });

  const tableMap = { emploi: 'candidatures_emploi', stage: 'candidatures_stage', pfe: 'candidatures_emploi', spontanee: 'candidatures_spontanees' };
  const table = tableMap[type];
  if (!table) return res.status(400).json({ error: 'Type de candidature invalide.' });

  try {
    const result = await pool.query(`UPDATE ${table} SET statut = $1 WHERE id = $2 RETURNING nom, email`, [statut, id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Candidature introuvable.' });

    const { nom, email } = result.rows[0];
    await envoyerEmailCandidat(email, nom, statut);
    res.json({ success: true, message: 'Statut mis à jour et email envoyé.' });
  } catch (err) {
    console.error('Erreur mise à jour statut:', err.message);
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour.' });
  }
});

// 🔹 Supprimer une candidature
// 🔹 Supprimer une candidature - VERSION CORRIGÉE
// 🔹 Supprimer une candidature - VERSION CORRIGÉE DANS routes/candidatures.js
// 🔹 Supprimer une candidature - VERSION CORRIGÉE AVEC stage_spontane
// 🔹 Supprimer une candidature - VERSION CORRIGÉE AVEC stage_spontane
router.delete('/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  
  console.log('🚀 DELETE /api/candidatures/:type/:id');
  console.log('📋 Paramètres reçus:', { id, type });
  
  // CORRECTION : Ajouter stage_spontane dans le mapping
  const tableMap = { 
    emploi: 'candidatures_emploi', 
    stage: 'candidatures_emploi',
    stage_spontane: 'candidatures_stage',  // ← AJOUT IMPORTANT
    pfe: 'candidatures_emploi',
    spontanee: 'candidatures_spontanees' 
  };
  
  const table = tableMap[type];
  if (!table) {
    console.error('❌ Type de candidature invalide:', type);
    return res.status(400).json({ error: 'Type de candidature invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    
    console.log(`🔍 DEBUG DELETE - Table cible: ${table}, ID: ${id}`);

    // Vérifier d'abord si la candidature existe
    const checkQuery = `SELECT id, nom, prenom, cv_path, lettre_motivation FROM ${table} WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('❌ Candidature introuvable:', { table, id });
      return res.status(404).json({ error: 'Candidature introuvable.' });
    }

    const candidature = checkResult.rows[0];
    console.log('✅ Candidature trouvée:', candidature);

    // Supprimer les fichiers physiques (uniquement pour candidatures_spontanees)
    if (table === 'candidatures_spontanees') {
      const fichiers = [candidature.cv_path, candidature.lettre_motivation]
        .filter(Boolean)
        .map(f => path.join(__dirname, '..', f));
      
      await Promise.allSettled(
        fichiers.map(f => 
          fs.unlink(f).catch(err => 
            console.warn('⚠️ Impossible de supprimer le fichier:', f, err.message)
          )
        )
      );
    }

    // Supprimer de la base de données
    const deleteQuery = `DELETE FROM ${table} WHERE id = $1 RETURNING nom, prenom`;
    const deleteResult = await client.query(deleteQuery, [id]);
    
    if (deleteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.error('❌ Erreur lors de la suppression en base');
      return res.status(500).json({ error: 'Erreur lors de la suppression.' });
    }

    await client.query('COMMIT');

    const nomComplet = `${deleteResult.rows[0].nom} ${deleteResult.rows[0].prenom}`.trim();
    
    console.log('✅ Candidature supprimée avec succès:', nomComplet);
    res.json({ 
      success: true, 
      message: `Candidature de ${nomComplet} supprimée.`,
      details: { table, id, type }
    });

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ Erreur suppression candidature:', err);
    res.status(500).json({ 
      error: 'Erreur serveur lors de la suppression.', 
      details: err.message
    });
  } finally {
    if (client) client.release();
  }
});

// 🔹 Envoi email candidat
// 🔹 Envoi email candidat - version professionnelle sans emojis
async function envoyerEmailCandidat(email, nom, statut, typePoste = 'poste') {
  if (!email) return;
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });

    let sujet, html;

    if (statut === 'acceptee') {
      sujet = 'Votre candidature a été retenue';
      html = `
        <div style="font-family: Arial, sans-serif; color: #222; padding: 20px;">
          <h2 style="color: #2e7d32;">Bonjour ${nom},</h2>
          <p>Nous avons le plaisir de vous informer que votre candidature pour le poste de <b>${typePoste}</b> a été <b>acceptée</b>.</p>
          <p>Notre équipe vous contactera prochainement afin de planifier un entretien ou finaliser la suite du processus.</p>
          <p>Nous vous remercions pour votre confiance et l’intérêt que vous portez à <b>C4E Africa</b>.</p>
          <br/>
          <p>Cordialement,<br><b>L’équipe RH - C4E Africa</b></p>
        </div>
      `;
    } else if (statut === 'refusee') {
      sujet = 'Réponse à votre candidature';
      html = `
        <div style="font-family: Arial, sans-serif; color: #222; padding: 20px;">
          <h2 style="color: #d32f2f;">Bonjour ${nom},</h2>
          <p>Nous vous remercions d’avoir postulé pour le poste de <b>${typePoste}</b> chez <b>C4E Africa</b>.</p>
          <p>Après étude de votre dossier, nous sommes au regret de vous informer que votre candidature n’a pas été retenue pour cette fois.</p>
          <p>Nous vous encourageons toutefois à postuler à d’autres opportunités futures correspondant à votre profil.</p>
          <br/>
          <p>Cordialement,<br><b>L’équipe RH - C4E Africa</b></p>
        </div>
      `;
    } else return;

    await transporter.sendMail({
      from: `"C4E Africa " <${process.env.SMTP_USER}>`,
      to: email,
      subject: sujet,
      html
    });

    console.log(`📧 Email envoyé à ${email} pour le statut "${statut}"`);
  } catch (err) {
    console.error('❌ Erreur envoi email:', err.message);
  }
}

///////////
// 🔹 Récupérer uniquement les candidatures de stage/PFE
router.get('/stages', async (req, res) => {
  let client;
  try {
    client = await pool.connect();

    const { rows } = await client.query(
      `SELECT * FROM candidatures_stage ORDER BY date_soumission DESC`
    );

    const result = rows.map((c, i) => {
      let competencesParsed = null;
      try {
        competencesParsed = c.competences
          ? typeof c.competences === 'string'
            ? JSON.parse(c.competences)
            : c.competences
          : null;
      } catch {
        competencesParsed = null;
      }

      const competenceScore = competencesParsed
        ? calculateCompetenceScore(competencesParsed)
        : 0;

      return {
        id: c.id || i + Math.floor(Math.random() * 10000),
        type: 'stage',
        nom: `${c.nom ?? ''} ${c.prenom ?? ''}`.trim(),
        email: c.email,
        telephone: c.telephone,
        cvUrl: generateFileUrl(c.cv_path),
        lettreMotivationUrl: generateFileUrl(c.lettre_motivation),
        motivation: c.motivation || '',
        dateSoumission: c.date_soumission,
        statut: c.statut || 'en_attente',
        competenceScore,
        competences: competencesParsed,
        poste: c.poste || 'Non spécifié',
        diplome: c.diplome || 'Non spécifié',
        experience: c.experience || '0',
        universite: c.universite || '',
        type_etablissement: c.type_etablissement || '',
        domaine: c.domaine || '',
        duree: c.duree || ''
      };
    });

    console.log(`📊 ${result.length} candidatures stage/pfe récupérées`);
    res.json(result);
  } catch (err) {
    console.error('❌ Erreur GET /api/candidatures/stages:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  } finally {
    if (client) client.release();
  }
});

// 🔹 Récupérer TOUTES les candidatures spontanées (spontanees + stage)
router.get('/spontanees/toutes', async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    const candidatures = [];

    // 🔹 Candidatures spontanées générales (table candidatures_spontanees)
    const spontanees = await safeQuery(
      client,
      `SELECT * FROM candidatures_spontanees ORDER BY date_soumission DESC`,
      'spontanee'
    );
    candidatures.push(...spontanees);

    // 🔹 Candidatures spontanées de stage (table candidatures_stage)
    const stagesSpontanes = await safeQuery(
      client,
      `SELECT * FROM candidatures_stage ORDER BY date_soumission DESC`,
      'stage_spontane'  // ← Type spécifique pour les distinguer
    );
    candidatures.push(...stagesSpontanes);

    console.log(`📊 ${candidatures.length} candidatures spontanées récupérées:`);
    console.log(`   - Spontanées générales: ${spontanees.length}`);
    console.log(`   - Stages spontanés: ${stagesSpontanes.length}`);

    res.json(candidatures);
  } catch (err) {
    console.error('❌ Erreur GET /api/candidatures/spontanees/toutes:', err);
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  } finally {
    if (client) client.release();
  }
});


module.exports = router;
