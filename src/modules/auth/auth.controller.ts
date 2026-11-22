import type { RequestHandler } from "express";
import { HttpError } from "../../middlewares/error.middleware";
import {
  changeUserPassword,
  getCurrentUser,
  login,
  register,
  updateUserProfile,
} from "./auth.service";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from "./auth.schema";

export const registerController: RequestHandler = async (request, response, next) => {
  try {
    const result = await register(registerSchema.parse(request.body));
    response.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const loginController: RequestHandler = async (request, response, next) => {
  try {
    const result = await login(loginSchema.parse(request.body));
    response.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const currentUserController: RequestHandler = async (request, response, next) => {
  try {
    if (!request.user) {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const user = await getCurrentUser(request.user.id);
    response.status(200).json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
};

export const updateProfileController: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    if (!request.user) {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const result = await updateUserProfile(
      request.user.id,
      updateProfileSchema.parse(request.body),
    );
    response.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const changePasswordController: RequestHandler = async (
  request,
  response,
  next,
) => {
  try {
    if (!request.user) {
      throw new HttpError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const result = await changeUserPassword(
      request.user.id,
      changePasswordSchema.parse(request.body),
    );
    response.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
