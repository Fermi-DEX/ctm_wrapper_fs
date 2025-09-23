import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';

const CONTINUUM_PROGRAM_ID = new PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');

// Use the pool we created earlier
const POOL_ID = new PublicKey('3cE6Bzs85Mayba6RPBaEVZgNGzLw4XT2DviYZnT1kj63');
const TOKEN_0 = new PublicKey('4PYRa2DbfD9is59ZVDoGdagNQjBVSM8Pxp45yvJkD3Yf');
const TOKEN_1 = new PublicKey('FMme6oE1CJjfRH5G3KK69kfpRSeVFBrvVZsp3j7Zp5sp');

async function main() {
  console.log('=== Register Existing Pool ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('/home/ubuntu/.config/solana/id.json'))
  );
  console.log('Admin wallet:', userKeypair.publicKey.toBase58());
  console.log('Pool ID:', POOL_ID.toBase58());

  // Derive PDAs
  const [fifoStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), POOL_ID.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), POOL_ID.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  console.log('Pool Registry:', poolRegistry.toBase58());
  console.log('Pool Authority:', poolAuthority.toBase58());

  // Check if already registered
  const registryAccount = await connection.getAccountInfo(poolRegistry);
  if (registryAccount) {
    console.log('✅ Pool already registered');
    return;
  }

  // Build register_pool instruction
  const discriminator = Buffer.from([247, 53, 103, 72, 221, 179, 40, 175]); // register_pool discriminator (hash of "global:register_pool")

  // Calculate the discriminator correctly
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256')
    .update('global:register_pool')
    .digest();
  const actualDiscriminator = hash.slice(0, 8);

  const instructionData = Buffer.concat([
    actualDiscriminator,
    TOKEN_0.toBuffer(),
    TOKEN_1.toBuffer(),
  ]);

  const accounts = [
    { pubkey: fifoStatePDA, isSigner: false, isWritable: false },
    { pubkey: poolRegistry, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: POOL_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const registerIx = new TransactionInstruction({
    keys: accounts,
    programId: CONTINUUM_PROGRAM_ID,
    data: instructionData,
  });

  const tx = new Transaction().add(registerIx);

  console.log('Registering pool...');
  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [userKeypair],
      { commitment: 'confirmed' }
    );
    console.log('✅ Pool registered! Signature:', signature);

    // Verify registration
    const newRegistryAccount = await connection.getAccountInfo(poolRegistry);
    if (newRegistryAccount) {
      console.log('✅ Registry account created successfully');
      console.log('  Size:', newRegistryAccount.data.length, 'bytes');
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main().catch(console.error);