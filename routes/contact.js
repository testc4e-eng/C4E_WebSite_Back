// routes/contact.js - VERSION COMPLÈTEMENT CORRIGÉE
const express = require('express');
const router = express.Router();
const pool = require('../db');
const nodemailer = require('nodemailer');

// POST /contact
router.post('/', async (req, res) => {
  const { firstName, lastName, email, phone, subject, message } = req.body;

  console.log('📧 Tentative d\'envoi d\'email depuis:', email);
  
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

    // 3️⃣ Log de la configuration SMTP AVANT création du transporter
    console.log('🔐 Configuration SMTP complète:', {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      passLength: process.env.SMTP_PASS ? process.env.SMTP_PASS.length : 0,
      secure: process.env.SMTP_SECURE
    });

    // 4️⃣ Configuration du transporteur Nodemailer
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587, // Port alternatif
  secure: false, // false pour le port 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Options pour Render
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  tls: {
    rejectUnauthorized: false,
    ciphers: 'SSLv3'
  },
  debug: true,
  logger: true
});
    // 5️⃣ Vérification de la connexion SMTP
    console.log('🔄 Test de connexion SMTP...');
    await transporter.verify();
    console.log('✅ Connexion SMTP vérifiée');

    // 6️⃣ Configuration de l'email
    const mailOptions = {
      from: `"Site Web C4E Africa" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER, // Envoi à l'adresse Gmail elle-même
      replyTo: email, // Permet de répondre directement à l'expéditeur
      subject: `📩 Nouveau message contact - ${subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px;">
            Nouveau message de contact - C4E Africa
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
            <p style="white-space: pre-wrap; line-height: 1.6; background: white; padding: 15px; border-radius: 5px; border-left: 4px solid #2563eb;">
              ${message.replace(/\n/g, '<br>')}
            </p>
          </div>

          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
            <p>📧 Message envoyé automatiquement depuis le formulaire de contact de <strong>C4E Africa</strong></p>
            <p>🕐 Date d'envoi: ${new Date().toLocaleString('fr-FR')}</p>
            <p>🌐 Site: https://c4e-africa.com</p>
          </div>
        </div>
      `,
    };

    // 7️⃣ Envoi de l'email
    console.log('🔄 Envoi de l\'email...');
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email envoyé avec succès:', info.messageId);
    console.log('📨 Réponse:', info.response);

    res.status(200).json({ 
      success: true, 
      message: 'Message envoyé avec succès.' 
    });

  } catch (error) {
    console.error('❌ Erreur lors de l\'envoi du message:', error);
    
    let errorMessage = 'Erreur serveur lors de l\'envoi du message.';
    let errorDetails = {};
    
    if (error.code === 'EAUTH') {
      errorMessage = 'Erreur d\'authentification email. Vérifiez la configuration SMTP.';
      errorDetails = { 
        code: error.code,
        command: error.command,
        suggestion: 'Vérifiez le mot de passe d\'application Gmail'
      };
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Impossible de se connecter au serveur email.';
      errorDetails = { code: error.code };
    } else if (error.response) {
      errorDetails = { 
        responseCode: error.responseCode,
        response: error.response 
      };
    }
    
    console.error('🔍 Détails de l\'erreur:', errorDetails);
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails
    });
  }
});

module.exports = router;