@'
# Secure Doc Backend (`secure-doc-backend`)

REST API backend built with **Node.js**, **Express**, and **TypeScript** using **Prisma ORM** and **PostgreSQL** for secure document management, collaboration, file upload, and verification workflows.

## Tech Stack
- **Runtime & Framework:** Node.js, Express (`express`), TypeScript (`tsx`, `tsc`)
- **Database & ORM:** PostgreSQL, Prisma (`@prisma/client`, `prisma`)
- **Auth & Security:** JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `zod`
- **File Upload & Email:** `multer`, `nodemailer`
- **API Docs & Testing:** `swagger-ui-express`, Vitest (`vitest run`)
- **Container & Scripts:** Docker (`Dockerfile`, `.dockerignore`), `setup-backend.cmd`, `create-backend-files.ps1`

## Project Structure
```text
├── prisma/                 # Prisma schema, migrations, and seed script (`prisma/seed.ts`)
├── src/                    # Express application source (`src/server.ts`)
├── tests/                  # Vitest test suites:
│   ├── auth.test.ts
│   ├── collaboration.test.ts
│   ├── documents.test.ts
│   ├── upload.test.ts
│   └── verification.test.ts
├── .env.example            # Environment variable template
├── Dockerfile              # Docker build configuration
├── package.json            # Dependencies and npm scripts
└── tsconfig.json           # TypeScript configuration