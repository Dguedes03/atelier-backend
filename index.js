import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { auth, adminOnly } from "./middlewares/auth.js";

dotenv.config();

const app = express();

// ==========================
// MULTER (MEMORY STORAGE) ✅
// ==========================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
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
        url,
        order_index
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
        return res.status(400).json({
          error: "Título e descrição são obrigatórios"
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          error: "Envie ao menos uma imagem"
        });
      }

      // 1️⃣ Cria produto
      const { data: product, error: productError } = await supabase
        .from("products")
        .insert({ title, description })
        .select()
        .single();

      if (productError) {
        console.error(productError);
        return res.status(500).json({ error: productError.message });
      }

      // 2️⃣ Upload das imagens
      const images = [];

      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        const fileName = `${product.id}-${Date.now()}-${i}`;

        const { error: uploadError } = await supabase.storage
          .from("photos")
          .upload(fileName, file.buffer, {
            contentType: file.mimetype
          });

        if (uploadError) {
          console.error(uploadError);
          return res.status(500).json({ error: uploadError.message });
        }

        const { data } = supabase.storage
          .from("photos")
          .getPublicUrl(fileName);

        images.push({
          product_id: product.id,
          url: data.publicUrl,
          order_index: i
        });
      }

      // 3️⃣ Salva imagens no banco
      const { error: imageError } = await supabase
        .from("product_images")
        .insert(images);

      if (imageError) {
        console.error(imageError);
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
// ME
// ==========================
app.get("/me", auth, async (req, res) => {
  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .maybeSingle();

  res.json({
    id: req.user.id,
    role: data?.role || "cliente"
  });
});

// ==========================
// START SERVER
// ==========================
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
