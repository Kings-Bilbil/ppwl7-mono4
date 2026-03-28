import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { cookie } from "@elysiajs/cookie";
import { prisma } from "../prisma/db";
import { createOAuthClient, getAuthUrl } from "./auth";
import { getCourses, getCourseWorks, getSubmissions } from "./classroom";
import type { ApiResponse, HealthCheck, User } from "shared";

const tokenStore = new Map<string, { access_token: string; refresh_token?: string }>();

const app = new Elysia()
  // 1. Modifikasi CORS agar frontend deployment (HTTPS) bisa mengaksesnya
  .use(
    cors({
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true, // WAJIB untuk membaca session/cookie login
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  )
  .use(swagger())
  .use(cookie())
  
  // 2. Proteksi API_KEY untuk rute /users (mencegah akses langsung tanpa izin)
  .onRequest(({ request, set }) => {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/users")) {
      const origin = request.headers.get("origin");
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
      const key = url.searchParams.get("key");

      // Izinkan jika request asli datang dari web Frontend kita
      if (origin === frontendUrl) {
        return;
      }

      // Jika dari luar (Postman/Browser langsung), WAJIB punya API_KEY
      if (key !== process.env.API_KEY) {
        set.status = 401;
        return { message: "Unauthorized: Access denied without valid API Key" };
      }
    }
  })

  // Health check
  .get("/", (): ApiResponse<HealthCheck> => ({
    data: { status: "ok" },
    message: "server running",
  }))

  // Users
  .get("/users", async () => {
    const users = await prisma.user.findMany();
    const response: ApiResponse<User[]> = {
      data: users,
      message: "User list retrieved",
    };
    return response;
  })

  // Redirect mahasiswa ke halaman login Google
  .get("/auth/login", ({ redirect }) => {
    const oauth2Client = createOAuthClient();
    const url = getAuthUrl(oauth2Client);
    return redirect(url);
  })

  // Google callback setelah login
  .get("/auth/callback", async ({ query, set, cookie: { session }, redirect }) => {
    const { code } = query as { code: string };

    if (!code) {
      set.status = 400;
      return { error: "Missing authorization code" };
    }

    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    const sessionId = crypto.randomUUID();
    tokenStore.set(sessionId, {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token ?? undefined,
    });
    if (!session) return;

    session.value = sessionId;
    session.maxAge = 60 * 60 * 24; // 1 hari
    session.path = "/";

    // 3. Konfigurasi PRODUCTION untuk Cookie HTTPS
    session.httpOnly = true;
    session.secure = true;    // WAJIB: Cookie hanya dikirim lewat HTTPS
    session.sameSite = "none"; // WAJIB: Agar cookie bisa dikirim antar domain berbeda

    // 4. Redirect ke Frontend Dinamis
    return redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/classroom`);
  })

  // Cek status login
  .get("/auth/me", ({ cookie: { session } }) => {
    const sessionId = session?.value as string;
    if (!sessionId || !tokenStore.has(sessionId)) {
      return { loggedIn: false };
    }
    return { loggedIn: true, sessionId };
  })

  // Logout
  .post("/auth/logout", ({ cookie: { session } }) => {
    if(!session) return { success: false };

    const sessionId = session?.value as string;
    if (sessionId) {
      tokenStore.delete(sessionId);
      session.remove();
    }
    return { success: true };
  })

  // Ambil daftar courses mahasiswa
  .get("/classroom/courses", async ({ cookie: { session }, set }) => {
    const sessionId = session?.value as string;
    const tokens = sessionId ? tokenStore.get(sessionId) : null;

    if (!tokens) {
      set.status = 401;
      return { error: "Unauthorized. Silakan login terlebih dahulu." };
    }

    const courses = await getCourses(tokens.access_token);
    return { data: courses, message: "Courses retrieved" };
  })

  // Ambil coursework + submisi untuk satu course
  .get("/classroom/courses/:courseId/submissions", async ({ params, cookie: { session }, set }) => {
    const sessionId = session?.value as string;
    const tokens = sessionId ? tokenStore.get(sessionId) : null;

    if (!tokens) {
      set.status = 401;
      return { error: "Unauthorized. Silakan login terlebih dahulu." };
    }

    const { courseId } = params;

    const [courseWorks, submissions] = await Promise.all([
      getCourseWorks(tokens.access_token, courseId),
      getSubmissions(tokens.access_token, courseId),
    ]);

    const submissionMap = new Map(submissions.map((s) => [s.courseWorkId, s]));

    const result = courseWorks.map((cw) => ({
      courseWork: cw,
      submission: submissionMap.get(cw.id) ?? null,
    }));

    return { data: result, message: "Course submissions retrieved" };
  });

// 5. Console.log disembunyikan saat di Vercel (Production)
if (process.env.NODE_ENV != "production") {
  app.listen(3000);
  console.log(`🦊 Backend → http://localhost:3000`);
  console.log(`🦊 FRONTEND_URL → ${process.env.FRONTEND_URL || "http://localhost:5173"}`); 
  console.log(`🦊 DATABASE_URL: ${process.env.DATABASE_URL}`); 
  console.log(`🦊 GOOGLE_REDIRECT_URI: ${process.env.GOOGLE_REDIRECT_URI}`); 
}

// 6. Export app agar dikenali oleh serverless Vercel
export default app;

// Trigger Vercel Rebuild Baru
// Test ignore build steps
// Final Check: Ignore Build Step Test