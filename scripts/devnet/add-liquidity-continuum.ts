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
const CONTINUUM_PROGRAM_ID = new PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m');

// Memo program (using System Program as placeholder)
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

async function addLiquidityThroughContinuum() {
  console.log('🚀 Adding liquidity to CP-Swap pool through Continuum on Devnet...\n');

  // Load pool configuration
  const poolConfigPath = path.join(__dirname, 'devnet-pool.json');
  if (!fs.existsSync(poolConfigPath)) {
    console.error('❌ Pool config not found. Run create-pool-with-continuum.ts first.');
    process.exit(1);
  }
  
  const poolConfig = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
  const poolId = new PublicKey(poolConfig.poolId);
  const lpMint = new PublicKey(poolConfig.lpMint);
  const token0Mint = new PublicKey(poolConfig.tokenAMint); // WSOL2
  const token1Mint = new PublicKey(poolConfig.tokenBMint); // USDC2
  const token0Vault = new PublicKey(poolConfig.tokenAVault);
  const token1Vault = new PublicKey(poolConfig.tokenBVault);

  // Load relayer keypair to use as liquidity provider
  const relayerKeypairPath = path.join(__dirname, '../../relayer/relayer-keypair.json');
  const relayerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(relayerKeypairPath, 'utf8')))
  );
  console.log('Liquidity Provider:', relayerKeypair.publicKey.toBase58());

  // Get token accounts
  const userToken0Account = await getAssociatedTokenAddress(token0Mint, relayerKeypair.publicKey);
  const userToken1Account = await getAssociatedTokenAddress(token1Mint, relayerKeypair.publicKey);
  const userLpAccount = await getAssociatedTokenAddress(lpMint, relayerKeypair.publicKey);

  // Check current balances
  console.log('\n📋 Checking current balances...');
  
  const token0Account = await getAccount(connection, userToken0Account);
  const token1Account = await getAccount(connection, userToken1Account);
  
  const wsolBalance = Number(token0Account.amount) / 1e9;
  const usdcBalance = Number(token1Account.amount) / 1e6;
  
  console.log(`WSOL2 Balance: ${wsolBalance} WSOL2`);
  console.log(`USDC2 Balance: ${usdcBalance} USDC2`);

  // Create LP token account if it doesn't exist
  const lpAccountInfo = await connection.getAccountInfo(userLpAccount);
  if (!lpAccountInfo) {
    console.log('\n📋 Creating LP token account...');
    const createLpAccountIx = createAssociatedTokenAccountInstruction(
      relayerKeypair.publicKey,
      userLpAccount,
      relayerKeypair.publicKey,
      lpMint
    );
    const tx = new Transaction().add(createLpAccountIx);
    await sendAndConfirmTransaction(connection, tx, [relayerKeypair]);
    console.log('✅ LP token account created');
  }

  // Derive pool authority PDA
  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolId.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  // Derive vault and LP mint authority
  const [vaultLpMintAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );

  try {
    console.log('\n📋 Adding liquidity through Continuum...');

    // Calculate deposit amounts for target price of ~200 USDC per WSOL
    // Current pool has 1 WSOL : 1000 USDC
    // Add 49 WSOL and 9800 USDC to maintain 200 USDC/WSOL ratio
    const depositAmount0 = new BN(49 * 1e9); // 49 WSOL2
    const depositAmount1 = new BN(9800 * 1e6); // 9800 USDC2
    const minLpAmount = new BN(0); // Accept any amount of LP tokens

    // Build the deposit instruction for Continuum
    const discriminator = Buffer.from([77, 156, 213, 165, 88, 20, 165, 139]); // deposit_liquidity
    
    const data = Buffer.concat([
      discriminator,
      minLpAmount.toArrayLike(Buffer, 'le', 8),
      depositAmount0.toArrayLike(Buffer, 'le', 8),
      depositAmount1.toArrayLike(Buffer, 'le', 8),
    ]);

    const keys = [
      { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolId, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: userToken0Account, isSigner: false, isWritable: true },
      { pubkey: userToken1Account, isSigner: false, isWritable: true },
      { pubkey: userLpAccount, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: token0Mint, isSigner: false, isWritable: false },
      { pubkey: token1Mint, isSigner: false, isWritable: false },
      { pubkey: vaultLpMintAuthority, isSigner: false, isWritable: false },
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program_2022
      { pubkey: MEMO_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    const depositIx = new anchor.web3.TransactionInstruction({
      programId: CONTINUUM_PROGRAM_ID,
      keys,
      data,
    });

    const tx = new Transaction().add(depositIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [relayerKeypair], {
      skipPreflight: false,
      commitment: 'confirmed'
    });
    
    console.log('✅ Liquidity added successfully through Continuum!');
    console.log('Transaction:', sig);
    
    // Check LP token balance
    const lpAccount = await getAccount(connection, userLpAccount);
    console.log(`\n📊 LP tokens received: ${Number(lpAccount.amount) / 1e9}`);
    
    // Check pool state
    console.log('\n📊 Checking new pool state...');
    const vault0Balance = await connection.getTokenAccountBalance(token0Vault);
    const vault1Balance = await connection.getTokenAccountBalance(token1Vault);
    
    const poolWsol = Number(vault0Balance.value.amount) / 1e9;
    const poolUsdc = Number(vault1Balance.value.amount) / 1e6;
    
    console.log(`Pool WSOL2: ${poolWsol}`);
    console.log(`Pool USDC2: ${poolUsdc}`);
    console.log(`Price: ${poolUsdc / poolWsol} USDC2 per WSOL2`);

  } catch (err: any) {
    console.error('Error adding liquidity:', err);
    if (err.logs) {
      console.error('Transaction logs:', err.logs);
    }
  }
}

// Run the script
addLiquidityThroughContinuum()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });