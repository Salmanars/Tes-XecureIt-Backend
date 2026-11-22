import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";

const rateLimitResponse = {
  success: false,
  error: {
    code: "RATE_LIMITED",
    message: "Too many requests. Please try again later.",
  },
};

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.API_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json(rateLimitResponse);
  },
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json(rateLimitResponse);
  },
});
