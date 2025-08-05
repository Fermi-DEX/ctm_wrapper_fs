#!/usr/bin/env ts-node
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Program IDs on devnet
const CONTINUUM_PROGRAM_ID = new PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m');

// Load constants
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../constants.json'), 'utf8')
);

function buildRegisterPoolInstruction(
  poolId: PublicKey,
  admin: PublicKey,
  fifoState: PublicKey,
  poolRegistry: PublicKey,
  tokenAMint: PublicKey,
  tokenBMint: PublicKey
): TransactionInstruction {
  const keys = [
    { pubkey: poolRegistry, isSigner: false, isWritable: true },
    { pubkey: poolId, isSigner: false, isWritable: false },
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: tokenAMint, isSigner: false, isWritable: false },
    { pubkey: tokenBMint, isSigner: false, isWritable: false },
    { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
  ];

  // Discriminator for register_pool: [244, 158, 220, 65, 8, 73, 4, 65]
  const data = Buffer.from([244, 158, 220, 65, 8, 73, 4, 65]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}

async function registerPoolsOnDevnet() {
  console.log('🚀 Registering pools on Devnet\n');
  
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Admin wallet:', wallet.publicKey.toBase58());
  
  // Get FIFO state PDA
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );
  console.log('FIFO State PDA:', fifoState.toBase58());
  
  // Register each pool
  const pools = constants.devnet.pools as Record<string, any>;
  for (const [poolName, poolData] of Object.entries(pools)) {
    try {
      console.log(`\n📋 Registering ${poolName} pool...`);
      
      const poolId = new PublicKey(poolData.poolId);
      const tokenAMint = new PublicKey(poolData.tokenAMint);
      const tokenBMint = new PublicKey(poolData.tokenBMint);
      
      // Derive pool registry PDA
      const [poolRegistry] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_registry'), poolId.toBuffer()],
        CONTINUUM_PROGRAM_ID
      );
      
      // Check if already registered
      const registryAccount = await connection.getAccountInfo(poolRegistry);
      if (registryAccount) {
        console.log(`✅ ${poolName} pool already registered`);
        continue;
      }
      
      // Build register instruction
      const registerIx = buildRegisterPoolInstruction(
        poolId,
        wallet.publicKey,
        fifoState,
        poolRegistry,
        tokenAMint,
        tokenBMint
      );
      
      // Send transaction
      const transaction = new Transaction().add(registerIx);
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [wallet],
        {
          commitment: 'confirmed',
          preflightCommitment: 'confirmed'
        }
      );
      
      console.log(`✅ ${poolName} pool registered!`);
      console.log('   Signature:', signature);
      console.log('   Pool ID:', poolId.toBase58());
      console.log('   Registry:', poolRegistry.toBase58());
      
    } catch (error) {
      console.error(`\n❌ Error registering ${poolName} pool:`, error);
      if (error.logs) {
        console.error('Transaction logs:', error.logs);
      }
    }
  }
  
  console.log('\n✨ Pool registration complete!');
}

// Run the script
registerPoolsOnDevnet()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });