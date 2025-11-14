// routes/contact.js - VERSION CORRIGÉE
const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer');

// POST /contact
router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, subject, message } = req.body;

  console.log('📧 Tentative d\'envoi d\'email depuis:', email);
  console.log('🔧 Configuration SMTP:', {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    hasPassword: !!process.env.SMTP_PASS
  });

  // Vérification des champs obligatoires
  if (!firstName || !lastName || !email || !subject || !message) {
    return res.status(400).json({ error: 'Tous les champs obligatoires doivent être remplis.' });
  }

  try {
    // 1️⃣ Enregistrer dans la base de données
    await pool.query(
      `INSERT INTO messages_contact (prenom, nom, email, telephone, sujet, message, date_envoi)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [firstName, lastName, email, phone || null, subject, message]
    );

    console.log('💾 Message enregistré en base de données');

    // 2️⃣ Vérification de la configuration SMTP
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.error('❌ Configuration SMTP manquante');
      return res.status(500).json({ error: 'Configuration email non disponible.' });
    }

    // 3️⃣ Configuration du transporteur Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});
    // 4️⃣ Vérification de la connexion SMTP
    await transporter.verify();
    console.log('✅ Connexion SMTP vérifiée');

    // 5️⃣ Configuration de l'email
    const mailOptions = {
      from: `"Site Web C4E Africa" <${process.env.SMTP_USER}>`,
      to: process.env.EMAIL_TO || process.env.SMTP_USER,
      replyTo: email, // Permet de répondre directement à l'expéditeur
      subject: `📩 Nouveau message - ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
            Nouveau message de contact
          </h2>
          
          <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #1e293b; margin-top: 0;">Informations du contact</h3>
            <p><strong>👤 Nom :</strong> ${firstName} ${lastName}</p>
            <p><strong>📧 Email :</strong> <a href="mailto:${email}">${email}</a></p>
            <p><strong>📞 Téléphone :</strong> ${phone || 'Non précisé'}</p>
            <p><strong>🎯 Sujet :</strong> ${subject}</p>
          </div>

          <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 15px 0;">
            <h3 style="color: #0369a1; margin-top: 0;">Message</h3>
            <p style="white-space: pre-wrap; line-height: 1.6;">${message}</p>
          </div>

          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>📧 Message envoyé automatiquement depuis le formulaire de contact de <strong>C4E Africa</strong></p>
            <p>🕐 Date d'envoi: ${new Date().toLocaleString('fr-FR')}</p>
          </div>
        </div>
      `,
    };

    // Ajoutez cette vérification AVANT d'envoyer l'email
console.log('🔧 Configuration SMTP corrigée:', {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  hasPassword: !!process.env.SMTP_PASS
});

    // 6️⃣ Envoi de l'email
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email envoyé avec succès:', info.messageId);

    res.status(200).json({ 
      success: true, 
      message: 'Message envoyé avec succès.' 
    });

  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi du message:', error);
    
    let errorMessage = 'Erreur serveur lors de l\'envoi du message.';
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Erreur d\'authentification email. Vérifiez la configuration SMTP.';
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Impossible de se connecter au serveur email.';
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

module.exports = router;