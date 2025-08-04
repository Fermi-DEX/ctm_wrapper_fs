#!/usr/bin/env ts-node
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

async function checkBalances() {
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Check SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log('SOL Balance:', solBalance / 1e9, 'SOL');
  
  // Load token info
  const tokenInfoPath = path.join(__dirname, 'devnet-tokens.json');
  if (fs.existsSync(tokenInfoPath)) {
    const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf8'));
    
    // Check USDC balance
    try {
      const usdcAta = await getAssociatedTokenAddress(
        new PublicKey(tokenInfo.usdcMint),
        wallet.publicKey
      );
      const usdcAccount = await getAccount(connection, usdcAta);
      console.log('USDC Balance:', Number(usdcAccount.amount) / 1e6, 'USDC');
    } catch (e) {
      console.log('USDC Account not found');
    }
    
    // Check WSOL balance
    try {
      const wsolAta = await getAssociatedTokenAddress(
        new PublicKey(tokenInfo.wsolMint),
        wallet.publicKey
      );
      const wsolAccount = await getAccount(connection, wsolAta);
      console.log('WSOL Balance:', Number(wsolAccount.amount) / 1e9, 'WSOL');
    } catch (e) {
      console.log('WSOL Account not found');
    }
  }
}

checkBalances().catch(console.error);