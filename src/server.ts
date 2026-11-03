import express from 'express'
import mongoose from 'mongoose';
import dotenv from 'dotenv'
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken'
import { onRampSchema, UserSignInSchema, UserSignUpSchema } from './zodSchema.js';
import { UserModel } from './schema.js';

dotenv.config()
const app = express();
const PORT = 3000
const MONGO_URL = process.env.MONGO_URL


//auth endpoints

app.post("/signup", async (req, res) => {
  try {
    const { success, data } = UserSignUpSchema.safeParse(req.body);

    if (!success) {
      return res.status(400).json({ message: "Invalid user details" });
    }

    const userExists = await UserModel.findOne({
      email: data.email,
    });

    if (userExists) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);

    const newUser = await UserModel.create({
      email: data.email,
      password: hashedPassword,
    });

    return res.status(201).json({
      message: "User created successfully",
      user: newUser._id,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

app.post("/signin", async (req, res) => {
  try {
    const { success, data } = UserSignInSchema.safeParse(req.body);

    if (!success) {
      return res.status(400).json({ message: "Invalid user details" });
    }

    const user = await UserModel.findOne({
      email: data.email,
    });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(
      data.password,
      user.password
    );

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Signin successful",
      token,
      user: user._id,
    });
  } catch (error) {
    return res.status(500).json({
      message: "Internal server error",
    });
  }
});

// onramp  
app.post('/onramp',async(req,res) => {
  const{success,data} = onRampSchema.safeParse(req.body)
  if(!success){
    return res.status(409).json({message : "Enter valid amount"})
  }
   // update the user collection 
})

async function main(){
    try{
        await mongoose.connect(MONGO_URL!)
        app.listen(PORT,() => {
            console.log(`server running on PORT ${PORT} and mongo db connected`)
        })
    }
    catch(e){
        console.log("mongo db connection failed",e)
    }
}

main()