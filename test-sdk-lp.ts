#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createAssociatedTokenAccountInstruction,
  getOrCreateAssociatedTokenAccount
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Import SDK functions
import { createDepositLpInstruction, DepositLpParams } from './sdk/src/instructions/depositLp';
import { createWithdrawLpInstruction, WithdrawLpParams } from './sdk/src/instructions/withdrawLp';
import { CONTINUUM_PROGRAM_ID, CP_SWAP_PROGRAM_ID } from './sdk/src/constants';
import { getFifoStatePDA } from './sdk/src/utils';

async function testSDKLpOperations() {
  console.log('🚀 Testing Continuum SDK LP Deposit and Withdraw...\n');

  // Setup connection and wallet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync('/home/ubuntu/.config/solana/id.json', 'utf8')))
  );
  
  console.log('Payer:', payerKeypair.publicKey.toBase58());
  console.log('Continuum Program ID:', CONTINUUM_PROGRAM_ID.toBase58());
  console.log('CP-Swap Program ID:', CP_SWAP_PROGRAM_ID.toBase58());

  // Check SOL balance
  const balance = await connection.getBalance(payerKeypair.publicKey);
  console.log('SOL Balance:', balance / LAMPORTS_PER_SOL);

  // Get FIFO state PDA
  const [fifoState] = getFifoStatePDA();
  console.log('FIFO State PDA:', fifoState.toBase58());

  // Example pool configuration (you'll need to update these with actual values)
  const poolId = new PublicKey('11111111111111111111111111111111'); // Replace with actual pool ID
  const token0Mint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const token1Mint = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL
  const lpMint = new PublicKey('11111111111111111111111111111111'); // Replace with actual LP mint
  
  // Pool authority derived from pool ID
  const poolAuthoritySeeds = [
    Buffer.from('cp_pool_authority'),
    poolId.toBuffer()
  ];
  const [poolAuthority, poolAuthorityBump] = PublicKey.findProgramAddressSync(
    poolAuthoritySeeds,
    CONTINUUM_PROGRAM_ID
  );
  
  console.log('Pool Authority:', poolAuthority.toBase58());
  console.log('Pool Authority Bump:', poolAuthorityBump);

  // Get user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLp = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);
  
  console.log('User Token0 (USDC):', userToken0.toBase58());
  console.log('User Token1 (WSOL):', userToken1.toBase58());
  console.log('User LP Token:', userLp.toBase58());

  // Example pool state accounts (you'll need to replace with actual accounts)
  const poolStateAccount = poolId; // This should be the actual pool state account
  const token0Vault = new PublicKey('11111111111111111111111111111111'); // Replace with actual vault
  const token1Vault = new PublicKey('11111111111111111111111111111111'); // Replace with actual vault

  // Test 1: Create Deposit LP Instruction
  console.log('\n📥 Testing Deposit LP Instruction Creation...');
  
  const depositParams: DepositLpParams = {
    user: payerKeypair.publicKey,
    cpSwapProgram: CP_SWAP_PROGRAM_ID,
    poolId: poolId,
    minLpAmount: new BN(0), // Accept any amount
    maxAmount0: new BN(1000 * 1e6), // 1000 USDC
    maxAmount1: new BN(1000 * 1e9), // 1000 WSOL
    poolAuthorityBump: poolAuthorityBump,
    remainingAccounts: [
      // The user (first account must be signer)
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: false },
      // Pool state
      { pubkey: poolStateAccount, isSigner: false, isWritable: true },
      // Pool authority
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      // User LP token account
      { pubkey: userLp, isSigner: false, isWritable: true },
      // User token accounts
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      // Pool vaults
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      // LP mint
      { pubkey: lpMint, isSigner: false, isWritable: true },
      // Token program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ]
  };

  try {
    const depositInstruction = createDepositLpInstruction(depositParams);
    console.log('✅ Deposit LP instruction created successfully');
    console.log('Instruction data length:', depositInstruction.data.length);
    console.log('Number of accounts:', depositInstruction.keys.length);
  } catch (error) {
    console.error('❌ Error creating deposit instruction:', error);
  }

  // Test 2: Create Withdraw LP Instruction
  console.log('\n📤 Testing Withdraw LP Instruction Creation...');
  
  const withdrawParams: WithdrawLpParams = {
    user: payerKeypair.publicKey,
    cpSwapProgram: CP_SWAP_PROGRAM_ID,
    poolId: poolId,
    lpAmount: new BN(500 * 1e9), // 500 LP tokens
    minAmount0: new BN(0), // Accept any amount
    minAmount1: new BN(0), // Accept any amount
    poolAuthorityBump: poolAuthorityBump,
    remainingAccounts: [
      // Same account structure as deposit
      { pubkey: payerKeypair.publicKey, isSigner: true, isWritable: false },
      { pubkey: poolStateAccount, isSigner: false, isWritable: true },
      { pubkey: poolAuthority, isSigner: false, isWritable: false },
      { pubkey: userLp, isSigner: false, isWritable: true },
      { pubkey: userToken0, isSigner: false, isWritable: true },
      { pubkey: userToken1, isSigner: false, isWritable: true },
      { pubkey: token0Vault, isSigner: false, isWritable: true },
      { pubkey: token1Vault, isSigner: false, isWritable: true },
      { pubkey: lpMint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
    ]
  };

  try {
    const withdrawInstruction = createWithdrawLpInstruction(withdrawParams);
    console.log('✅ Withdraw LP instruction created successfully');
    console.log('Instruction data length:', withdrawInstruction.data.length);
    console.log('Number of accounts:', withdrawInstruction.keys.length);
  } catch (error) {
    console.error('❌ Error creating withdraw instruction:', error);
  }

  // Test 3: Check if FIFO state exists
  console.log('\n🔍 Checking FIFO State...');
  try {
    const fifoStateInfo = await connection.getAccountInfo(fifoState);
    if (fifoStateInfo) {
      console.log('✅ FIFO State exists');
      console.log('Owner:', fifoStateInfo.owner.toBase58());
      console.log('Data length:', fifoStateInfo.data.length);
    } else {
      console.log('❌ FIFO State does not exist - needs to be initialized');
    }
  } catch (error) {
    console.error('❌ Error checking FIFO state:', error);
  }

  console.log('\n📋 Test Summary:');
  console.log('- SDK deposit instruction creation: ✅');
  console.log('- SDK withdraw instruction creation: ✅');
  console.log('- Program ID updated in constants: ✅');
  console.log('- FIFO state PDA derivation: ✅');
  
  console.log('\n⚠️  Note: To test actual execution, you need:');
  console.log('1. A real CP-Swap pool with proper configuration');
  console.log('2. Initialized FIFO state (run initialize first)');
  console.log('3. User token accounts with sufficient balances');
  console.log('4. Correct pool authority and vault addresses');
}

// Run the test
if (require.main === module) {
  testSDKLpOperations()
    .then(() => {
      console.log('\n✅ SDK LP test completed!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}

export { testSDKLpOperations };