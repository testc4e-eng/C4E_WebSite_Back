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
        type: typeReel,
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
        offre_type: c.offre_type,
        offre_id: c.offre_id
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
      'mixed'
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

// 🔹 Envoi email candidat - VERSION CORRIGÉE ET AMÉLIORÉE
async function envoyerEmailCandidat(email, nom, statut, typePoste = 'poste') {
  // Validation des paramètres
  if (!email || !nom || !statut) {
    console.error('❌ Paramètres manquants pour envoi email:', { email, nom, statut });
    return;
  }

  console.log(`📧 Tentative d'envoi d'email à: ${email} (${nom}) - Statut: ${statut}`);

  try {
    // Vérifier que la configuration SMTP existe
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Configuration SMTP manquante dans les variables d\'environnement');
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      connectionTimeout: 10000,
      socketTimeout: 10000
    });

    // Vérifier la connexion SMTP
    await transporter.verify();
    console.log('✅ Connexion SMTP vérifiée');

    let sujet, html;

if (statut === 'acceptee') {
  sujet = 'Félicitations ! Votre candidature a été retenue - C4E Africa';
  html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2e7d32; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .footer { padding: 20px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>C4E Africa</h1>
        </div>
        <div class="content">
          <h2>Bonjour ${nom},</h2>
          <p>Nous avons le plaisir de vous informer que votre candidature pour le poste de <strong>${typePoste}</strong> a été <strong style="color: #2e7d32;">acceptée</strong>.</p>
          <p>Notre équipe RH vous contactera très prochainement afin de planifier un entretien et finaliser les prochaines étapes du processus.</p>
          <p>Nous vous remercions pour l'intérêt que vous portez à <strong>C4E Africa</strong> et nous avons hâte d'échanger avec vous.</p>
        </div>
        <div class="footer">
          <p>Cordialement,<br><strong>L'équipe des Ressources Humaines</strong><br>C4E Africa</p>
        </div>
      </div>
    </body>
    </html>
  `;
} else if (statut === 'refusee') {
  sujet = 'Réponse à votre candidature - C4E Africa';
  html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #d32f2f; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .footer { padding: 20px; text-align: center; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>C4E Africa</h1>
        </div>
        <div class="content">
          <h2>Bonjour ${nom},</h2>
          <p>Nous vous remercions vivement d'avoir postulé pour le poste de <strong>${typePoste}</strong> au sein de <strong>C4E Africa</strong>.</p>
          <p>Votre profil présente de très bonnes compétences, mais après une analyse approfondie des candidatures, nous avons décidé de retenir un profil correspondant davantage aux exigences immédiates du poste.</p>
          <p>Nous conserverons néanmoins votre CV et n’hésiterons pas à revenir vers vous si une opportunité plus adaptée à votre parcours se présente.</p>
          <p>Nous vous souhaitons sincèrement beaucoup de réussite dans vos futurs projets professionnels.</p>
        </div>
        <div class="footer">
          <p>Cordialement,<br><strong>L'équipe des Ressources Humaines</strong><br>C4E Africa</p>
        </div>
      </div>
    </body>
    </html>
  `;
} else {
  console.log('⚠️  Statut non géré pour envoi email:', statut);
  return;
}


    // Envoyer l'email
    const info = await transporter.sendMail({
      from: `"C4E Africa - RH" <${process.env.SMTP_USER}>`,
      to: email,
      subject: sujet,
      html: html,
      text: sujet.replace(/<[^>]*>/g, '')
    });

    console.log(`✅ Email envoyé avec succès à: ${email}`);
    console.log(`📨 Message ID: ${info.messageId}`);

  } catch (err) {
    console.error('❌ Erreur détaillée envoi email:', err);
    console.log('⚠️  L\'email n\'a pas pu être envoyé, mais le statut a été mis à jour');
  }
}

// 🔹 Modifier le statut d'une candidature - VERSION CORRIGÉE
router.put('/statut/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  const { statut } = req.body;
  
  console.log('🚀 MISE À JOUR STATUT - Données reçues:');
  console.log('   ID:', id);
  console.log('   Type:', type);
  console.log('   Statut:', statut);
  console.log('   Body complet:', req.body);

  const validStatuts = ['en_attente', 'acceptee', 'refusee'];
  if (!validStatuts.includes(statut)) {
    console.error('❌ Statut invalide:', statut);
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  // CORRECTION DU MAPPING DES TABLES
  const tableMap = { 
    emploi: 'candidatures_emploi', 
    stage: 'candidatures_emploi',  // Les stages sont dans candidatures_emploi
    pfe: 'candidatures_emploi',
    spontanee: 'candidatures_spontanees',
    stage_spontane: 'candidatures_stage'
  };
  
  const table = tableMap[type];
  if (!table) {
    console.error('❌ Type de candidature invalide:', type);
    return res.status(400).json({ error: 'Type de candidature invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    
    console.log(`🔍 Recherche dans la table: ${table}, ID: ${id}`);

    // Récupérer les infos complètes de la candidature
    const selectQuery = `SELECT * FROM ${table} WHERE id = $1`;
    const selectResult = await client.query(selectQuery, [id]);
    
    if (selectResult.rows.length === 0) {
      console.error('❌ Candidature introuvable');
      return res.status(404).json({ error: 'Candidature introuvable.' });
    }

    const candidature = selectResult.rows[0];
    console.log('✅ Candidature trouvée:', {
      id: candidature.id,
      nom: candidature.nom,
      prenom: candidature.prenom,
      email: candidature.email,
      poste: candidature.poste,
      domaine: candidature.domaine
    });

    // Mettre à jour le statut
    const updateQuery = `UPDATE ${table} SET statut = $1 WHERE id = $2 RETURNING *`;
    const updateResult = await client.query(updateQuery, [statut, id]);
    
    console.log('✅ Statut mis à jour en base de données');

    // Préparer l'envoi de l'email
    const nomComplet = `${candidature.nom || ''} ${candidature.prenom || ''}`.trim();
    const email = candidature.email;
    const poste = candidature.poste || candidature.domaine || 'poste';

    console.log(`📧 Préparation envoi email à: ${email}`);
    console.log(`   Nom: ${nomComplet}`);
    console.log(`   Poste: ${poste}`);
    console.log(`   Statut: ${statut}`);

    // Envoyer l'email (ne pas attendre pour répondre au client)
    envoyerEmailCandidat(email, nomComplet, statut, poste)
      .then(() => console.log('✅ Email envoyé avec succès'))
      .catch(err => console.error('❌ Erreur envoi email:', err));

    res.json({ 
      success: true, 
      message: 'Statut mis à jour avec succès',
      candidature: {
        id: candidature.id,
        nom: nomComplet,
        email: email,
        statut: statut,
        poste: poste
      }
    });

  } catch (err) {
    console.error('❌ Erreur mise à jour statut:', err);
    res.status(500).json({ 
      error: 'Erreur serveur lors de la mise à jour.',
      details: err.message 
    });
  } finally {
    if (client) client.release();
  }
});

// 🔹 Route de test pour les emails
router.post('/test-email', async (req, res) => {
  const { email, nom, statut, poste } = req.body;
  
  console.log('🧪 TEST EMAIL - Données reçues:', { email, nom, statut, poste });
  
  try {
    await envoyerEmailCandidat(email, nom, statut, poste);
    res.json({ success: true, message: 'Email de test envoyé avec succès' });
  } catch (err) {
    console.error('❌ Erreur test email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🔹 Supprimer une candidature - VERSION CORRIGÉE
router.delete('/:type/:id', async (req, res) => {
  const { id, type } = req.params;
  
  console.log('🚀 DELETE /api/candidatures/:type/:id');
  console.log('📋 Paramètres reçus:', { id, type });
  
  const tableMap = { 
    emploi: 'candidatures_emploi', 
    stage: 'candidatures_emploi',
    stage_spontane: 'candidatures_stage',
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
      'stage_spontane'
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

// 🔹 Route spécifique pour stage_spontane
// 🔹 Route spécifique pour stage_spontane (stages spontanés)
router.put('/statut/stage_spontane/:id', async (req, res) => {
  const { id } = req.params;
  const { statut } = req.body;
  
  console.log('🚀 MISE À JOUR STATUT STAGE_SPONTANE:');
  console.log('   ID:', id);
  console.log('   Statut:', statut);

  const validStatuts = ['en_attente', 'acceptee', 'refusee'];
  if (!validStatuts.includes(statut)) {
    return res.status(400).json({ error: 'Statut invalide.' });
  }

  let client;
  try {
    client = await pool.connect();
    
    // Vérifier que la candidature existe dans candidatures_stage
    const selectQuery = `SELECT * FROM candidatures_stage WHERE id = $1`;
    const selectResult = await client.query(selectQuery, [id]);
    
    if (selectResult.rows.length === 0) {
      console.error('❌ Candidature stage_spontane introuvable avec ID:', id);
      return res.status(404).json({ error: 'Candidature introuvable.' });
    }

    const candidature = selectResult.rows[0];
    console.log('✅ Candidature stage_spontane trouvée:', {
      id: candidature.id,
      nom: candidature.nom,
      prenom: candidature.prenom,
      email: candidature.email
    });

    // Mettre à jour le statut
    const updateQuery = `UPDATE candidatures_stage SET statut = $1 WHERE id = $2 RETURNING *`;
    const updateResult = await client.query(updateQuery, [statut, id]);
    
    console.log('✅ Statut stage_spontane mis à jour');

    // Envoyer l'email
    const nomComplet = `${candidature.nom || ''} ${candidature.prenom || ''}`.trim();
    const email = candidature.email;
    const poste = candidature.domaine || 'stage';

    envoyerEmailCandidat(email, nomComplet, statut, poste)
      .then(() => console.log('✅ Email stage_spontane envoyé'))
      .catch(err => console.error('❌ Erreur email stage_spontane:', err));

    res.json({ 
      success: true, 
      message: 'Statut mis à jour avec succès',
      candidature: {
        id: candidature.id,
        nom: nomComplet,
        email: email,
        statut: statut
      }
    });

  } catch (err) {
    console.error('❌ Erreur mise à jour stage_spontane:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  } finally {
    if (client) client.release();
  }
});

// DELETE candidature normale - ENDPOINT SIMPLIFIÉ
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🗑️ DELETE /api/candidatures/:id - ID:", id);

    // Essayer d'abord dans candidatures_emploi
    let result = await pool.query(
      'DELETE FROM candidatures_emploi WHERE id = $1 RETURNING id, nom, prenom',
      [id]
    );

    // Si pas trouvé, essayer dans candidatures_spontanees
    if (result.rows.length === 0) {
      result = await pool.query(
        'DELETE FROM candidatures_spontanees WHERE id = $1 RETURNING id, nom, prenom',
        [id]
      );
    }

    // Si pas trouvé, essayer dans candidatures_stage
    if (result.rows.length === 0) {
      result = await pool.query(
        'DELETE FROM candidatures_stage WHERE id = $1 RETURNING id, nom, prenom',
        [id]
      );
    }

    if (result.rows.length === 0) {
      console.log("❌ Candidature introuvable dans toutes les tables, ID:", id);
      return res.status(404).json({ 
        message: "Candidature non trouvée",
        code: "CANDIDATURE_NON_TROUVEE"
      });
    }

    const nomComplet = `${result.rows[0].nom} ${result.rows[0].prenom}`.trim();
    console.log("✅ Candidature supprimée:", nomComplet);
    
    res.json({ 
      message: `Candidature de ${nomComplet} supprimée avec succès`,
      success: true,
      candidature: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Erreur suppression candidature:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression de la candidature",
      error: err.message,
      code: "ERREUR_SUPPRESSION"
    });
  }
});

// DELETE candidature spontanée - ENDPOINT SIMPLIFIÉ
router.delete("/spontanees/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🗑️ DELETE /api/candidatures/spontanees/:id - ID:", id);

    // Essayer dans candidatures_spontanees
    let result = await pool.query(
      'DELETE FROM candidatures_spontanees WHERE id = $1 RETURNING id, nom, prenom',
      [id]
    );

    // Si pas trouvé, essayer dans candidatures_stage (pour stage_spontane)
    if (result.rows.length === 0) {
      result = await pool.query(
        'DELETE FROM candidatures_stage WHERE id = $1 RETURNING id, nom, prenom',
        [id]
      );
    }

    if (result.rows.length === 0) {
      console.log("❌ Candidature spontanée introuvable, ID:", id);
      return res.status(404).json({ 
        message: "Candidature spontanée non trouvée",
        code: "CANDIDATURE_SPONTANEE_NON_TROUVEE"
      });
    }

    const nomComplet = `${result.rows[0].nom} ${result.rows[0].prenom}`.trim();
    console.log("✅ Candidature spontanée supprimée:", nomComplet);
    
    res.json({ 
      message: `Candidature spontanée de ${nomComplet} supprimée avec succès`,
      success: true,
      candidature: result.rows[0]
    });

  } catch (err) {
    console.error("❌ Erreur suppression candidature spontanée:", err);
    res.status(500).json({ 
      message: "Erreur lors de la suppression de la candidature spontanée",
      error: err.message,
      code: "ERREUR_SUPPRESSION_SPONTANEE"
    });
  }
});

// Route de diagnostic pour vérifier où se trouve une candidature
router.get("/check/:id", async (req, res) => {
  try {
    const { id } = req.params;
    console.log("🔍 Vérification candidature ID:", id);

    const results = await Promise.all([
      pool.query('SELECT id, nom, prenom, email FROM candidatures_emploi WHERE id = $1', [id]),
      pool.query('SELECT id, nom, prenom, email FROM candidatures_spontanees WHERE id = $1', [id]),
      pool.query('SELECT id, nom, prenom, email FROM candidatures_stage WHERE id = $1', [id])
    ]);

    const foundIn = [];
    const data = {};

    if (results[0].rows.length > 0) {
      foundIn.push('candidatures_emploi');
      data.candidatures_emploi = results[0].rows[0];
    }
    if (results[1].rows.length > 0) {
      foundIn.push('candidatures_spontanees');
      data.candidatures_spontanees = results[1].rows[0];
    }
    if (results[2].rows.length > 0) {
      foundIn.push('candidatures_stage');
      data.candidatures_stage = results[2].rows[0];
    }

    res.json({
      id: parseInt(id),
      foundIn,
      data,
      tablesChecked: ['candidatures_emploi', 'candidatures_spontanees', 'candidatures_stage']
    });

  } catch (err) {
    console.error("❌ Erreur vérification:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;