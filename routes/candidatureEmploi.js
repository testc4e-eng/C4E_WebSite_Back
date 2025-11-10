import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import pool from "../db.js"; // Connexion PostgreSQL

const router = express.Router();

// 📂 Dossier uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// ⚙️ Configuration Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const filetypes = pdf;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) cb(null, true);
    else cb(new Error("Seuls les fichiers PDF sont autorisés !"));
  },
});

// ====================== ROUTE AJOUT CANDIDATURE EMPLOI ======================
router.post("/candidature-emploi", upload.single("cv"), async (req, res) => {
  try {
    const {
      nom,
      prenom,
      email,
      telephone,
      poste,
      type_poste, // <-- nouveau champ
      lettre_motivation,
      type_etablissement,
      diplome,
      competences,
      experience,
      offre_id,
    } = req.body;

    if (!nom || !prenom || !email || !telephone || !lettre_motivation || !req.file) {
      return res
        .status(400)
        .json({ message: "Veuillez remplir tous les champs obligatoires." });
    }

    const cvPath = `/uploads/${req.file.filename}`;

    let competencesJson = {};
    if (competences) {
      try {
        competencesJson = JSON.parse(competences);
      } catch {
        competencesJson = competences;
      }
    }

    const experienceInt = experience ? parseInt(experience) : 0;
    const offreIdInt = offre_id ? parseInt(offre_id) : null;

    // 💾 Insertion SQL avec type_poste
    const query = `
      INSERT INTO candidatures_emploi
      (nom, prenom, email, telephone, poste, type_poste, cv_path, lettre_motivation,
       type_etablissement, diplome, competences, experience, offre_id, date_soumission)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
      RETURNING *;
    `;

    const values = [
      nom,
      prenom,
      email,
      telephone,
      poste || null,
      type_poste || null, // <-- enregistrement du type directement
      cvPath,
      lettre_motivation,
      type_etablissement || null,
      diplome || null,
      JSON.stringify(competencesJson),
      experienceInt,
      offreIdInt,
    ];

    const result = await pool.query(query, values);
    res.status(201).json({
      message: "✅ Candidature emploi enregistrée avec succès.",
      candidature: result.rows[0],
    });
  } catch (error) {
    console.error("❌ Erreur /api/candidature-emploi:", error.message);
    res.status(500).json({ message: "Erreur lors de l'enregistrement.", error: error.message });
  }
});


// ====================== ROUTE LISTER AVEC TRI DIPLÔME ======================
router.get("/candidatures-emploi", async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM candidatures_emploi
      ORDER BY CASE 
        WHEN LOWER(TRIM(diplome)) IN ('technicien', 'technicien spécialisé') THEN 1
        WHEN LOWER(TRIM(diplome)) = 'licence' THEN 2
        WHEN LOWER(TRIM(diplome)) IN ('cycle d\\'ingenieur', 'cycle d’ingénieur', 'ingenieur') THEN 3
        WHEN LOWER(TRIM(diplome)) = 'master' THEN 4
        WHEN LOWER(TRIM(diplome)) = 'doctorat' THEN 5
        ELSE 6
      END,
      experience ASC; -- tri secondaire
    `;

    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("❌ Erreur /api/candidatures-emploi:", error.message);
    res
      .status(500)
      .json({ message: "Erreur lors de la récupération.", error: error.message });
  }
});

export default router;
