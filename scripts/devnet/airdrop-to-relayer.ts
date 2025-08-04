#!/usr/bin/env ts-node
import { Connection, PublicKey, Keypair, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, mintTo, getAssociatedTokenAddressSync, createAssociatedTokenAccount, TOKEN_PROGRAM_ID, getAccount, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Relayer wallet address
const RELAYER_ADDRESS = new PublicKey('785Bgkii28SRfWSShrYZ6wmGZRgVBpHwd38WAbjU6B4Z');

async function airdropToRelayer() {
  console.log('🚀 Airdropping tokens to relayer on Devnet\n');
  
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Source wallet:', wallet.publicKey.toBase58());
  console.log('Relayer wallet:', RELAYER_ADDRESS.toBase58());
  
  // Load token info
  const tokenInfoPath = path.join(__dirname, 'devnet-tokens.json');
  if (!fs.existsSync(tokenInfoPath)) {
    console.error('❌ Token info not found. Run create-tokens-devnet.ts first.');
    process.exit(1);
  }
  
  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf8'));
  const usdcMint = new PublicKey(tokenInfo.usdcMint);
  const wsolMint = new PublicKey(tokenInfo.wsolMint);
  
  console.log('\n📋 Token mints:');
  console.log('USDC2:', usdcMint.toBase58());
  console.log('WSOL2:', wsolMint.toBase58());
  
  try {
    // Get or create token accounts for relayer
    console.log('\n📋 Setting up relayer token accounts...');
    
    const relayerUsdcAta = getAssociatedTokenAddressSync(usdcMint, RELAYER_ADDRESS);
    const relayerWsolAta = getAssociatedTokenAddressSync(wsolMint, RELAYER_ADDRESS);
    
    // Check if accounts exist
    const transaction = new Transaction();
    
    const usdcAccountInfo = await connection.getAccountInfo(relayerUsdcAta);
    if (!usdcAccountInfo) {
      console.log('Creating USDC2 ATA for relayer...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          relayerUsdcAta,
          RELAYER_ADDRESS,
          usdcMint
        )
      );
    }
    
    const wsolAccountInfo = await connection.getAccountInfo(relayerWsolAta);
    if (!wsolAccountInfo) {
      console.log('Creating WSOL2 ATA for relayer...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          relayerWsolAta,
          RELAYER_ADDRESS,
          wsolMint
        )
      );
    }
    
    if (transaction.instructions.length > 0) {
      const sig = await sendAndConfirmTransaction(connection, transaction, [wallet]);
      console.log('✅ Token accounts created:', sig);
    }
    
    // Mint tokens to relayer
    console.log('\n📋 Minting tokens to relayer...');
    
    // Mint 5,000 USDC2
    const usdcAmount = 5000 * 10 ** 6;
    await mintTo(
      connection,
      wallet,
      usdcMint,
      relayerUsdcAta,
      wallet.publicKey,
      usdcAmount
    );
    console.log('✅ Minted 5,000 USDC2 to relayer');
    
    // Mint 50 WSOL2
    const wsolAmount = 50 * 10 ** 9;
    await mintTo(
      connection,
      wallet,
      wsolMint,
      relayerWsolAta,
      wallet.publicKey,
      wsolAmount
    );
    console.log('✅ Minted 50 WSOL2 to relayer');
    
    // Check balances
    console.log('\n📊 Relayer token balances:');
    
    const usdcBalance = await getAccount(connection, relayerUsdcAta);
    const wsolBalance = await getAccount(connection, relayerWsolAta);
    
    console.log('USDC2:', Number(usdcBalance.amount) / 10 ** 6);
    console.log('WSOL2:', Number(wsolBalance.amount) / 10 ** 9);
    
    // Also check SOL balance
    const solBalance = await connection.getBalance(RELAYER_ADDRESS);
    console.log('SOL:', solBalance / 10 ** 9);
    
    if (solBalance < 0.1 * 10 ** 9) {
      console.log('\n⚠️  Relayer has low SOL balance. Airdropping 0.5 SOL...');
      const airdropSig = await connection.requestAirdrop(RELAYER_ADDRESS, 0.5 * 10 ** 9);
      await connection.confirmTransaction(airdropSig);
      console.log('✅ Airdropped 0.5 SOL to relayer');
    }
    
    console.log('\n✨ Airdrop complete! Relayer is ready to provide liquidity.');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
airdropToRelayer()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });