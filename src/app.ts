import express from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { errorMiddleware, HttpError } from "./middlewares/error.middleware";
import { apiRateLimiter } from "./middlewares/rateLimit.middleware";
import { authRouter } from "./modules/auth/auth.routes";
import { docRouter } from "./modules/documents/doc.routes";
import { shareRouter } from "./modules/shares/share.routes";
import { verificationRouter } from "./modules/verification/verify.routes";
import { auditRouter } from "./modules/audit/audit.routes";
import { swaggerRouter } from "./config/swagger";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({ success: true, data: { status: "ok" } });
});

app.use("/api", apiRateLimiter);
app.use("/api", swaggerRouter);
app.use("/api/auth", authRouter);
app.use("/api/documents", docRouter);
app.use("/api", shareRouter);
app.use("/api", verificationRouter);
app.use("/api", auditRouter);
app.use((_request, _response, next) => {
  next(new HttpError(404, "NOT_FOUND", "Route was not found"));
});
app.use(errorMiddleware);
