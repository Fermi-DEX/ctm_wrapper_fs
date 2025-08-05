#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { createInitializeInstruction } from '../../sdk/src/instructions/initialize';
import { getFifoStatePDA } from '../../sdk/src/utils/pda';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Program ID on devnet
const CONTINUUM_PROGRAM_ID = new PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m');

async function initializeFifoStateOnDevnet() {
  console.log('🚀 Initializing FIFO state on Devnet\n');
  
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Admin wallet:', wallet.publicKey.toBase58());
  
  // Get FIFO state PDA
  const [fifoState] = getFifoStatePDA();
  console.log('FIFO State PDA:', fifoState.toBase58());
  
  try {
    // Check if FIFO state already exists
    const fifoAccount = await connection.getAccountInfo(fifoState);
    
    if (fifoAccount) {
      console.log('\n✅ FIFO state already initialized!');
      console.log('Account size:', fifoAccount.data.length, 'bytes');
      console.log('Owner:', fifoAccount.owner.toBase58());
      return;
    }
    
    console.log('\n📋 Initializing FIFO state...');
    
    // Create initialize instruction
    const initIx = createInitializeInstruction(wallet.publicKey);
    
    // Build and send transaction
    const transaction = new Transaction().add(initIx);
    
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      {
        commitment: 'confirmed',
        preflightCommitment: 'confirmed'
      }
    );
    
    console.log('✅ FIFO state initialized!');
    console.log('   Signature:', signature);
    console.log('   FIFO State:', fifoState.toBase58());
    console.log('   Admin:', wallet.publicKey.toBase58());
    
    // Verify the account was created
    const newAccount = await connection.getAccountInfo(fifoState);
    if (newAccount) {
      console.log('\n📊 FIFO State Account Info:');
      console.log('   Size:', newAccount.data.length, 'bytes');
      console.log('   Owner:', newAccount.owner.toBase58());
      console.log('   Lamports:', newAccount.lamports);
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
    }
    process.exit(1);
  }
}

// Run the script
initializeFifoStateOnDevnet()
  .then(() => {
    console.log('\n✨ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });