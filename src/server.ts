import express from 'express'
import mongoose from 'mongoose';
import dotenv from 'dotenv'

dotenv.config()
const app = express();
const PORT = 3000
const MONGO_URL = process.env.MONGO_URL

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