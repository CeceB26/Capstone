// server.js
"use strict";

console.log("SERVER STARTING");
console.log("SERVER PATH:", __filename);

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

// -------------------------
// Middleware
// -------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("trust proxy", 1); 

// Helpful: don't die silently
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

// -------------------------
// Static files
// -------------------------
// IMPORTANT: this makes static serving work whether server.js is:
//  - /Capstone/server.js
//  - /Capstone/buyer-feedback/server.js
//
// It looks for a folder named "Capstone" up the tree.
function findCapstoneRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "Capstone");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  // fallback: maybe we're already in Capstone
  if (fs.existsSync(path.join(startDir, "buyerUI.html"))) return startDir;
  return null;
}

const CAPSTONE_DIR = findCapstoneRoot(__dirname);
if (!CAPSTONE_DIR) {
  console.error("❌ Could not locate Capstone folder for static files.");
  console.error("   Make sure your folder structure contains /Capstone and server.js is inside the project.");
} else {
  console.log("✅ Serving static Capstone files from:", CAPSTONE_DIR);
  app.use("/Capstone", express.static(CAPSTONE_DIR));
}

// -------------------------
// Sessions (cookie auth)
// -------------------------
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
     sameSite: "lax",
     // secure: true only on HTTPS
    },
  })
);

// -------------------------
// Data files + init
// -------------------------
const CAPSTONE_DIR_FIXED = __dirname;
const DATA_DIR = path.join(CAPSTONE_DIR_FIXED, "data");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const BUYER_CONTEXT_FILE = path.join(DATA_DIR, "buyer_context.json");

function ensureFile(file, defaultObj) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaultObj, null, 2), "utf-8");
  }
}

// Create files if missing
ensureFile(USERS_FILE, { users: [] });
ensureFile(TOKENS_FILE, { tokens: [] });
ensureFile(BUYER_CONTEXT_FILE, { buyers: {} });

function readJsonSafe(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error("readJsonSafe failed:", file, e.message);
    return fallback;
  }
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf-8");
  fs.renameSync(tmp, file); // atomic replace
}


function safeText(v) {
  return String(v ?? "").trim();
}
function uid() {
  return crypto.randomBytes(16).toString("hex");
}
function nowIso() {
  return new Date().toISOString();
}

function findUserByEmail(email) {
  const db = readJsonSafe(USERS_FILE, { users: [] });
  return db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}
function findUserById(userId) {
  const db = readJsonSafe(USERS_FILE, { users: [] });
  return db.users.find((u) => u.user_id === userId);
}

// -------------------------
// Buyer context DB helpers
// -------------------------
function readBuyerDb() {
  return readJsonSafe(BUYER_CONTEXT_FILE, { buyers: {} });
}
function writeBuyerDb(obj) {
  writeJsonAtomic(BUYER_CONTEXT_FILE, obj);
}

function ensureBuyerRecord(user_id) {
  const db = readBuyerDb();

  // 🔒 hard safety guard
  if (!db.buyers || typeof db.buyers !== "object") {
    db.buyers = {};
  }

  if (!db.buyers[user_id]) {
    db.buyers[user_id] = {
      buyer_basics: {},
      homes: [],
      saved: { amenities: [], homes: [] },
      updated_at: nowIso(),
    };
    writeBuyerDb(db);
  }

  return db;
}

// -------------------------
// Email (SMTP)
// -------------------------
async function sendEmail(to, subject, html) {
  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;
  const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("\n--- EMAIL (DEV MODE - not sent) ---");
    console.log("TO:", to);
    console.log("SUBJECT:", subject);
    console.log("HTML:", html);
    console.log("--- END EMAIL ---\n");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({ from: FROM_EMAIL, to, subject, html });
}

// -------------------------
// Token helpers
// -------------------------
function createToken({ user_id, type, minutesValid = 60 }) {
  const tdb = readJsonSafe(TOKENS_FILE, { tokens: [] });
  const token = uid();
  const expires_at = new Date(Date.now() + minutesValid * 60 * 1000).toISOString();

  tdb.tokens.push({ token, user_id, type, created_at: nowIso(), expires_at, used: false });
  writeJsonAtomic(TOKENS_FILE, tdb);

  return { token, expires_at };
}

function consumeToken(token, expectedType) {
  const tdb = readJsonSafe(TOKENS_FILE, { tokens: [] });
  const rec = tdb.tokens.find((t) => t.token === token);

  if (!rec) return { ok: false, error: "Invalid token" };
  if (rec.used) return { ok: false, error: "Token already used" };
  if (rec.type !== expectedType) return { ok: false, error: "Wrong token type" };

  const exp = new Date(rec.expires_at).getTime();
  if (Date.now() > exp) return { ok: false, error: "Token expired" };

  rec.used = true;
  rec.used_at = nowIso();
  writeJsonAtomic(TOKENS_FILE, tdb);

  return { ok: true, user_id: rec.user_id };
}

// -------------------------
// Auth middleware
// -------------------------
function requireAuth(req, res, next) {
  if (!req.session.user_id) return res.status(401).json({ error: "Not logged in" });

  const user = findUserById(req.session.user_id);
  if (!user) return res.status(401).json({ error: "Session invalid" });
  if (!user.active) return res.status(403).json({ error: "Account deactivated" });
  if (user.locked) return res.status(403).json({ error: "Account locked" });

  req.user = user;
  next();
}

// OPTIONAL quick admin gate for dev:

function requireAdmin(req, res, next) {
  return next();
}


// -------------------------
// Health check
// -------------------------
app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: nowIso(), port: PORT });
});
// Root -> redirect to login page
app.get("/", (req, res) => {
  res.redirect("/Capstone/login.html");
});


// -------------------------
// ADMIN: USERS
// -------------------------
app.get("/api/admin/users", requireAdmin, (req, res) => {
  const db = readJsonSafe(USERS_FILE, { users: [] });
  const safeUsers = db.users.map(({ password_hash, ...rest }) => rest);
  res.json({ users: safeUsers });
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const name = safeText(req.body?.name);
  const email = safeText(req.body?.email).toLowerCase();

  if (!name || !email) return res.status(400).json({ error: "Name and email required" });

  const db = readJsonSafe(USERS_FILE, { users: [] });
  const exists = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (exists) return res.status(409).json({ error: "User with that email already exists" });

  const user_id = uid();
  const user = {
    user_id,
    name,
    email,
    active: true,
    locked: false,
    failed_attempts: 0,
    must_set_password: true,
    password_hash: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  db.users.push(user);
  writeJsonAtomic(USERS_FILE, db);

  ensureBuyerRecord(user_id);

  const { token } = createToken({ user_id, type: "setup", minutesValid: 60 });
  const link = `http://127.0.0.1:${PORT}/Capstone/set-password.html?token=${encodeURIComponent(token)}&type=setup`;

  await sendEmail(
    user.email,
    "Set your password",
    `<p>Hi ${user.name},</p>
     <p>Click below to set your password:</p>
     <p><a href="${link}">Set Password</a></p>
     <p>This link expires in 60 minutes.</p>`
  );

  res.json({ ok: true, user_id, link });
});

app.post("/api/admin/users/send-link", requireAdmin, async (req, res) => {
  const user_id = safeText(req.body?.user_id);
  const type = safeText(req.body?.type);

  if (!user_id || !type) return res.status(400).json({ error: "user_id and type required" });
  if (!["setup", "reset"].includes(type)) return res.status(400).json({ error: "type must be setup or reset" });

  const db = readJsonSafe(USERS_FILE, { users: [] });
  const user = db.users.find((u) => u.user_id === user_id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.active) return res.status(403).json({ error: "User is deactivated" });

  const { token } = createToken({ user_id, type, minutesValid: 60 });
  const link = `http://127.0.0.1:${PORT}/Capstone/set-password.html?token=${encodeURIComponent(token)}&type=${type}`;

  await sendEmail(
    user.email,
    type === "reset" ? "Reset your password" : "Set your password",
    `<p>Hi ${user.name},</p>
     <p>Click below to ${type === "reset" ? "reset" : "set"} your password:</p>
     <p><a href="${link}">${type === "reset" ? "Reset Password" : "Set Password"}</a></p>
     <p>This link expires in 60 minutes.</p>`
  );

  res.json({ ok: true, link });
});

app.post("/api/admin/users/toggle-active", requireAdmin, (req, res) => {
  const user_id = safeText(req.body?.user_id);
  if (!user_id) return res.status(400).json({ error: "user_id required" });

  const db = readJsonSafe(USERS_FILE, { users: [] });
  const user = db.users.find((u) => u.user_id === user_id);
  if (!user) return res.status(404).json({ error: "User not found" });

  user.active = !user.active;
  user.updated_at = nowIso();
  if (!user.active) user.locked = true;

  writeJsonAtomic(USERS_FILE, db);
  res.json({ ok: true, active: user.active });
});

// -------------------------
// ADMIN: BUYER BASICS
// -------------------------
app.get("/api/admin/users/:userId/buyer-basics", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const db = ensureBuyerRecord(userId);
  res.json({ buyer_basics: db.buyers[userId].buyer_basics || {} });
});

app.put("/api/admin/users/:userId/buyer-basics", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const payload = req.body || {};

  const db = ensureBuyerRecord(userId);

  db.buyers[userId].buyer_basics = {
    name: safeText(payload.name),
    email: safeText(payload.email).toLowerCase(),
    phone: safeText(payload.phone),
    target_move_date: safeText(payload.target_move_date),
    preapproval_status: safeText(payload.preapproval_status),
    budget_range: safeText(payload.budget_range),
    preferred_areas: safeText(payload.preferred_areas),
    dealbreakers: safeText(payload.dealbreakers),
  };
  db.buyers[userId].updated_at = nowIso();

  writeBuyerDb(db);
  res.json({ ok: true });
});

// -------------------------
// ADMIN: ASSIGNED HOMES
// -------------------------
app.get("/api/admin/users/:userId/homes", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const db = ensureBuyerRecord(userId);
  res.json({ homes: db.buyers[userId].homes || [] });
});

app.put("/api/admin/users/:userId/homes", requireAdmin, (req, res) => {
  const userId = req.params.userId;
  const homes = req.body?.homes;

  if (!Array.isArray(homes)) return res.status(400).json({ error: "homes must be an array" });

  const db = ensureBuyerRecord(userId);

  db.buyers[userId].homes = homes.map((h) => ({
    home_id: safeText(h.home_id) || uid(),
    address: safeText(h.address),
    price: Number(h.price) || null,
    sqft: Number(h.sqft) || null,
    link: safeText(h.link),
    photo: safeText(h.photo),
  }));

  db.buyers[userId].updated_at = nowIso();
  writeBuyerDb(db);

  res.json({ ok: true, count: db.buyers[userId].homes.length });
});

// -------------------------
// AUTH: LOGIN / LOGOUT
// -------------------------
app.post("/api/auth/login", async (req, res) => {
  const email = safeText(req.body?.email).toLowerCase();
  const password = safeText(req.body?.password);

  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const db = readJsonSafe(USERS_FILE, { users: [] });
  const user = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (!user.active) return res.status(403).json({ error: "Account deactivated" });
  if (user.locked) return res.status(403).json({ error: "Account locked. Request a reset link." });
  if (!user.password_hash) return res.status(403).json({ error: "Password not set. Check your email for setup link." });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    user.failed_attempts = (user.failed_attempts || 0) + 1;
    user.updated_at = nowIso();
    if (user.failed_attempts >= 7) user.locked = true;
    writeJsonAtomic(USERS_FILE, db);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  user.failed_attempts = 0;
  user.updated_at = nowIso();
  writeJsonAtomic(USERS_FILE, db);

  req.session.user_id = user.user_id;
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// -------------------------
// PASSWORD SET/RESET
// -------------------------
app.post("/api/auth/set-password", async (req, res) => {
  const token = safeText(req.body?.token);
  const type = safeText(req.body?.type);
  const new_password = safeText(req.body?.new_password);

  if (!token || !type || !new_password) return res.status(400).json({ error: "token, type, new_password required" });
  if (!["setup", "reset"].includes(type)) return res.status(400).json({ error: "type must be setup or reset" });
  if (new_password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const consumed = consumeToken(token, type);
  if (!consumed.ok) return res.status(400).json({ error: consumed.error });

  const db = readJsonSafe(USERS_FILE, { users: [] });
  const user = db.users.find((u) => u.user_id === consumed.user_id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (!user.active) return res.status(403).json({ error: "Account deactivated" });

  user.password_hash = await bcrypt.hash(new_password, 12);
  user.must_set_password = false;
  user.locked = false;
  user.failed_attempts = 0;
  user.updated_at = nowIso();
  writeJsonAtomic(USERS_FILE, db);

  res.json({ ok: true });
});

// -------------------------
// BUYER: CONTEXT (protected)
// -------------------------
app.get("/api/buyer/context", requireAuth, (req, res) => {
  const userId = req.user.user_id;

  const db = ensureBuyerRecord(userId);
  const rec = db.buyers[userId];

  res.json({
    buyer_basics: rec.buyer_basics || {},
    homes: rec.homes || [],
    saved: rec.saved || { amenities: [], homes: [] },
    updated_at: rec.updated_at || "",
  });
});

app.put("/api/buyer/context", requireAuth, (req, res) => {
  const userId = req.user.user_id;
  const payload = req.body || {};

  const db = ensureBuyerRecord(userId);
  const rec = db.buyers[userId];

  rec.saved = rec.saved || { amenities: [], homes: [] };

  const amenities = payload?.saved?.amenities;
  const homes = payload?.saved?.homes;

  if (Array.isArray(amenities)) rec.saved.amenities = amenities;
  if (Array.isArray(homes)) rec.saved.homes = homes;

  rec.updated_at = nowIso();
  writeBuyerDb(db);

  res.json({ ok: true });
});

// -------------------------
// Start
// -------------------------
console.log("ABOUT TO LISTEN");

app.listen(PORT, () => {
  console.log(`✅ Server running on http://127.0.0.1:${PORT}`);
});
