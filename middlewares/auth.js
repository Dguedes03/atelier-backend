import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// 🔐 carrega o .env AQUI TAMBÉM
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==========================
// AUTH (JWT)
// ==========================
export async function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não enviado" });
  }

  const token = authHeader.replace("Bearer ", "");

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    return res.status(401).json({ error: "Token inválido" });
  }

  req.user = data.user;
  next();
}

// ==========================
// ADMIN ONLY
// ==========================
export async function adminOnly(req, res, next) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", req.user.id)
    .single();

  if (error || !data || data.role !== "admin") {
    return res.status(403).json({ error: "Acesso negado" });
  }

  next();
}
