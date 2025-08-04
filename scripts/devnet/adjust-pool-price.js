#!/usr/bin/env node
const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, getAccount, createSyncNativeInstruction } = require('@solana/spl-token');
const { AnchorProvider, Program, BN, Wallet } = require('@coral-xyz/anchor');
const fs = require('fs');
const path = require('path');

// Load constants
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../constants.json'), 'utf8')
);

const poolConfig = constants.devnet.pools['USDC-WSOL'];

async function checkAndAdjustPool() {
  console.log('🚀 Checking and adjusting devnet pool price...\n');

  // Setup connection
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load relayer keypair
  const keypairPath = path.join(__dirname, '../../relayer/relayer-keypair.json');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  );
  
  console.log('Using wallet:', payerKeypair.publicKey.toBase58());
  
  // Get wallet balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('Wallet SOL balance:', balance / 1e9);

  const poolId = new PublicKey(poolConfig.poolId);
  const token0Vault = new PublicKey(poolConfig.tokenAVault); // USDC
  const token1Vault = new PublicKey(poolConfig.tokenBVault); // WSOL
  const token0Mint = new PublicKey(poolConfig.tokenAMint); // USDC
  const token1Mint = new PublicKey(poolConfig.tokenBMint); // WSOL

  // Check current pool balances
  console.log('\n📊 Current pool state:');
  
  try {
    const vault0Account = await getAccount(connection, token0Vault);
    const vault1Account = await getAccount(connection, token1Vault);
    
    const usdcBalance = Number(vault0Account.amount) / 1e6;
    const wsolBalance = Number(vault1Account.amount) / 1e9;
    
    console.log('Pool USDC balance:', usdcBalance.toFixed(2));
    console.log('Pool WSOL balance:', wsolBalance.toFixed(2));
    console.log('Current price:', (usdcBalance / wsolBalance).toFixed(2), 'USDC per SOL');
    
    // Calculate required adjustment
    const targetPrice = 200;
    const currentPrice = usdcBalance / wsolBalance;
    
    if (Math.abs(currentPrice - targetPrice) < 0.01) {
      console.log('\n✅ Price is already at target!');
      return;
    }
    
    console.log('\n📈 Target price:', targetPrice, 'USDC per SOL');
    console.log('Price difference:', (currentPrice - targetPrice).toFixed(2));
    
    // For a constant product AMM: x * y = k
    // To adjust price, we need to add liquidity in a specific ratio
    // Since we want to lower the price from 204 to 200, we need to add more WSOL
    
    const targetWsolBalance = usdcBalance / targetPrice;
    const wsolToAdd = targetWsolBalance - wsolBalance;
    
    if (wsolToAdd > 0) {
      console.log('\nTo reach target price:');
      console.log('Need to add', wsolToAdd.toFixed(2), 'WSOL to the pool');
      console.log('\n⚠️  Note: Direct single-sided deposits may not be supported.');
      console.log('You may need to:');
      console.log('1. Add balanced liquidity (both USDC and WSOL)');
      console.log('2. Or perform swaps to adjust the price');
    } else {
      console.log('\nPrice is below target. Would need to add USDC or swap WSOL for USDC.');
    }
    
    // Check user token balances
    console.log('\n💰 Checking user token balances...');
    const userToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
    const userToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
    
    try {
      const userUsdc = await getAccount(connection, userToken0);
      console.log('User USDC balance:', Number(userUsdc.amount) / 1e6);
    } catch (e) {
      console.log('User USDC token account not found');
    }
    
    try {
      const userWsol = await getAccount(connection, userToken1);
      console.log('User WSOL balance:', Number(userWsol.amount) / 1e9);
    } catch (e) {
      console.log('User WSOL token account not found');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run the check
checkAndAdjustPool()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });