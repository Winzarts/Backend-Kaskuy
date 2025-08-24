require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path"); // tambahan untuk upload avatar

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

const upload = multer({ storage: multer.memoryStorage() });

app.post("/auth/request-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email wajib diisi" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 menit

    const { error: insertError } = await supabase
      .from("otp_codes")
      .insert([
        {
          email,
          otp_code: otp,
          expires_at: expiresAt.toISOString(),
          used: false,
        },
      ]);

    if (insertError) throw insertError;

    // Kirim email OTP (gunakan transporter Nodemailer)
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Kode OTP Verifikasi",
      text: `Kode OTP kamu adalah: ${otp}. Berlaku 5 menit.`,
    });

    return res.json({ message: "OTP sudah dikirim ke email" });
  } catch (err) {
    console.error("OTP request error:", err.message);
    return res.status(500).json({ error: "Gagal membuat OTP" });
  }
});


app.post("/auth/verify-otp", async (req, res) => {
  try {
    const { email, otp_code, full_name } = req.body;

    if (!email || !otp_code) {
      return res.status(400).json({ error: "Email dan OTP wajib diisi" });
    }

    // Cari OTP terbaru yang masih aktif
    const { data: otpData, error: otpError } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email)
      .eq("otp_code", otp_code)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpData) {
      return res.status(400).json({ error: "OTP tidak valid" });
    }

    // Cek kadaluarsa
    if (new Date(otpData.expires_at) < new Date()) {
      return res.status(400).json({ error: "OTP sudah kadaluarsa" });
    }

    // Tandai OTP sudah digunakan
    await supabase
      .from("otp_codes")
      .update({ used: true })
      .eq("id", otpData.id);

    // Buat user baru di Supabase Auth
    const { data: userData, error: userError } =
      await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (userError) throw userError;

    // Simpan ke tabel `user_profiles`
    const { error: profileError } = await supabase
      .from("user_profiles")
      .insert([
        {
          id: userData.user.id,
          full_name: full_name || email.split("@")[0],
          email: email,
          absen: null,
          kelas_id: null,
        },
      ]);

    if (profileError) throw profileError;

    return res.json({ message: "Registrasi berhasil", user: userData.user });
  } catch (err) {
    console.error("Verify OTP error:", err.message);
    return res.status(500).json({ error: "Gagal ver


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
    return res.json({ session: data.session, user: data.user });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

// PERBAIKAN: Google Auth - struktur yang benar
app.get("/auth/google", async (req, res) => {
  try {
    const redirectTo = "https://backend-kaskuy-production.up.railway.app/auth/google/callback";
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
      },
    });

    if (error) throw error;

    res.redirect(data.url);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PERBAIKAN: Google callback - pindahkan keluar dari endpoint atas
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ success: false, message: "No code provided" });

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;

    const user_id = data.user.id;
    const email = data.user.email;
    const full_name = data.user.user_metadata?.full_name || data.user.user_metadata?.name || null;

    // cek profile
    const { data: existingProfile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user_id)
      .maybeSingle();

    let redirectUrl;

    if (!existingProfile) {
      // profile belum ada → arahkan ke CompleteProfile
      await supabase.from("user_profiles").insert([
        { id: user_id, full_name, role: "user" }
      ]);

      redirectUrl = `${process.env.FRONTEND_URL}/complete-profile?access_token=${data.session.access_token}&refresh_token=${data.session.refresh_token}`;
    } else if (!existingProfile.kelas_id || !existingProfile.absen) {
      // profile ada tapi belum lengkap
      redirectUrl = `${process.env.FRONTEND_URL}/complete-profile?access_token=${data.session.access_token}&refresh_token=${data.session.refresh_token}`;
    } else {
      // profile lengkap → langsung ke dashboard
      redirectUrl = `${process.env.FRONTEND_URL}/dashboard?access_token=${data.session.access_token}&refresh_token=${data.session.refresh_token}`;
    }

    res.redirect(redirectUrl);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
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

app.get("/members", async (req, res) => {
  try {
    const { kelas_id } = req.query;
    if (!kelas_id) {
      return res.status(400).json({ error: "kelas_id wajib" });
    }

    const { data, error } = await supabase
      .rpc("get_members_with_total", { kelas: kelas_id });

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

app.get("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, email, photo, role, absen, kelas_id")
      .eq("id", id)
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "internal error" });
  }
});

app.put("/profile/update", async (req, res) => {
  try {
    const { id, full_name, email, photo } = req.body;
    if (!id) return res.status(400).json({ error: "User ID wajib" });

    const { error } = await supabase
      .from("user_profiles")
      .update({ full_name, email, photo })
      .eq("id", id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, message: "Profil berhasil diperbarui" });
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
    if (!file) {
      return res.status(400).json({ error: "File tidak ditemukan" });
    }

    const fileExt = path.extname(file.originalname);
    const fileName = `${Date.now()}${fileExt}`;
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
