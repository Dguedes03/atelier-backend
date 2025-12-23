import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { auth, adminOnly } from "./middlewares/auth.js";

dotenv.config();

const app = express();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

// ==========================
// MIDDLEWARES
// ==========================
app.use(cors());
app.use(express.json());

// ==========================
// SUPABASE (SERVICE ROLE)
// ==========================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==========================
// HEALTH
// ==========================
app.get("/health", (_, res) => {
  res.send("Server is healthy");
});

// ==========================
// AUTH
// ==========================
app.post("/auth/register", async (req, res) => {
  const { email, password, cpf, telefone } = req.body;

  if (!email || !password || !cpf || !telefone) {
    return res.status(400).json({ error: "Dados obrigatórios faltando" });
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  await supabase.from("profiles").insert({
    id: data.user.id,
    role: "cliente",
    cpf,
    telefone
  });

  res.status(201).json({ ok: true });
});

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    return res.status(401).json({ error: "Login inválido" });
  }

  res.json({
    access_token: data.session.access_token,
    user: data.user
  });
});

app.post("/auth/recover", async (req, res) => {
  const { email } = req.body;

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: "https://dguedes03.github.io/Persona/"
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ ok: true });
});

// ==========================
// PHOTOS (PUBLIC)
// ==========================
app.get("/photos", async (_, res) => {
  const { data } = await supabase.from("photos").select("*");
  res.json(data);
});

// ==========================
// PHOTOS (ADMIN)
// ==========================
app.post(
  "/photos",
  auth,
  adminOnly,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Arquivo não enviado" });
    }

    const name = `${Date.now()}-${req.file.originalname}`;

    await supabase.storage.from("photos").upload(name, req.file.buffer);

    const { data } = supabase.storage.from("photos").getPublicUrl(name);

    await supabase.from("photos").insert({ url: data.publicUrl });

    res.status(201).json({ url: data.publicUrl });
  }
);

// ==========================
// STATS (PUBLIC)
// ==========================
app.post("/stats/visit", async (_, res) => {
  await supabase.rpc("increment_visitas");
  res.json({ ok: true });
});

app.post("/stats/click-image", async (_, res) => {
  await supabase.rpc("increment_clique_imagem");
  res.json({ ok: true });
});

app.post("/stats/click-orcamento", async (_, res) => {
  await supabase.rpc("increment_clique_orcamento");
  res.json({ ok: true });
});

// ==========================
// ADMIN
// ==========================
app.get("/admin/stats", auth, adminOnly, async (_, res) => {
  const { data } = await supabase
    .from("stats")
    .select("*")
    .eq("id", 1)
    .single();

  res.json(data);
});

app.get("/admin/clients", auth, adminOnly, async (_, res) => {
  const { data } = await supabase
    .from("profiles")
    .select("cpf, telefone, role");

  res.json(data.filter(p => p.role !== "admin"));
});

// ==========================
// ME (QUEM ESTÁ LOGADO)
// ==========================
app.get("/me", auth, async (req, res) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .single();

  if (error) {
    return res.status(500).json({ error: "Erro ao buscar perfil" });
  }

  res.json({
    id: req.user.id,
    role: data.role
  });
});

// ==========================
// START SERVER
// ==========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
