require("dotenv").config();
const express    = require("express");
const fs         = require("fs");
const path       = require("path");
const multer     = require("multer");
const nodemailer = require("nodemailer");

const app  = express();
const PORT = 3000;

// 2. NOW DEFINE THE DYNAMIC PATHS
const LOCAL_DATA_FILE = path.join(__dirname, "data.json");
const USERS_FILE      = path.join(__dirname, "users.json");

const DATA_FILE = process.env.VERCEL
  ? path.join("/tmp", "data.json")
  : LOCAL_DATA_FILE;

// 3. RUN THE SYNC LOGIC BELOW THEM
function syncDataToTmp() {
  if (process.env.VERCEL && !fs.existsSync(DATA_FILE)) {
    try {
      const initialData = fs.existsSync(LOCAL_DATA_FILE)
        ? fs.readFileSync(LOCAL_DATA_FILE, "utf-8")
        : "[]";
      fs.writeFileSync(DATA_FILE, initialData, "utf-8");
      console.log("✅ Successfully initialized data.json in /tmp");
    } catch (err) {
      console.error("❌ Failed to initialize file in /tmp:", err.message);
    }
  }
}
syncDataToTmp();
const USERS_FILE = path.join(__dirname, "users.json");
const UPLOADS_DIR = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR); 
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/\s+/g, "_");
    cb(null, Date.now() + "-" + safeName);
  }
});
function imageFileFilter(req, file, cb) {
  if (file.mimetype.startsWith("image/")) {
    cb(null, true);  
  } else {
    cb(new Error("Only image files are allowed (JPG, PNG, GIF, WEBP)."), false); 
  }
}
const upload = multer({
  storage:    storage,
  fileFilter: imageFileFilter,
  limits:     { fileSize: 5 * 1024 * 1024 }
});
const transporter = nodemailer.createTransport({
  service: "gmail", 
  auth: {
    user: process.env.GMAIL_USER, 
    pass: process.env.GMAIL_PASS  
  }
});
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
function readItems() {
  try   { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); }
  catch { return []; }
}
function writeItems(items) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2), "utf-8");
}
function readUsers() {
  try   { return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")); }
  catch { return []; }
}
function getRecoveryProbability(category) {
  const cat = category.toLowerCase();
  if (cat === "wallet" || cat === "id card") return "High";
  if (cat === "electronics")                  return "Medium";
  return "Low";
}
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "Username and password are required." });
  const user = readUsers().find(
    u => u.username === username && u.password === password
  );
  if (!user)
    return res.status(401).json({ error: "Invalid username or password." });
  res.json({ success: true, username: user.username, role: user.role, fullName: user.fullName });
});
app.get("/items", (req, res) => {
  res.json(readItems());
});
app.post("/upload-item", upload.single("itemImage"), (req, res) => {
  const { name, itemName, category, location, description, type, email } = req.body;
  if (!name || !itemName || !category || !location || !type)
    return res.status(400).json({ error: "Missing required fields." });
  const imagePath = req.file
    ? "/uploads/" + req.file.filename
    : "/uploads/placeholder.svg";
  const newItem = {
    id:                  Date.now(),
    name,
    itemName,
    category,
    location,
    description:         description || "No description provided",
    type,
    email:               email || "",  
    recoveryProbability: getRecoveryProbability(category),
    status:              "Pending",
    imagePath,                         
    matchSent:           false,        
    date:                new Date().toLocaleDateString("en-IN")
  };
  const items = readItems();
  items.push(newItem);
  writeItems(items);
  res.status(201).json({ message: "Item added successfully!", item: newItem });
});
app.post("/add-item", (req, res) => {
  const { name, itemName, category, location, description, type, email } = req.body;
  if (!name || !itemName || !category || !location || !type)
    return res.status(400).json({ error: "Missing required fields." });
  const newItem = {
    id:                  Date.now(),
    name, itemName, category, location,
    description:         description || "No description provided",
    type,
    email:               email || "",
    recoveryProbability: getRecoveryProbability(category),
    status:              "Pending",
    imagePath:           "/uploads/placeholder.svg",
    matchSent:           false,
    date:                new Date().toLocaleDateString("en-IN")
  };
  const items = readItems();
  items.push(newItem);
  writeItems(items);
  res.status(201).json({ message: "Item added!", item: newItem });
});
app.post("/update-status", (req, res) => {
  const { id } = req.body;
  const items  = readItems();
  const item   = items.find(i => i.id === id);
  if (!item) return res.status(404).json({ error: "Item not found." });
  item.status = "Resolved";
  writeItems(items);
  res.json({ message: "Marked as Resolved.", item });
});
app.post("/delete-item", (req, res) => {
  const { id }   = req.body;
  const items    = readItems();
  const filtered = items.filter(i => i.id !== id);
  if (filtered.length === items.length)
    return res.status(404).json({ error: "Item not found." });
  writeItems(filtered);
  res.json({ message: "Item deleted." });
});
app.post("/approve-match", async (req, res) => {
  const { id } = req.body;
  const items  = readItems();
  const item   = items.find(i => i.id === id);
  if (!item)
    return res.status(404).json({ error: "Item not found." });
  if (!item.email)
    return res.status(400).json({ error: "No email on record for this item. Student must provide email when reporting." });
  if (item.matchSent)
    return res.status(400).json({ error: "Match approval email already sent for this item." });
  const mailOptions = {
    from:    `"Campus Lost & Found" <${process.env.GMAIL_USER}>`,
    to:      item.email,   
    subject: `✅ Match Found: Your Lost "${item.itemName}" | Campus L&F Portal`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;
                  background:#f4f7fb;border-radius:10px;overflow:hidden;
                  border:1px solid #d8e3ed;">
        <div style="background:#0a9396;padding:26px 30px;">
          <h2 style="margin:0;color:#fff;font-size:20px;letter-spacing:.5px;">
            🎓 Campus Lost &amp; Found Portal
          </h2>
          <p style="margin:5px 0 0;color:#b2e4e5;font-size:13px;">
            Automated Item Match Notification
          </p>
        </div>
        <div style="padding:28px 30px;background:#fff;">
          <p style="font-size:16px;color:#1a1a1a;margin:0 0 10px;">
            Dear <strong>${item.name}</strong>,
          </p>
          <p style="font-size:14px;color:#444;line-height:1.7;margin:0 0 20px;">
            We are pleased to inform you that the admin has reviewed your
            lost item report and believes a potential match has been found
            on campus.
          </p>
          <div style="background:#f0fafa;border-left:4px solid #0a9396;
                      border-radius:6px;padding:16px 20px;margin-bottom:22px;">
            <p style="margin:0 0 12px;font-size:11px;color:#888;
                      text-transform:uppercase;letter-spacing:1.2px;font-weight:bold;">
              Your Reported Item
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:5px 0;color:#666;width:45%">Item Name</td>
                  <td style="padding:5px 0;color:#111;font-weight:bold">${item.itemName}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Category</td>
                  <td style="padding:5px 0;color:#111">${item.category}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Last Seen At</td>
                  <td style="padding:5px 0;color:#111">${item.location}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Date Reported</td>
                  <td style="padding:5px 0;color:#111">${item.date}</td></tr>
              <tr><td style="padding:5px 0;color:#666">Status</td>
                  <td style="padding:5px 0;font-weight:bold;color:#0a9396">✅ Match Approved</td></tr>
            </table>
          </div>
          <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:6px;
                      padding:14px 18px;margin-bottom:22px;">
            <p style="margin:0;font-size:14px;color:#555;line-height:1.6;">
              <strong>⚠️ Next Steps:</strong> Please visit the campus
              <strong>Lost &amp; Found Office</strong> with your college
              ID card to verify and collect your item. Office hours:
              Mon–Sat, 9:00 AM – 5:00 PM.
            </p>
          </div>
          <p style="font-size:13px;color:#999;margin:0;">
            Your lost item may have been found and approved by admin.
            If this item does not belong to you, please ignore this email.
          </p>
        </div>
        <div style="background:#f0f4f8;padding:14px 30px;text-align:center;
                    border-top:1px solid #e0e8f0;">
          <p style="margin:0;font-size:11px;color:#aaa;">
            This is an automated message from Campus Lost &amp; Found Portal v3.
            Please do not reply to this email.
          </p>
        </div>
      </div>
    `
  };
  try {
    await transporter.sendMail(mailOptions);
    item.status    = "Match Approved";
    item.matchSent = true; 
    writeItems(items);
    res.json({ message: `✅ Email sent to ${item.email}` });
  } catch (err) {
    console.error("❌ Email error:", err.message);
    res.status(500).json({
      error:  "Failed to send email. Check your .env Gmail credentials.",
      detail: err.message
    });
  }
});
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({ error: "File too large! Max allowed size is 5MB." });
    return res.status(400).json({ error: "Upload error: " + err.message });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});
app.listen(PORT, () => {
  console.log('✅ Server is running ➜ http://localhost:3000');
  console.log(`📁  Uploads folder  → ${UPLOADS_DIR}`);
  console.log(`📧  Gmail user      → ${process.env.GMAIL_USER || "⚠️  Not set in .env"}`);
  console.log(`👤  Admin login     → admin / admin123`);
  console.log(`🎓  Student login   → student1 / pass123\n`);
});
