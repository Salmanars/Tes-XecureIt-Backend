$readme = @'
# Tes XecureIt - Backend

Backend service (`secure-doc-backend`) built with **Node.js**, **Express**, and **TypeScript** using **Prisma ORM** and **PostgreSQL** for secure document management, collaboration, file upload, and verification workflows.

## Tech Stack
- **Runtime & Framework:** Node.js, Express (`^4.21.2`), TypeScript (`^5.7.2`), `tsx` (`^4.19.2`), `tsc`[cite: 6]
- **Database & ORM:** PostgreSQL, Prisma (`@prisma/client` & `prisma` `^6.19.0`)[cite: 6]
- **Auth & Security:** `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `zod`[cite: 6]
- **File Upload & Email:** `multer`, `nodemailer`[cite: 6]
- **API Docs & Testing:** `swagger-ui-express`, Vitest (`vitest run`)[cite: 6]
- **Container & Setup:** Docker (`Dockerfile`, `.dockerignore`), `setup-backend.cmd`, `create-backend-files.ps1`[cite: 6]

## Project Structure
```text
├── tests/                  # Vitest test suites (`auth.test.ts`, `collaboration.test.ts`, `documents.test.ts`, `upload.test.ts`, `verification.test.ts`)
├── .dockerignore           # Docker build exclusions
├── .env.example            # Environment variable template
├── .gitignore              # Git exclusions
├── Dockerfile              # Container build configuration
├── create-backend-files.ps1# PowerShell scaffolding/helper script
├── package.json            # Dependencies and npm scripts
├── package-lock.json       # Locked dependency tree
├── setup-backend.cmd       # Windows setup script
└── tsconfig.json           # TypeScript compiler configuration
```
[cite: 6]

## Environment Variables
Copy `.env.example` to `.env` before running the backend:

```powershell
Copy-Item .env.example .env
```

Key variables in `.env.example`:
- `PORT` (default: `4000`)
- `NODE_ENV` (`development` or `production`)
- `API_RATE_LIMIT` / `AUTH_RATE_LIMIT` (optional overrides; dev defaults: `2000` and `50`, prod defaults: `300` and `10`)
- `DATABASE_URL` (`postgresql://postgres:postgres@localhost:5432/securedoc?schema=public` — use DB service hostname inside Docker)
- `JWT_SECRET` (strong random secret for production)
- `STORAGE_DIR` (`./storage/private`)
- `CORS_ORIGIN` (`http://localhost:3000`)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `APP_FRONTEND_URL` (`http://localhost:3000`)

## Getting Started
```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Build and run compiled output:
```bash
npm run build
npm start
```

Run tests:
```bash
npm test
```

Run with Docker:
```bash
docker build -t tes-xecureit-backend .
docker run -p 4000:4000 --env-file .env tes-xecureit-backend
```
'@

Set-Content -Path .\README.md -Value $readme -Encoding utf8