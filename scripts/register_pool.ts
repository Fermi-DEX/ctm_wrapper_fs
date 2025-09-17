import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';
import BN from 'bn.js';

const CONTINUUM_PROGRAM_ID = new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3');

// Parse pool ID from command line
const poolId = process.argv[2];
if (!poolId) {
  console.error('Usage: npx ts-node scripts/register_pool.ts <pool_id>');
  process.exit(1);
}

async function main() {
  const connection = new Connection('https://devnet.helius-rpc.com', 'confirmed');

  // Load local keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('../../../.config/solana/id.json'))
  );
  console.log('Admin wallet:', userKeypair.publicKey.toBase58());

  const poolState = new PublicKey(poolId);
  console.log('Pool to register:', poolState.toBase58());

  // Derive pool registry PDA
  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  console.log('Pool Registry PDA:', poolRegistry.toBase58());

  // Derive pool authority PDA
  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );
  console.log('Pool Authority PDA:', poolAuthority.toBase58());

  // Check if already registered
  const registryAccount = await connection.getAccountInfo(poolRegistry);
  if (registryAccount) {
    console.log('✅ Pool already registered');
    return;
  }

  // Create registry account using SystemProgram.createAccountWithSeed
  console.log('Creating pool registry account...');

  const space = 8 + 32 + 32 + 32 + 32 + 8 + 1; // CpSwapPoolRegistry::LEN
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(space);

  // Since we can't use createAccount with a PDA, we need to transfer lamports and allocate space
  // This would typically be done through the program, but we can try a workaround

  // First, transfer lamports to the PDA
  const transferIx = SystemProgram.transfer({
    fromPubkey: userKeypair.publicKey,
    toPubkey: poolRegistry,
    lamports: rentExemptBalance,
  });

  const tx = new Transaction().add(transferIx);

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [userKeypair],
      { commitment: 'confirmed' }
    );
    console.log('✅ Transferred lamports to registry PDA! Signature:', signature);
  } catch (error: any) {
    console.error('Failed to create registry manually:', error.message);
    console.log('\nThe pool registry needs to be created through the CTM Wrapper program.');
    console.log('Since there is no separate registration instruction, the pool cannot be used with the CTM Wrapper');
    console.log('unless it was initialized through the wrapper\'s initialize_cp_swap_pool instruction.');
  }
}

main().catch(console.error);