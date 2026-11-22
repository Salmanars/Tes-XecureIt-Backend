import { Router } from "express";
import { authenticate } from "../../middlewares/auth.middleware";
import { authRateLimiter } from "../../middlewares/rateLimit.middleware";
import {
  currentUserController,
  changePasswordController,
  loginController,
  registerController,
  updateProfileController,
} from "./auth.controller";

export const authRouter = Router();

authRouter.post("/register", authRateLimiter, registerController);
authRouter.post("/login", authRateLimiter, loginController);
authRouter.get("/me", authenticate, currentUserController);
authRouter.patch("/me", authenticate, updateProfileController);
authRouter.patch("/password", authRateLimiter, authenticate, changePasswordController);
