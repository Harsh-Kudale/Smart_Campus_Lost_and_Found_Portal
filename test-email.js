require("dotenv").config();
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});
async function test() {
  console.log("Sending from:", process.env.GMAIL_USER);
  console.log("Password length:", process.env.GMAIL_PASS?.length);
  try {
    await transporter.sendMail({
      from:    process.env.GMAIL_USER,
      to:      process.env.GMAIL_USER,  
      subject: "Test from Campus Portal",
      text:    "✅ Gmail is working!"
    });
    console.log("✅ Email sent! Check your inbox.");
  } catch (err) {
    console.log("❌ Error:", err.message);
  }
}
test();