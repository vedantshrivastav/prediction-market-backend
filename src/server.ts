import express from 'express'
import mongoose from 'mongoose';
import dotenv from 'dotenv'
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken'
import { MarketSchema, onRampSchema, ResolveMarketSchema, UserSignInSchema, UserSignUpSchema } from './zodSchema.js';
import { MarketModel, MarketOutcome, OrderBookModel, StockBalanceModel, TxLogModel, UserModel } from './schema.js';
import AuthMiddleware from './middleware/authmiddleware.js';
import { runInNewContext } from 'node:vm';
import RoleMiddleware from './middleware/rolemiddleware.js';

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
app.patch('/onramp',AuthMiddleware,async(req,res) => {
  const{success,data} = onRampSchema.safeParse(req.body)
  if(!success){
    return res.status(409).json({message : "Enter valid amount"})
  }
   const userId = req.userId
   // get the existing user 
   const existing_user =  await UserModel.findOne({
      _id : userId
   })
    if (!existing_user) {
    return res.status(404).json({ message: "User not found" });
  }
  const updatedUser = await UserModel.findByIdAndUpdate(
    userId,
    { $inc : {usdBalance : data.amount}},
    {new : true}    
  )
   return res.status(200).json({
    message: "Balance updated successfully",
    usdBalance: updatedUser?.usdBalance,
  });
   // how to update after fetching the user 
})

// market endpoint
app.post("/market", AuthMiddleware, async (req, res) => {
  try {
    const { success, data } = MarketSchema.safeParse(req.body);

    if (!success) {
      return res.status(400).json({ message: "Invalid market details" });
    }

    const userId = req.userId;

    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User does not exist" });
    }

    const market = await MarketModel.create({
      creatorId: user._id,
      title: data.title,
      totalIssued: data.totalIssued,
      resolution: null,
    });

    await OrderBookModel.insertMany([
      { marketId: market._id, type: MarketOutcome.YES },
      { marketId: market._id, type: MarketOutcome.NO },
    ]);

    return res.status(201).json({
      message: "Market created successfully",
      market,
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error" });
  }
})
//market resolve endpoint

app.patch(
  "/market/:marketId/resolve",
  AuthMiddleware,
  RoleMiddleware,
  async (req, res) => {
    const session = await mongoose.startSession();

    try {
      const { success, data } = ResolveMarketSchema.safeParse(req.body);

      if (!success) {
        return res.status(400).json({ message: "Invalid resolution" });
      }

      const marketId = req.params.marketId;

      if (
        !marketId ||
        typeof marketId !== "string" ||
        !mongoose.Types.ObjectId.isValid(marketId)
      ) {
        return res.status(400).json({ message: "Invalid market ID" });
      }

      let payoutCount = 0;
      let totalPayout = 0;

      await session.withTransaction(async () => {
        const market = await MarketModel.findOneAndUpdate(
          { _id: marketId, resolution: null },
          { $set: { resolution: data.resolution } },
          { new: true, session }
        );

        if (!market) {
          throw new Error("MARKET_NOT_FOUND_OR_RESOLVED");
        }

        const lockedShares = await StockBalanceModel.exists({
          marketId,
          locked: { $gt: 0 },
        }).session(session);

        if (lockedShares) {
          throw new Error("OPEN_ORDERS_EXIST");
        }

        const winningBalances = await StockBalanceModel.find({
          marketId,
          type: data.resolution,
          qty: { $gt: 0 },
        }).session(session);

        const userUpdates = winningBalances.map((balance) => ({
          updateOne: {
            filter: { _id: balance.userId },
            update: {
              $inc: { usdBalance: balance.qty },
            },
          },
        }));

        if (userUpdates.length > 0) {
          await UserModel.bulkWrite(userUpdates, { session });
        }

        const logs = winningBalances.map((balance) => ({
          userId: balance.userId,
          marketId: market._id,
          type: "redeem",
          amount: balance.qty,
          metadata: {
            resolution: data.resolution,
            sharesRedeemed: balance.qty,
          },
        }));

        if (logs.length > 0) {
          await TxLogModel.insertMany(logs, { session });
        }

        await StockBalanceModel.updateMany(
          { marketId },
          {
            $set: {
              qty: 0,
              locked: 0,
            },
          },
          { session }
        );

        payoutCount = winningBalances.length;
        totalPayout = winningBalances.reduce(
          (total, balance) => total + balance.qty,
          0
        );
      });

      return res.status(200).json({
        message: "Market resolved successfully",
        resolution: data.resolution,
        winners: payoutCount,
        totalPayout,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "MARKET_NOT_FOUND_OR_RESOLVED") {
          return res.status(404).json({
            message: "Market not found or already resolved",
          });
        }

        if (error.message === "OPEN_ORDERS_EXIST") {
          return res.status(409).json({
            message: "Cancel open orders before resolving the market",
          });
        }
      }

      return res.status(500).json({
        message: "Internal server error",
      });
    } finally {
      await session.endSession();
    }
  }
);


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