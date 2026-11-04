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
export const MarketSchema = z.object({
  title: z.string().min(1),
  totalIssued: z.number().nonnegative(),
});

export const ResolveMarketSchema = z.object({
  resolution: z.enum(["YES", "NO"]),
});