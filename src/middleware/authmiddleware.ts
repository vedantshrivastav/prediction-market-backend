import type { Request,Response,NextFunction } from "express";
import jwt from 'jsonwebtoken'
export default async function AuthMiddleware(req : Request,res:Response,next : NextFunction){
     const authorization = req.headers['authorization'];
     // extract token from auth, verift jwt , attach userId to request 
    const token = authorization && authorization.split(' ')[1]; 
    if(!token){
       return res.status(401).json({message : "Access denied invalid token"})
    }
    const decoded =  await jwt.verify(token,process.env.JWT_SECRET!)
    const { userId } = decoded as { userId: string };
    req.userId = userId
    next()
} 