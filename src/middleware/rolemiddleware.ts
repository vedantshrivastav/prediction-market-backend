import type {Request,Response, NextFunction } from "express";
import { UserModel } from "../schema.js";


export default async function RoleMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const user = await UserModel.findById(req.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.role !== "admin") {
      return res.status(403).json({ message: "User is not admin" });
    }

    next();
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
}