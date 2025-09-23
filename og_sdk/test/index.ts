import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

export const CONNECTION = new Connection("https://devnet.helius-rpc.com/?api-key=e2cc6225-fae1-4f90-a6b1-5684f49dec62")

//  5jE99iPnkE9LsyhrFuvQGmY31wkDeiHC2yNp87eKj4YB
export const PAYER_1 = Keypair.fromSecretKey(bs58.decode("3kqgYqxfUYwVza6h1KGiMF3Z9UvK77hnQBQGbCNo34iPSUVhhVU7aNWFbfKBNS3tDEwJcMhdhcQ8sVJm4DrWTXqu"))
//  DXcKtkqhbLxQSQ9efFxxJp6SwcDh2MKKzhzxd2giGdVr
export const RELAYER_KEY_1 = Keypair.fromSecretKey(bs58.decode("2dKakTLE6YKrR6g2eacQn8GANWZqbeozSWyTicmE5mazMVgo3LFWsrjJbcaYUHnnGpTL8gVYiJSNCQdKrx5JEQPJ"))

export const ammConfigIndex = 0

export const token0 = new PublicKey("6FrLVMJTvVhLV2JDhsjWAV5mMr3NPNmBpHNT6C5MM9LW")
export const token1 = new PublicKey("CTvxsbetFq4ZZmNTfba46Rre62e4tU5TU3fu4f1ySfQc")