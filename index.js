require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require("express-rate-limit");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false, 
  message: { error: "Terlalu banyak request, coba lagi nanti" }
});
app.use(generalLimiter);

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu sering minta OTP, coba lagi nanti" }
});

app.post("/auth/request-otp", otpLimiter, async (req, res) => {

  res.json({ message: "OTP terkirim" });
});

app.get("/", (req, res) => {
  res.json({ ok: true, service: "kas-backend", now: new Date().toISOString() });
});

app.post("/register", async (req, res) => {
  try {
    const { email, password, full_name, kelas_id, absen } = req.body;
    if (!email || !password || !full_name) {
      return res.status(400).json({ error: "email, password, full_name wajib" });
    }

    const { data: created, error: authErr } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
    if (authErr) return res.status(400).json({ error: authErr.message });

    const user_id = created.user.id;

    const { error: profErr } = await supabase
      .from("user_profiles")
      .insert([{ id: user_id, full_name, kelas_id: kelas_id || null, absen, role: "user" }]);
    if (profErr) return res.status(400).json({ error: profErr.message });

    return res.json({ message: "register ok", user_id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(400).json({ error: error.message });
    // kirim session ke frontend (access_token, refresh_token)
    return res.json({ session: data.session, user: data.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/kelas", async (_req, res) => {
  try {
    const { data, error } = await supabase.from("kelas").select("*").order("nama_kelas");
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/pemasukan", async (req, res) => {
  try {
    const { user_id, kelas_id, nominal, tanggal } = req.body;
    if (!user_id || !kelas_id || !nominal) {
      return res.status(400).json({ error: "user_id, kelas_id, nominal wajib" });
    }
    const payload = {
      user_id,
      kelas_id,
      nominal,
      ...(tanggal ? { tanggal } : {})
    };
    const { data, error } = await supabase.from("pemasukan").insert([payload]).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/pemasukan", async (req, res) => {
  try {
    const { kelas_id } = req.query;
    const q = supabase.from("pemasukan").select("*").order("created_at", { ascending: false });
    const { data, error } = kelas_id ? await q.eq("kelas_id", kelas_id) : await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/pengeluaran", async (req, res) => {
  try {
    const { kelas_id, alasan, nominal, tanggal } = req.body;
    if (!kelas_id || !alasan || !nominal) {
      return res.status(400).json({ error: "kelas_id, alasan, nominal wajib" });
    }
    const payload = {
      kelas_id,
      alasan,
      nominal,
      ...(tanggal ? { tanggal } : {})
    };
    const { data, error } = await supabase.from("pengeluaran").insert([payload]).select("*").single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/pengeluaran", async (req, res) => {
  try {
    const { kelas_id } = req.query;
    const q = supabase.from("pengeluaran").select("*").order("created_at", { ascending: false });
    const { data, error } = kelas_id ? await q.eq("kelas_id", kelas_id) : await q;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/admin-requests", async (req, res) => {
  try {
    const { user_id, kelas_id } = req.body;
    if (!user_id || !kelas_id) {
      return res.status(400).json({ error: "user_id dan kelas_id wajib" });
    }

    const { data, error } = await supabase
      .from("admin_requests")
      .insert([{ user_id, kelas_id, status: "pending" }])
      .select("request_id, user_id, kelas_id, status, created_at")
      .single();

    if (error) return res.status(400).json({ error: error.message });

    try {
      await mailer.sendMail({
        from: `"Kas App" <${process.env.SMTP_USER}>`,
        to: process.env.ADMIN_EMAIL,
        subject: "Pengajuan Admin Baru",
        html: `
          <p>Hai Admin,</p>
          <p>Ada <b>pengajuan admin</b> baru:</p>
          <ul>
            <li>request_id: <code>${data.request_id}</code></li>
            <li>user_id: <code>${data.user_id}</code></li>
            <li>kelas_id: <code>${data.kelas_id}</code></li>
            <li>status: <b>${data.status}</b></li>
            <li>waktu: ${data.created_at}</li>
          </ul>
          <p>Silakan approve/reject lewat panel admin kamu.</p>
        `
      });
    } catch (mailErr) {
      console.error("email gagal:", mailErr.message);
    }

    res.json({ message: "request terkirim (pending)", data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.get("/admin-requests", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("admin_requests")
      .select("request_id, user_id, kelas_id, status, created_at")
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.put("/admin-requests/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "status tidak valid" });
    }

    const { data: updated, error: updErr } = await supabase
      .from("admin_requests")
      .update({ status })
      .eq("request_id", request_id)
      .select("request_id, user_id, kelas_id, status")
      .single();
    if (updErr) return res.status(400).json({ error: updErr.message });

    if (status === "approved" && updated?.user_id) {
      const { error: roleErr } = await supabase
        .from("user_profiles")
        .update({ role: "admin" })
        .eq("id", updated.user_id);
      if (roleErr) return res.status(400).json({ error: roleErr.message });
    }

    res.json({ message: `status: ${status}`, data: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.post("/upload-avatar", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}${fileExt}`; // nama unik
    const filePath = `avatars/${fileName}`;

    // upload ke supabase storage
    const { data, error } = await supabase.storage
      .from("avatars")
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });

    if (error) throw error;

    // ambil URL public
    const { data: publicUrl } = supabase.storage
      .from("avatars")
      .getPublicUrl(filePath);

    res.json({ url: publicUrl.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Upload gagal" });
  }
});

const PORT = Number(process.env.PORT || 5000);
app.listen(PORT, () => {
  console.log(`✅ API ready at http://localhost:${PORT}`);
});
