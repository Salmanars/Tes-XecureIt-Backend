$ErrorActionPreference = "Stop"

Write-Host "Menyiapkan struktur folder dan file awal backend..."

$folders = @(
  "prisma",
  "src",
  "src\config",
  "src\middlewares",
  "src\modules",
  "src\modules\auth",
  "src\modules\documents",
  "src\modules\shares",
  "src\modules\verification",
  "src\modules\audit",
  "src\realtime",
  "src\utils",
  "storage\private",
  "tests"
)

foreach ($f in $folders) {
  if (-not (Test-Path -Path $f)) {
    New-Item -ItemType Directory -Path $f -Force | Out-Null
    Write-Host "[OK] Folder dibuat: $f"
  } else {
    Write-Host "[SKIP] Folder sudah ada: $f"
  }
}

$files = @{
  "Dockerfile" = @'
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
'@
  "package.json" = @'
{
  "name": "secure-doc-backend",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "vitest run"
  }
}
'@
  "tsconfig.json" = @'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
'@
  ".env.example" = @'
PORT=4000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/securedoc
JWT_SECRET=change-this-secret-in-production
STORAGE_DIR=./storage/private
CORS_ORIGIN=http://localhost:3000
'@
  "prisma\schema.prisma" = "// Model: users, documents, document_shares, document_versions, audit_trail, hash_records"
  "src\config\env.ts" = "export const env = { PORT: Number(process.env.PORT || 4000), JWT_SECRET: process.env.JWT_SECRET || 'dev-secret' };"
  "src\config\swagger.ts" = "// OpenAPI / Swagger config"
  "src\app.ts" = "// Express app setup"
  "src\server.ts" = "// HTTP & SSE/WebSocket server entry point"
  "src\middlewares\auth.middleware.ts" = "// JWT auth middleware"
  "src\middlewares\rbac.middleware.ts" = "// RBAC middleware (owner, editor, viewer)"
  "src\middlewares\upload.middleware.ts" = "// Upload PDF/DOCX/TXT/CSV, max 10MB, private storage, simulated virus scan"
  "src\middlewares\rateLimit.middleware.ts" = "// Rate limit middleware"
  "src\middlewares\error.middleware.ts" = "// Error handler middleware"
  "src\modules\auth\auth.routes.ts" = "// Auth routes"
  "src\modules\auth\auth.controller.ts" = "// Auth controller"
  "src\modules\auth\auth.service.ts" = "// Auth service"
  "src\modules\auth\auth.schema.ts" = "// Auth schema"
  "src\modules\documents\doc.routes.ts" = "// Document & versions routes"
  "src\modules\documents\doc.controller.ts" = "// Document controller"
  "src\modules\documents\doc.service.ts" = "// Document service"
  "src\modules\documents\doc.schema.ts" = "// Document schema"
  "src\modules\shares\share.routes.ts" = "// Share & invite routes"
  "src\modules\shares\share.controller.ts" = "// Share controller"
  "src\modules\shares\share.service.ts" = "// Share service"
  "src\modules\verification\verify.routes.ts" = "// SHA-256 verification routes"
  "src\modules\verification\verify.controller.ts" = "// Verification controller"
  "src\modules\verification\verify.service.ts" = "// Verification service"
  "src\modules\audit\audit.routes.ts" = "// Audit trail routes"
  "src\modules\audit\audit.controller.ts" = "// Audit controller"
  "src\modules\audit\audit.service.ts" = "// Immutable audit trail service"
  "src\realtime\collaboration.gateway.ts" = "// SSE / WebSocket real-time collaboration gateway"
  "src\utils\hash.util.ts" = "// SHA-256 generator & verifier"
  "src\utils\scanner.util.ts" = "// Simulated virus scan utility"
  "tests\auth.test.ts" = "// Auth tests"
  "tests\documents.test.ts" = "// Document & RBAC tests"
  "tests\verification.test.ts" = "// Hash verification & tampering tests"
}

foreach ($entry in $files.GetEnumerator()) {
  $path = $entry.Key
  if (-not (Test-Path -Path $path)) {
    Set-Content -Path $path -Value $entry.Value -Encoding UTF8
    Write-Host "[OK] File dibuat: $path"
  } else {
    Write-Host "[SKIP] File sudah ada: $path"
  }
}

Write-Host ""
Write-Host "Selesai. Struktur awal backend siap."