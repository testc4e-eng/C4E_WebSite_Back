// routes/contact.js
const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer');

// POST /contact
router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, subject, message } = req.body;

  // Vérification des champs obligatoires
  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ error: 'Champs requis manquants.' });
  }

  try {
    // 1️⃣ Enregistrer dans la base
    await pool.query(
      `INSERT INTO messages_contact (prenom, nom, email, telephone, sujet, message, date_envoi)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [firstName, lastName, email, phone || null, subject, message]
    );

    // 2️⃣ Configuration du transporteur d'email (Gmail App Password)
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 465,
      secure: process.env.SMTP_SECURE === 'true', // true pour port 465, false pour 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS, // App Password Gmail
      },
    });

    // 3️⃣ Contenu du mail
    const mailOptions = {
      from: `"Formulaire C4E Africa" <${process.env.SMTP_USER}>`,
      to: process.env.EMAIL_TO || process.env.SMTP_USER,
      subject: `📩 Nouveau message - ${subject}`,
      html: `
        <h3>Nouvelle demande de contact de web site</h3>
        <p><b>Nom :</b> ${firstName} ${lastName}</p>
        <p><b>Email :</b> ${email}</p>
        <p><b>Téléphone :</b> ${phone || 'Non précisé'}</p>
        <p><b>Sujet :</b> ${subject}</p>
        <p><b>Message :</b><br/>${message}</p>
        <hr/>
        <small>Message envoyé depuis le site C4E Africa</small>
      `,
    };

    // 4️⃣ Envoi de l’email
    await transporter.sendMail(mailOptions);

    res.status(200).json({ success: true, message: 'Message envoyé avec succès.' });
  } catch (error) {
    console.error('Erreur lors de l’envoi du message:', error);
    res.status(500).json({ error: 'Erreur serveur lors de l’envoi du message.' });
  }
});

module.exports = router;
