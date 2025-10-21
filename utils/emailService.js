import nodemailer from 'nodemailer';

// Create transporter for sending emails
const createTransporter = () => {
  // For development, you can use Gmail or any SMTP service
  // In production, use a proper email service like SendGrid, AWS SES, etc.
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER, // Your email
      pass: process.env.EMAIL_PASSWORD  // Your app password
    }
  });
};

// Generate a 6-digit verification code
export const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send verification code email
export const sendVerificationEmail = async (email, verificationCode) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@pedismart.com',
      to: email,
      subject: 'Pedismart - Password Reset Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #4CAF50;">Pedismart Password Reset</h2>
          <p>You have requested to reset your password. Please use the verification code below:</p>
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #333; font-size: 32px; margin: 0; letter-spacing: 5px;">${verificationCode}</h1>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this password reset, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This is an automated message from Pedismart. Please do not reply to this email.</p>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('Verification email sent successfully:', result.messageId);
    return true;
  } catch (error) {
    console.error('Error sending verification email:', error);
    return false;
  }
};

// Send account approval notification email
export const sendApprovalEmail = async (email, userName, userRole) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@Pedismart.com',
      to: email,
      subject: '✅ Pedismart - Your Account Has Been Approved!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #4CAF50; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">🎉 Account Approved!</h1>
          </div>
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p style="font-size: 16px;">Dear ${userName},</p>
            <p style="font-size: 16px;">Great news! Your Pedismart ${userRole} account has been <strong>approved</strong> by our admin team.</p>
            <div style="background-color: white; padding: 20px; border-left: 4px solid #4CAF50; margin: 20px 0;">
              <p style="margin: 0; font-size: 16px;"><strong>✓ You can now log in and start using Pedismart!</strong></p>
            </div>
            <p style="font-size: 16px;">What's next?</p>
            <ul style="font-size: 16px; line-height: 1.8;">
              <li>Open the Pedismart app</li>
              <li>Log in with your registered email</li>
              <li>${userRole === 'rider' ? 'Start accepting ride requests and earning!' : 'Start booking rides with verified drivers!'}</li>
            </ul>
            <p style="font-size: 16px;">Thank you for choosing Pedismart. We're excited to have you on board!</p>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message from Pedismart. Please do not reply to this email.</p>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('✅ Approval email sent successfully to:', email, '- Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error sending approval email:', error);
    return false;
  }
};

// Send account disapproval notification email
export const sendDisapprovalEmail = async (email, userName, userRole, reason) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@Pedismart.com',
      to: email,
      subject: '❌ Pedismart - Account Application Update',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f44336; padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Account Application Update</h1>
          </div>
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p style="font-size: 16px;">Dear ${userName},</p>
            <p style="font-size: 16px;">Thank you for your interest in joining Pedismart as a ${userRole}.</p>
            <p style="font-size: 16px;">Unfortunately, we are unable to approve your account at this time.</p>
            <div style="background-color: white; padding: 20px; border-left: 4px solid #f44336; margin: 20px 0;">
              <p style="margin: 0 0 10px 0; font-weight: bold; color: #f44336;">Reason for Disapproval:</p>
              <p style="margin: 0; font-size: 16px;">${reason || 'No specific reason provided'}</p>
            </div>
            <p style="font-size: 16px;"><strong>What can you do?</strong></p>
            <ul style="font-size: 16px; line-height: 1.8;">
              <li>Review the reason provided above</li>
              <li>Address any issues mentioned</li>
              <li>Resubmit your application with updated information</li>
              <li>Contact our support team if you have questions</li>
            </ul>
            <p style="font-size: 16px;">We appreciate your understanding and hope to have you join our community in the future.</p>
          </div>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px; text-align: center;">This is an automated message from Pedismart. Please do not reply to this email.</p>
        </div>
      `
    };

    const result = await transporter.sendMail(mailOptions);
    console.log('📧 Disapproval email sent successfully to:', email, '- Message ID:', result.messageId);
    return true;
  } catch (error) {
    console.error('❌ Error sending disapproval email:', error);
    return false;
  }
};
