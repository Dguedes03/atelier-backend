import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { auth, adminOnly } from "./middlewares/auth.js";

dotenv.config();

const app = express();

// ==========================
// MULTER (UPLOAD MÚLTIPLO)
// ==========================
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB por imagem
});

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
// ROOT / HEALTH
// ==========================
app.get("/", (_, res) => {
  res.send("🚀 Atelier Backend rodando");
});

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

  const { error: profileError } = await supabase.from("profiles").insert({
    id: data.user.id,
    role: "cliente",
    cpf,
    telefone
  });

  if (profileError) {
    return res.status(400).json({ error: profileError.message });
  }

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
    redirectTo: "https://dguedes03.github.io/Persona/reset.html"
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json({ ok: true });
});

// ==========================
// PRODUCTS (PUBLIC)
// ==========================
app.get("/products", async (_, res) => {
  const { data, error } = await supabase
    .from("products")
    .select(`
      id,
      title,
      description,
      product_images (
        id,
        url
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data);
});

// ==========================
// PRODUCTS (ADMIN - CREATE)
// ==========================
app.post(
  "/products",
  auth,
  adminOnly,
  upload.array("files", 10),
  async (req, res) => {
    try {
      const { title, description } = req.body;

      if (!title || !description) {
        return res
          .status(400)
          .json({ error: "Título e descrição são obrigatórios" });
      }

      if (!req.files || req.files.length === 0) {
        return res
          .status(400)
          .json({ error: "Envie ao menos uma imagem" });
      }

      // 1️⃣ cria produto
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({ title, description })
        .select()
        .single();

      if (productError) {
        return res.status(500).json({ error: productError.message });
      }

      // 2️⃣ upload das imagens
      const images = [];

      for (const file of req.files) {
        const fileName = `${Date.now()}-${file.originalname}`;

        const { error: uploadError } = await supabase.storage
          .from("photos")
          .upload(fileName, file.buffer, {
            contentType: file.mimetype
          });

        if (uploadError) {
          return res.status(500).json({ error: uploadError.message });
        }

        const { data } = supabase.storage
          .from("photos")
          .getPublicUrl(fileName);

        images.push({
          product_id: product.id,
          url: data.publicUrl
        });
      }

      // 3️⃣ salva imagens no banco
      const { error: imageError } = await supabase
        .from("product_images")
        .insert(images);

      if (imageError) {
        return res.status(500).json({ error: imageError.message });
      }

      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("PRODUCT CREATE ERROR:", err);
      res.status(500).json({ error: "Erro interno no servidor" });
    }
  }
);

// ==========================
// PRODUCTS (ADMIN - DELETE)
// ==========================
app.delete("/products/:id", auth, adminOnly, async (req, res) => {
  const { id } = req.params;

  const { data: images } = await supabase
    .from("product_images")
    .select("url")
    .eq("product_id", id);

  if (images) {
    for (const img of images) {
      const fileName = img.url.split("/").pop();
      await supabase.storage.from("photos").remove([fileName]);
    }
  }

  await supabase.from("products").delete().eq("id", id);

  res.json({ ok: true });
});

// ==========================
// STATS
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
// ME
// ==========================
app.get("/me", auth, async (req, res) => {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .maybeSingle();

  if (!data) {
    await supabase.from("profiles").insert({
      id: req.user.id,
      role: "cliente"
    });

    return res.json({
      id: req.user.id,
      role: "cliente"
    });
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
