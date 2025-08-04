#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  SystemProgram, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount
} from '@solana/spl-token';
import * as anchor from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Program IDs on devnet
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function addLiquidityToPool() {
  console.log('🚀 Adding liquidity to CP-Swap pool on Devnet...\n');

  // Load pool configuration
  const poolConfigPath = path.join(__dirname, 'devnet-pool.json');
  if (!fs.existsSync(poolConfigPath)) {
    console.error('❌ Pool config not found. Run create-pool-with-continuum.ts first.');
    process.exit(1);
  }
  
  const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
  const poolId = new PublicKey(poolConfig.poolId);
  const lpMint = new PublicKey(poolConfig.lpMint);
  const token0Mint = new PublicKey(poolConfig.tokenAMint); // WSOL
  const token1Mint = new PublicKey(poolConfig.tokenBMint); // USDC
  const token0Vault = new PublicKey(poolConfig.tokenAVault);
  const token1Vault = new PublicKey(poolConfig.tokenBVault);

  // Load payer keypair
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  console.log('Payer:', payerKeypair.publicKey.toBase58());

  // Get user token accounts
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLpAccount = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Check current balances
  console.log('\n📋 Checking current balances...');
  
  const token0Account = await getAccount(connection, userToken0Account);
  const token1Account = await getAccount(connection, userToken1Account);
  
  const wsolBalance = Number(token0Account.amount) / 1e9;
  const usdcBalance = Number(token1Account.amount) / 1e6;
  
  console.log(`WSOL Balance: ${wsolBalance} WSOL`);
  console.log(`USDC Balance: ${usdcBalance} USDC`);

  // Calculate deposit amounts
  // Current pool has 1 WSOL : 1000 USDC (price = 1000 USDC/WSOL)
  // Target: Add liquidity to reach ~1000 WSOL total at ~200 USDC/WSOL
  // Need to add: ~999 WSOL and appropriate USDC to maintain ratio
  
  // Since we want to move price from 1000 to 200 USDC/WSOL, we need to add more WSOL than USDC proportionally
  // Let's add 99 WSOL (to reach 100 WSOL total) and calculate USDC needed
  
  const targetWsolLiquidity = 100; // Start with 100 WSOL for now
  const currentWsolInPool = 1;
  const currentUsdcInPool = 1000;
  
  const wsolToAdd = targetWsolLiquidity - currentWsolInPool; // 99 WSOL
  const targetPrice = 200; // USDC per WSOL
  
  // Calculate USDC needed to maintain price around 200
  // With constant product formula: k = x * y
  // Current k = 1 * 1000 = 1000
  // After adding liquidity: (1 + 99) * (1000 + usdcToAdd) should give price ~200
  // Price = USDC / WSOL = (1000 + usdcToAdd) / 100 = 200
  // So: 1000 + usdcToAdd = 20000
  // usdcToAdd = 19000
  
  const usdcToAdd = 9000; // Add 9000 USDC (will give us price of ~100 USDC/WSOL with 100 WSOL)
  
  console.log(`\n📋 Liquidity to add:`);
  console.log(`WSOL: ${wsolToAdd} WSOL`);
  console.log(`USDC: ${usdcToAdd} USDC`);
  console.log(`Expected price after: ~${(currentUsdcInPool + usdcToAdd) / (currentWsolInPool + wsolToAdd)} USDC per WSOL`);

  if (wsolBalance < wsolToAdd) {
    console.error(`❌ Insufficient WSOL balance. Have ${wsolBalance}, need ${wsolToAdd}`);
    process.exit(1);
  }
  
  if (usdcBalance < usdcToAdd) {
    console.error(`❌ Insufficient USDC balance. Have ${usdcBalance}, need ${usdcToAdd}`);
    process.exit(1);
  }

  // Create LP token account if it doesn't exist
  const lpAccountInfo = await connection.getAccountInfo(userLpAccount);
  if (!lpAccountInfo) {
    console.log('\n📋 Creating LP token account...');
    const createLpAccountIx = createAssociatedTokenAccountInstruction(
      payerKeypair.publicKey,
      userLpAccount,
      payerKeypair.publicKey,
      lpMint
    );
    const tx = new Transaction().add(createLpAccountIx);
    await sendAndConfirmTransaction(connection, tx, [payerKeypair]);
    console.log('✅ LP token account created');
  }

  try {
    console.log('\n📋 Depositing liquidity...');

    // Build deposit instruction
    const depositIx = buildDepositInstruction(
      CP_SWAP_PROGRAM_ID,
      poolId,
      lpMint,
      userToken0Account,
      userToken1Account,
      userLpAccount,
      token0Vault,
      token1Vault,
      payerKeypair.publicKey,
      new BN(wsolToAdd * 1e9), // Convert to lamports
      new BN(usdcToAdd * 1e6), // Convert to USDC base units
      new BN(0) // Min LP tokens (0 = no minimum)
    );

    const tx = new Transaction().add(depositIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payerKeypair], {
      skipPreflight: false,
      commitment: 'confirmed'
    });
    
    console.log('✅ Liquidity added successfully!');
    console.log('Transaction:', sig);
    
    // Check LP token balance
    const lpAccount = await getAccount(connection, userLpAccount);
    console.log(`\n📊 LP tokens received: ${Number(lpAccount.amount) / 1e9}`);
    
    // Check final balances
    const finalToken0Account = await getAccount(connection, userToken0Account);
    const finalToken1Account = await getAccount(connection, userToken1Account);
    
    const finalWsolBalance = Number(finalToken0Account.amount) / 1e9;
    const finalUsdcBalance = Number(finalToken1Account.amount) / 1e6;
    
    console.log('\n📊 Final balances:');
    console.log(`WSOL: ${finalWsolBalance} (spent ${wsolBalance - finalWsolBalance})`);
    console.log(`USDC: ${finalUsdcBalance} (spent ${usdcBalance - finalUsdcBalance})`);
    
    console.log('\n✨ Liquidity addition complete!');
    console.log(`Pool now has approximately ${currentWsolInPool + wsolToAdd} WSOL and ${currentUsdcInPool + usdcToAdd} USDC`);
    console.log(`Approximate price: ${(currentUsdcInPool + usdcToAdd) / (currentWsolInPool + wsolToAdd)} USDC per WSOL`);

  } catch (err: any) {
    console.error('Error adding liquidity:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }
}

// Helper function to build deposit instruction
function buildDepositInstruction(
  programId: PublicKey,
  poolId: PublicKey,
  lpMint: PublicKey,
  userToken0: PublicKey,
  userToken1: PublicKey,
  userLp: PublicKey,
  token0Vault: PublicKey,
  token1Vault: PublicKey,
  owner: PublicKey,
  amount0Max: BN,
  amount1Max: BN,
  minLpAmount: BN
): anchor.web3.TransactionInstruction {
  // deposit discriminator [242, 35, 198, 137, 82, 225, 242, 182]
  const discriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
  
  const data = Buffer.concat([
    discriminator,
    minLpAmount.toArrayLike(Buffer, 'le', 8), // lp_token_amount
    amount0Max.toArrayLike(Buffer, 'le', 8), // maximum_token_0_amount
    amount1Max.toArrayLike(Buffer, 'le', 8), // maximum_token_1_amount
  ]);

  // Derive vault authority
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    programId
  );

  return new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_2022_program
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // memo_program (using TOKEN_PROGRAM_ID as placeholder)
    ],
    programId,
    data,
  });
}

// Run the script
addLiquidityToPool()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });