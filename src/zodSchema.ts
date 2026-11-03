import { z } from "zod";

export const UserSignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const UserSignUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const onRampSchema = z.object({
        amount : z.number().positive()
    })