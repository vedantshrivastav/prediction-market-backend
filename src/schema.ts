
import mongoose from "mongoose";

// ---------------- ENUMS ----------------

export enum MarketOutcome {
  YES = "YES",
  NO = "NO",
}

export enum TradeType {
  BUY = "buy",
  SELL = "sell",
}

export enum TransactionType {
  DEPOSIT = "deposit",
  WITHDRAW = "withdraw",
  SPLIT = "split",
  MERGE = "merge",
  TRADE = "trade",
  REDEEM = "redeem",
}

// ---------------- USERS ----------------

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
    usdBalance: { type: Number, default: 0, min: 0 },
    lockedUsdBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

export const UserModel = mongoose.model("User", UserSchema, "users");



const MarketSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: { type: String, required: true },
    totalIssued: { type: Number, default: 0, min: 0 },
    resolution: {
      type: String,
      enum: [...Object.values(MarketOutcome), null],
      default: null,
    },
  },
  { timestamps: true }
);

export const MarketModel = mongoose.model(
  "Market",
  MarketSchema,
  "markets"
);


const OrderBookSchema = new mongoose.Schema(
  {
    marketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Market",
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(MarketOutcome),
      required: true,
    },
  },
  { timestamps: true }
);

OrderBookSchema.index({ marketId: 1, type: 1 }, { unique: true });

export const OrderBookModel = mongoose.model(
  "OrderBook",
  OrderBookSchema,
  "orderbooks"
);



const StockBalanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    marketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Market",
      required: true,
    },
    type: {
      type: String,
      enum: Object.values(MarketOutcome),
      required: true,
    },
    qty: { type: Number, default: 0, min: 0 },
    locked: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);


StockBalanceSchema.index(
  { userId: 1, marketId: 1, type: 1 },
  { unique: true }
);

export const StockBalanceModel = mongoose.model(
  "StockBalance",
  StockBalanceSchema,
  "stockbalances"
);



const BidsSchema = new mongoose.Schema(
  {
    orderBookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderBook",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: { type: Number, required: true, min: 0, max: 1 },
    qty: { type: Number, required: true, min: 0 },
    stockType: {
      type: String,
      enum: Object.values(MarketOutcome),
      required: true,
    },
  },
  { timestamps: true }
);

BidsSchema.index({ orderBookId: 1, price: -1 });

export const BidsModel = mongoose.model("Bid", BidsSchema, "bids");


const AsksSchema = new mongoose.Schema(
  {
    orderBookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderBook",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: { type: Number, required: true, min: 0, max: 1 },
    qty: { type: Number, required: true, min: 0 },
    stockType: {
      type: String,
      enum: Object.values(MarketOutcome),
      required: true,
    },
  },
  { timestamps: true }
);

AsksSchema.index({ orderBookId: 1, price: 1 });

export const AsksModel = mongoose.model("Ask", AsksSchema, "asks");


const FillsSchema = new mongoose.Schema(
  {
    orderBookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderBook",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: { type: Number, required: true, min: 0, max: 1 },
    qty: { type: Number, required: true, min: 0 },
    type: {
      type: String,
      enum: Object.values(TradeType),
      required: true,
    },
    isMaker: { type: Boolean, required: true },
  },
  { timestamps: true }
);

export const FillsModel = mongoose.model("Fill", FillsSchema, "fills");



const TxLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    marketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Market",
    },
    type: {
      type: String,
      enum: Object.values(TransactionType),
      required: true,
    },
    amount: { type: Number, required: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const TxLogModel = mongoose.model(
  "TxLog",
  TxLogSchema,
  "tx_logs"
);
