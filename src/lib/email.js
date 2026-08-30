import nodemailer from "nodemailer";
import { CONFIG } from "../config.js";

export function makeTransport() {
  if (!CONFIG.env.gmailUser || !CONFIG.env.gmailAppPassword) {
    throw new Error(
      "GMAIL_USER / GMAIL_APP_PASSWORD manquants (mot de passe d'application requis)."
    );
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: CONFIG.env.gmailUser,
      pass: CONFIG.env.gmailAppPassword,
    },
  });
}

export async function sendMail({ subject, html, text, attachments = [] }) {
  const transport = makeTransport();
  const info = await transport.sendMail({
    from: `AutoCipher <${CONFIG.env.gmailUser}>`,
    to: CONFIG.env.validationEmailTo,
    subject,
    text,
    html,
    attachments,
  });
  return info.messageId;
}
