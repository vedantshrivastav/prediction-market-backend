import express from 'express'
import mongoose from 'mongoose';
import dotenv from 'dotenv'
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken'
import { MarketSchema, MergeSchema, onRampSchema, ResolveMarketSchema, SplitSchema, UserSignInSchema, UserSignUpSchema } from './zodSchema.js';
import { FillsModel, MarketModel, MarketOutcome, OrderBookModel, StockBalanceModel, TransactionType, TxLogModel, UserModel } from './schema.js';
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

app.post('/split/:marketId', AuthMiddleware, async (req, res) => {
  const { success, data } = SplitSchema.safeParse(req.body);
  const marketId = req.params.marketId;
  const userId = req.userId;

  if (!success) {
    return res.status(400).json({ message: "Invalid input amount" });
  }

  if (
        !marketId ||
        typeof marketId !== "string" ||
        !mongoose.Types.ObjectId.isValid(marketId)
      ) {
        return res.status(400).json({ message: "Invalid market ID" });
      }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {

      // 1. Check market
      const market = await MarketModel.findOne({
        _id: marketId,
        status: "ACTIVE"
      }).session(session);

      if (!market) {
        throw Object.assign(new Error("Market not found or inactive"), {
          statusCode: 404
        });
      }

      // 2. Deduct USD (atomic balance check)
      const user = await UserModel.findOneAndUpdate(
        {
          _id: userId,
          usdBalance: { $gte: data.amount }
        },
        {
          $inc: { usdBalance: -data.amount }
        },
        { new: true, session }
      );

      if (!user) {
        throw Object.assign(new Error("Insufficient balance"), {
          statusCode: 409
        });
      }

      // 3. Add YES shares
      await StockBalanceModel.updateOne(
        { userId, marketId, type: MarketOutcome.YES },
        {
          $inc: { qty: data.amount },
          $setOnInsert: { locked: 0 }
        },
        { upsert: true, session }
      );

      // 4. Add NO shares
      await StockBalanceModel.updateOne(
        { userId, marketId, type: MarketOutcome.NO },
        {
          $inc: { qty: data.amount },
          $setOnInsert: { locked: 0 }
        },
        { upsert: true, session }
      );

      // 5. Record transaction
      await TxLogModel.create([{
        userId,
        marketId,
        type: TransactionType.SPLIT,
        amount: data.amount,
        metadata: {
          yesShares: data.amount,
          noShares: data.amount
        }
      }], { session });

    });

    return res.json({ message: "Split successful" });

  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      message: err.message || "Split failed"
    });
  } finally {
    await session.endSession();
  }
});

app.post('/merge/:marketId', AuthMiddleware, async (req, res) => {
  const { success, data } = MergeSchema.safeParse(req.body);
  const marketId = req.params.marketId;
  const userId = req.userId;

  if (!success) {
    return res.status(400).json({ message: "Invalid input amount" });
  }

  if (
        !marketId ||
        typeof marketId !== "string" ||
        !mongoose.Types.ObjectId.isValid(marketId)
      ) {
        return res.status(400).json({ message: "Invalid market ID" });
      }

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {

      // 1. Check market (cannot merge after resolution)
      const market = await MarketModel.findOne({
        _id: marketId,
        status: { $ne: "RESOLVED" }
      }).session(session);

      if (!market) {
        throw Object.assign(new Error("Market not found or resolved"), {
          statusCode: 404
        });
      }

      // 2. Burn YES shares
      const yesShares = await StockBalanceModel.updateOne(
        {
          userId,
          marketId,
          type: MarketOutcome.YES,
          $expr: {
            $gte: [
              { $subtract: ["$qty", { $ifNull: ["$locked", 0] }] },
              data.amount
            ]
          }
        },
        {
          $inc: { qty: -data.amount }
        },
        { session }
      );

      if (yesShares.modifiedCount !== 1) {
        throw Object.assign(new Error("Insufficient available YES shares"), {
          statusCode: 409
        });
      }

      // 3. Burn NO shares
      const noShares = await StockBalanceModel.updateOne(
        {
          userId,
          marketId,
          type: MarketOutcome.NO,
          $expr: {
            $gte: [
              { $subtract: ["$qty", { $ifNull: ["$locked", 0] }] },
              data.amount
            ]
          }
        },
        {
          $inc: { qty: -data.amount }
        },
        { session }
      );

      if (noShares.modifiedCount !== 1) {
        throw Object.assign(new Error("Insufficient available NO shares"), {
          statusCode: 409
        });
      }

      // 4. Credit USD
      await UserModel.updateOne(
        { _id: userId },
        {
          $inc: { usdBalance: data.amount }
        },
        { session }
      );

      // 5. Record transaction
      await TxLogModel.create([{
        userId,
        marketId,
        type: TransactionType.MERGE,
        amount: data.amount,
        metadata: {
          yesShares: data.amount,
          noShares: data.amount
        }
      }], { session });

    });

    return res.json({ message: "Merge successful" });

  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      message: err.message || "Merge failed"
    });
  } finally {
    await session.endSession();
  }
});

import { z } from "zod";
import mongoose from "mongoose";

const CreateOrderSchema = z.object({
  marketId: z.string(),
  stockType: z.enum(["YES", "NO"]),
  tradeType: z.enum(["buy", "sell"]),
  price: z.number().gt(0).lte(1),
  qty: z.number().int().positive(),
});

app.post("/createOrder", AuthMiddleware, async (req, res) => {
  const { success, data } = CreateOrderSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: "Invalid order input" });
  }

  const userId = req.userId;

  if (!mongoose.Types.ObjectId.isValid(data.marketId)) {
    return res.status(400).json({ message: "Invalid market ID" });
  }

  const session = await mongoose.startSession();

  try {
    let filledQty = 0;

    await session.withTransaction(async () => {
      const { marketId, stockType, tradeType, price, qty } = data;

      // 1. Check market
      const market = await MarketModel.findOne({
        _id: marketId,
        resolution: null,
      }).session(session);

      if (!market) {
        throw Object.assign(new Error("Market not found or resolved"), {
          statusCode: 404,
        });
      }

      // 2. Find or create orderbook
      const orderBook = await OrderBookModel.findOneAndUpdate(
        { marketId, type: stockType },
        { $setOnInsert: { marketId, type: stockType } },
        { upsert: true, new: true, session }
      );

      // 3. Lock user's money or shares
      if (tradeType === "buy") {
        const requiredUsd = price * qty;

        const locked = await UserModel.updateOne(
          {
            _id: userId,
            usdBalance: { $gte: requiredUsd },
          },
          {
            $inc: {
              usdBalance: -requiredUsd,
              lockedUsdBalance: requiredUsd,
            },
          },
          { session }
        );

        if (locked.modifiedCount !== 1) {
          throw Object.assign(new Error("Insufficient USD balance"), {
            statusCode: 409,
          });
        }
      } else {
        const locked = await StockBalanceModel.updateOne(
          {
            userId,
            marketId,
            type: stockType,
            $expr: {
              $gte: [
                { $subtract: ["$qty", "$locked"] },
                qty,
              ],
            },
          },
          {
            $inc: { locked: qty },
          },
          { session }
        );

        if (locked.modifiedCount !== 1) {
          throw Object.assign(new Error("Insufficient available shares"), {
            statusCode: 409,
          });
        }
      }

      // 4. Find opposite orders
      const oppositeOrders =
        tradeType === "buy"
          ? await AsksModel.find({
              orderBookId: orderBook._id,
              stockType,
              price: { $lte: price },
              qty: { $gt: 0 },
              userId: { $ne: userId },
            })
              .sort({ price: 1, createdAt: 1 })
              .session(session)
          : await BidsModel.find({
              orderBookId: orderBook._id,
              stockType,
              price: { $gte: price },
              qty: { $gt: 0 },
              userId: { $ne: userId },
            })
              .sort({ price: -1, createdAt: 1 })
              .session(session);

      let remainingQty = qty;

      // 5. Match orders
      for (const makerOrder of oppositeOrders) {
        if (remainingQty <= 0) break;

        const matchedQty = Math.min(
          remainingQty,
          makerOrder.qty
        );

        const executionPrice = makerOrder.price;
        const tradeValue = matchedQty * executionPrice;

        const makerUserId = makerOrder.userId;

        // Reduce maker's order quantity
        const OrderModel =
          tradeType === "buy" ? AsksModel : BidsModel;

        const updatedOrder = await OrderModel.updateOne(
          {
            _id: makerOrder._id,
            qty: { $gte: matchedQty },
          },
          {
            $inc: { qty: -matchedQty },
          },
          { session }
        );

        if (updatedOrder.modifiedCount !== 1) {
          throw new Error("Order changed during matching");
        }

        // Determine buyer and seller
        const buyerId =
          tradeType === "buy" ? userId : makerUserId;

        const sellerId =
          tradeType === "sell" ? userId : makerUserId;

        // 6. Settle balances
        if (tradeType === "buy") {
          // Incoming user is buyer.
          // Release reserved limit price and refund price difference.
          await UserModel.updateOne(
            { _id: userId },
            {
              $inc: {
                lockedUsdBalance: -(price * matchedQty),
                usdBalance: (price - executionPrice) * matchedQty,
              },
            },
            { session }
          );

          // Maker is seller. Release locked shares.
          await StockBalanceModel.updateOne(
            {
              userId: makerUserId,
              marketId,
              type: stockType,
              locked: { $gte: matchedQty },
              qty: { $gte: matchedQty },
            },
            {
              $inc: {
                qty: -matchedQty,
                locked: -matchedQty,
              },
            },
            { session }
          );

        } else {
          // Incoming user is seller.
          // Consume their locked shares.
          await StockBalanceModel.updateOne(
            {
              userId,
              marketId,
              type: stockType,
              locked: { $gte: matchedQty },
              qty: { $gte: matchedQty },
            },
            {
              $inc: {
                qty: -matchedQty,
                locked: -matchedQty,
              },
            },
            { session }
          );

          // Maker is buyer. Release their reserved USD.
          await UserModel.updateOne(
            {
              _id: makerUserId,
              lockedUsdBalance: { $gte: tradeValue },
            },
            {
              $inc: {
                lockedUsdBalance: -tradeValue,
              },
            },
            { session }
          );
        }

        // Credit seller with execution value
        await UserModel.updateOne(
          { _id: sellerId },
          {
            $inc: { usdBalance: tradeValue },
          },
          { session }
        );

        // Credit buyer with shares
        await StockBalanceModel.updateOne(
          {
            userId: buyerId,
            marketId,
            type: stockType,
          },
          {
            $inc: { qty: matchedQty },
            $setOnInsert: { locked: 0 },
          },
          { upsert: true, session }
        );

        // 7. Create two fill records
        await FillsModel.create(
          [
            {
              orderBookId: orderBook._id,
              userId: buyerId,
              price: executionPrice,
              qty: matchedQty,
              type: "buy",
              isMaker: tradeType === "sell",
            },
            {
              orderBookId: orderBook._id,
              userId: sellerId,
              price: executionPrice,
              qty: matchedQty,
              type: "sell",
              isMaker: tradeType === "buy",
            },
          ],
          { session }
        );

        // 8. Transaction logs
        await TxLogModel.create(
          [
            {
              userId: buyerId,
              marketId,
              type: TransactionType.TRADE,
              amount: tradeValue,
              metadata: {
                side: "buy",
                price: executionPrice,
                qty: matchedQty,
              },
            },
            {
              userId: sellerId,
              marketId,
              type: TransactionType.TRADE,
              amount: tradeValue,
              metadata: {
                side: "sell",
                price: executionPrice,
                qty: matchedQty,
              },
            },
          ],
          { session }
        );

        remainingQty -= matchedQty;
        filledQty += matchedQty;
      }

      // 9. Put remaining quantity into orderbook
      if (remainingQty > 0) {
        const OrderModel =
          tradeType === "buy" ? BidsModel : AsksModel;

        await OrderModel.create(
          [
            {
              orderBookId: orderBook._id,
              userId,
              price,
              qty: remainingQty,
              stockType,
            },
          ],
          { session }
        );
      }
    });

    return res.status(201).json({
      message: "Order processed successfully",
      filledQty,
      remainingQty: data.qty - filledQty,
    });

  } catch (err: any) {
    return res.status(err.statusCode || 500).json({
      message: err.message || "Order processing failed",
    });
  } finally {
    await session.endSession();
  }
});

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