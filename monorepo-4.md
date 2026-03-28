# Monorepo Phase 4
Proyek terakhir untuk mendapatkan deployment monorepo secara rapi:
1. Deploy front-end & backend ke [Vercel](https://vercel.com/)
   - Deploy terpisah: backend dan frontend project sendiri.
   - Koneksi ke github repo: Koneksi manual dari web vercel, tidak pakai Vercel CLI.
   - Vercel **Ignore Build Steps**: ketika hanya frotnend yang ada perubahan, backend tidak ikut ter build.
   - Api Key untuk akses route di backend.
   - Fungsi berjalan sama seperti di development.
2. Deploy database sqlite ke [turso](https://turso.tech/)

## Apps/Backend
Beberapa setting yang diperlukan sebelum deploy ke vercel.

> 🚨 Perhatian: Setiap file yang dimention di sini berada relatif di dalam `apps/backend/`

### 1. **Build pakai tsdown**
Ketika build di vercel, dependency shared harus di bundle (tidak external), kita menggunakan `tsdown` untuk ubah typescript jadi javascript.

```bash
cs apps/backend
bun add -D tsdown
```

`tsdown.config.ts`:
```ts
import { defineConfig } from 'tsdown'

export default defineConfig({
  deps: {
    alwaysBundle: ['shared']
  }
})
```

### 2. **vercel.json**
Vercel bun perlu config khusus untuk backend elysia:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "bunVersion": "1.x",
  "installCommand": "bun install",
  "outputDirectory": "dist"
}
```

### 3. **Turso Database**
- Buka web [turso](https://turso.tech/) -> Login pakai akun Github
- `Create Database`: **monorepo** -> `Create Token`
- Salin `Database URL` dan `Auth Token` ke `.env.production` (tambahkan path file ini ke `.gitignore`). 
- Ubah file `prisma/db.ts`. Turso memerlukan authToken ketika di koneksi:
```ts
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL!,
  authToken: process.env.DB_AUTH_TOKEN,
});

export const prisma = new PrismaClient({ adapter });
```

### 4. **package.json**
Beberapa script **ditambahkan/dimodifikasi** untuk fungsi build vercel & seed database.
```json
{
  "scripts": {
    "build": "prisma generate && tsdown",
    "start": "bun dist/index.mjs",
    "postinstall": "prisma generate",
    "prod:sql": "bunx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > baseline.sql",
    "prod:check-env": "bun --env-file=.env.production -e \"console.log(process.env.DATABASE_URL)\"",
    "prod:migrate": "bun --env-file=.env.production prisma/migrate.ts",
    "prod:seed": "bun --env-file=.env.production prisma/seed.ts",
    "dev:turso" : "bun --env-file=.env.production src/index.ts"
  },
}
```
Keterangan:
- Vercel: `build` pakai tsdown, `start` untuk cek hasil build. `postinstall` untuk memastikan prisma di generate setelah build (double check di vercel). 
- Turso: 
  - generate file `baseline.sql` (skema) -> masukkan ke database turso.
  - Seeding data tabel user ke database turso.
  - `bun dev:turso` untuk test koneksi web dev dengan seeder. 
> ! Tambahkan script yang tidak ada, modifikasi script yang berbeda. JANGAN DITIMPA ! 

### 5. **src/index.ts**
edit/tambah beberapa bagian kode (jangan ada duplikasi!):

```ts
// !!! tambahkan Fungsi ini 
const isBrowserRequest = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const accept = request.headers.get("accept") ?? "";

  // Browser biasanya kirim Accept: text/html
  const acceptsHtml = accept.includes("text/html");

  // Tidak ada origin & referer = direct browser access / curl
  // Tapi curl tidak kirim Accept: text/html, browser kirim
  return acceptsHtml && !origin && !referer;
};

const app = new Elysia()
  // !!! modifikasi cors() dan onRequest
  .use(cors({ origin: [process.env.FRONTEND_URL ?? "", process.env.TEST_URL ?? ""] }))
  .onRequest(({ request, set }) => {
    const url = new URL(request.url);
    // HANYA jalankan logika jika path dimulai dengan /users
    if (url.pathname.startsWith("/users")) {
      const origin = request.headers.get("origin");
      const frontendUrl = process.env.FRONTEND_URL ?? "";

      // Jika request dari FRONTEND_URL → langsung izinkan
      if (origin && origin === frontendUrl) return;

      // Jika akses dari browser langsung → wajib ada ?key=
      if (isBrowserRequest(request)) {
        const key = url.searchParams.get("key");

        if (!key || key !== process.env.API_KEY) {
          set.status = 401;
          return { message: "Unauthorized: missing or invalid key" };
        }
      }
    }
  })
  // ... lanjutan route kode lainnya (google, akses database)
  // !!! ubah url frontend jadi dynamic ambil dari env (lakukan ke semua file di apps/backend), contoh:
      return redirect(`${process.env.FRONTEND_URL}/classroom`);

  // !!! tambahakan Endpoint test prisma client Elysia atau function utama (sering bermasalah)
  .get("/debug-prisma", () => {
    const generatedPath = path.resolve(__dirname, "../src/generated/prisma/client");
    const exists = fs.existsSync(generatedPath);

    return {
      path: generatedPath,
      exists: exists,
      files: exists ? fs.readdirSync(generatedPath) : []
    };
  });
  // !!! hapus bagian .listen(3000);

// !!! hapus console log "yang terbuka" ini:
// console.log(`🦊 Backend → http://localhost:${app.server?.port}`);
// console.log(`📖 Swagger → http://localhost:${app.server?.port}/swagger`);

// !!! buat console log yang tidak tampil di production & pakai nilai dari ENV
if (process.env.NODE_ENV != "production") {
  app.listen(3000);
  console.log(`🦊 Backend → http://localhost:3000`);
  console.log(`🦊 TEST_URL: ${process.env.TEST_URL}`);
  console.log(`🦊 DATABASE_URL: ${process.env.DATABASE_URL}`);
}

// !!! tambahkan export app agar Elysia dapat dibaca Vercel serverless.
export default app;
```
Beberapa modifikasi:
- Ubah url ke relatif. `FRONTEND_URL` untuk url utama, `TEST_URL` dapat diset `*` untuk unlock semua url (memudahkan debugging/development).
- gunakan API_KEY sebagai param untuk akses route `/users` (*protect data in database*).
- Console log dynamic mengikuti variabel & tidak tampil di production.
- export default app untuk Elysia dibaca oleh Vercel.

### 6. **prisma/migrate.ts**
File untuk menjalankan query `baseline.sql` ke turdo database.
```ts
import { prisma } from "./db";
import { readFileSync } from "fs";
import { join } from "path";

const sql = readFileSync(join(__dirname, "../baseline.sql"), "utf-8");

const statements = sql
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0);

for (const statement of statements) {
  await prisma.$executeRawUnsafe(statement);
}

await prisma.$disconnect();
```
> [?] migrate.ts sebenarnya fungsi untuk menjalankan query, anda dapat menggunakan kode ini jiga ingin mengubah skema database (tinggal edit file sql nya).

Setelah setup file untuk database, kita akan memasukkan data ke Turso. 

**!!! Jalankan:**
```bash
cd apps/backend
bun prod:sql # generate file baseline.sql
bun prod:check-env # cek dulu DATABASE_URL sudah pakai url Turso. Jika sudah, lanjut!
bun prod:migrate # run query dari file baseline.sql. berisi skema tabel
bun prod:seed # mengisi data ke dalam tabel
bun dev:turso # buka route `/users?key=learn`, jika data user tampil, koneksi turso berhasil.
```

Lihat di web turso, bukan proyek, lihat halaman `Edit Data` berisi tabel dan datanya.

### 7. **.env.**, **.env.development**
Buat env utama dan env terpisah untuk development:
- `.env` (Ada setingan google, asumsi monorepo-3 selesai)
```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
SESSION_SECRET=

FRONTEND_URL="http://localhost:5173"
TEST_URL="*"
API_KEY="learn"
```
Gunakan `API_KEY="learn"` untuk default, agar asdos mudah menilai. 
- `.env.development` (kode `process.env` otomatis mengambil file ini atau `.env`)
```bash
DATABASE_URL="file:./dev.db"
```

> 🚨 Jangan lupa tambahkan file env tersebut ke `.gitignore`

### 7. Test backend Build
Untuk memeriksa apakah koneksi turso backend & build (untuk vercel) berhasil:
```bash
bun run build # jalankan build ke output dist/
bun start # cek hasil build di dist/index.mjs. periksa path `/users`, dan debug-prisma (jika file ada maka berhasil) 
```

**Jika bun start Gagal**, karena error `Cannot file module './generated/prisma/client'`:
```bash
apps\backend>bun start
$ bun dist/index.mjs
error: Cannot find module './generated/prisma/client' from 'C:\repo\ppwl\apps\backend\dist\index.mjs'
```
Solusinya:
- hapus folder `apps/backend/node_modules/.prisma` (jika ada)
- hapus juga file `bun.lock`
- pastikan tidak ada `import { Prisma } from "@prisma/client"`, ganti path pakai yg `src/generated`
- jalankan `bun install` di root. lalu ikuti seperti ini:
```bash
>cd apps/backend

>\apps\backend>bun run build
$ prisma generate && tsdown
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.

✔ Generated Prisma Client (7.5.0) to .\src\generated\prisma in 133ms
# ...status success lainnya
✔ Build complete in 185ms

>\apps\backend>bun start
$ bun dist/index.mjs
🦊 Backend → http://localhost:3000
🦊 TEST_URL: *
🦊 DATABASE_URL: file:./dev.db
```
kondisi berhasil: `.\src\generated\prisma` berhasil di generate, `bun start` berhasil jalan.

---

## Apps/Frontend
Ada beberapa setingan di local yang perlu dibuat/ubah:
### 1. **.env**
```bash
VITE_BACKEND_URL="http://localhost:3000"
VITE_CHECK="Hai from env :>"
```
> 🚨 Jangan lupa tambahkan file env tersebut ke `.gitignore`

Ganti semua nilai static backend url yang ada, ganti dengan env variabel. Contoh:
```tsx
fetch("http://localhost:3000")
// jadi ⬇️
fetch(`${import.meta.env.VITE_BACKEND_URL}`)
// ---
fetch("http://localhost:3000/users")
// jadi ⬇️
fetch(`${import.meta.env.VITE_BACKEND_URL}/users`)

``` 

### 2. **vite.config.ts**
```ts
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite"
import path from "path"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 1. Muat env file berdasarkan 'mode' (development, production, dll.)
  // npm run dev -> development, npm run build -> production
  // process.cwd() adalah direktori akar proyek Anda
  // .env.[mode].local (Prioritas tertinggi)
  // .env.[mode]
  // .env.local
  // .env (Prioritas terendah)
  const env = loadEnv(mode, process.cwd(), '');

  const check = env.VITE_CHECK;
  if (!check) throw new Error("env is not detected");
  console.log("Berhasil env:", check)

  return {
    // Sekarang Anda bisa menggunakan variabel env di sini jika butuh, 
    // misalnya untuk mengganti port secara dinamis:
    build: {
      sourcemap: true
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') }
    },
    server: {
      port: Number(env.VITE_PORT) || 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_BACKEND_URL || "http://localhost:3000",
          changeOrigin: true
        },
      }
    }
  }
})
```
Keterangan:
  - `VITE_CHECK` untuk periksa apakah .env berhasil di load. 
  - `VITE_BACKEND_URL` menyesuaikan backend production di vercel.

### 3. **vercel.json**
Vercel memiliki kendala dalam membaca route uri untuk app react, jadi routes perlu di-konfigurasi eksplisit.
```json
{
  "routes": [
    { "handle": "filesystem" },
    { "src": "/.*", "dest": "/index.html" }
  ]
}
```

---

**🚀-- Jika sudah setup file di local, push ke repo github. --🚀**

## Vercel.com
Sekarang kita akan deploy backend & frontend ke vercel (2 proyek terpisah).
- Buat proyek di [vercel](https://vercel.com/), koneksi ke repo github.
- `Add New` -> `Project` -> `Import Git Repository`
- Backend (Setingan ini dapat dilihat di halaman **Build and Deployment**)
  - name: `monorepo-be`
  - **Framework**: `Elysia` (sisanya biarkan default, bakal di timpa sama settingan di `vercel.json`)
  - **Root Directory**: `apps/backend`, centang bagian `Include files outside the root directory...` & `Skip Deployments when there are no changes...`.
  - **Ignore Build Steps**:
    - **Behaviour**: `Only build if there are changes in a folder`
    - **Command**: `git diff HEAD^ HEAD --quiet -- ./` (pakai path `./`)
    - Tambahkan **Environment Variables**: `FRONTEND_URL` (skip, tunggu frontend selesai di deploy), `API_KEY`, `DATABASE_URL`, `DB_AUTH_TOKEN`, dan variabel lainnya untuk fitur google (terutama `GOOGLE_REDIRECT_URI` pakai url production backend ini).

- Frontend:
  - name: `monorepo`
  - **Framework**: `Vite`, lakukan bebrapa modifikasi **Framework Settings**:
    - **Build Command**: `bun run build`
    - **Output Directory**: `dist`
    - **Install Command**: `bun install --ignore-scripts`
  - **Root Directory**: `apps/frontend`, centang bagian `Include files outside the root directory...` & `Skip Deployments when there are no changes...`.
  - **Ignore Build Steps**:
    - **Behaviour**: `Only build if there are changes in a folder`
    - **Command**: `git diff HEAD^ HEAD --quiet -- ./`
  - **Environment Variables**: `VITE_BACKEND_URL` (dari production vercel), `VITE_CHECK` (supaya vite.config.ts run), port tidak perlu.

**🚨Pastikan** `VITE_BACKEND_URL` atau `FRONTEND_URL` tidak pakap postfix `/`, contoh: 
- Khawait web salah membaca `${FRONTEND_URL}/user` -> bukannya https://monorepo.vercel.app/user, malah jadi https://monorepo.vercel.app//user
   - Salah -> `https://monorepo.vercel.app/`
   - Benar -> `https://monorepo.vercel.app`

Info:
- Jika ada bagian config yang ter skip, deployment akan error. Tidak apa, periksa di `Settings` -> `Build and Deployment` atau `Deployment Variabels` untuk menyesuaikan settingan.
- Jika ada perubahan settingan build atau env di vercel, bisanya akan muncul opsi untuk re-deploy agar perubahan terbaca. Karena sudah setting Ignore Build Steps, jadi re deploy akan di tolak. Solusinya, lakukan perubahan kode di local, push ke github (otomatis trigger deploy).

## Google Console - Update redirect URI
1. Buka **APIs & Services → Credentials**
2. Buka credential yang sudah dibuat pada monorepo-3
3. Tambahkan url baru ke **Authorized redirect URIs**, tambhakan url backend production. 
```
https://<backend-sub-domain>.vercel.app/auth/callback
```

## Test 
Periksa kedua web production, 
- Backend - root path -> `https://<backend-sub-domain>.vercel.app?key=learn`
- Backend - users data -> `https://<backend-sub-domain>.vercel.app/users?key=learn`
- Frontend - root path (App2) -> `https://<frontend-sub-domain>.vercel.app`
- Frontend - classroom google -> `https://<frontend-sub-domain>.vercel.app/classroom`

jika sudah keduanya aman, lakukan perubahan file `apps/backend/src/index.ts`, beri pesan commit `test perubahan di backend`, lalu push. Perhatikan halaman `Deployments` kedua project. Jika hanya backend yang ter deploy berarti settingan **Ignore Build Steps** berhasil.   

---

## Final
Yang dikumpulkan:
- Link Repo
- Link URL Production (frontend & backend) yang punya postfix `*.vercel.app`
- ScreenShot (SS) Beberapa Konfigurasi Penting:
  - web Turso: Halaman `Edit Data`
  - Web Frontend production: Halama classroom yang menampilkan list kelas yang diambil dari API Google.
  - Vercel project: Halaman `Overview` yang meampilkan preview dan informasi status dari kedua proyek (Frontend & Backend).
  - Vercel project: Halaman `Deployments` yang berisi list commit deploy dari kedua project (Frontend & Backend).
  
SS nya full screen, terlihat waktu (supaya Asdos tau urutannya). Sisanya bisa Asdos cek sendiri.

Contoh web production:
  - [Frontend: monorepo-gamma-mauve.vercel.app](https://monorepo-gamma-mauve.vercel.app)
  - [Backend: mono-asdos-backend.vercel.app](https://mono-asdos-backend.vercel.app)

Lihat [gambar-gambar ini](https://drive.google.com/drive/folders/1pIejY7qOoMoTg3Kp8sZoWwENFYMxgsvd?usp=drive_link) sebagai referensi (prefix `[submit]` berarti contoh submisi).
