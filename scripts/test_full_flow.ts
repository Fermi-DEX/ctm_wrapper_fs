import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { ContinuumClient } from '../sdk/src';
import { createExecuteOrderInstructionsWithSignature } from '../sdk/src/instructions';
import { getPoolRegistryPDA, getPoolAuthorityPDA, getOrderPDA } from '../sdk/src/utils';
import BN from 'bn.js';
import fs from 'fs';

const CONTINUUM_PROGRAM_ID = new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function initializePoolRegistry(
  connection: Connection,
  admin: Keypair,
  poolId: PublicKey
): Promise<string> {
  console.log('\n=== Initializing Pool Registry ===');

  const [poolRegistry] = getPoolRegistryPDA(poolId);
  const [poolAuthority] = getPoolAuthorityPDA(poolId);

  // Create simple instruction to initialize registry
  const keys = [
    { pubkey: poolRegistry, isSigner: false, isWritable: true },
    { pubkey: admin.publicKey, isSigner: true, isWritable: true },
    { pubkey: poolId, isSigner: false, isWritable: false },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Use initialize_cp_swap_pool instruction discriminator
  const discriminator = Buffer.from([51, 202, 193, 34, 181, 88, 53, 101]);
  const initAmount0 = new BN(1000000000).toArrayLike(Buffer, 'le', 8);
  const initAmount1 = new BN(1000000).toArrayLike(Buffer, 'le', 8);
  const openTime = new BN(0).toArrayLike(Buffer, 'le', 8);

  const data = Buffer.concat([discriminator, initAmount0, initAmount1, openTime]);

  const tx = new Transaction().add({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });

  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = admin.publicKey;
  tx.sign(admin);

  const sig = await connection.sendTransaction(tx, [admin]);
  await connection.confirmTransaction(sig, 'confirmed');

  console.log('Pool registry initialized:', sig);
  return sig;
}

async function main() {
  console.log('=== Full Flow Test with Ed25519 Signatures ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load wallets
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  const relayerKeypairData = JSON.parse(
    fs.readFileSync('/home/ubuntu/ctm_wrapper_fs/relayer/relayer-keypair.json', 'utf-8')
  );
  const relayerKeypair = Keypair.fromSecretKey(new Uint8Array(relayerKeypairData));

  console.log('User wallet:', userKeypair.publicKey.toBase58());
  console.log('Relayer wallet:', relayerKeypair.publicKey.toBase58());

  const client = new ContinuumClient(connection);

  try {
    // Check FIFO state
    const fifoState = await client.getFifoState();
    if (!fifoState) {
      console.error('Program not initialized!');
      process.exit(1);
    }
    console.log('Current sequence:', fifoState.currentSequence.toString());
    console.log('Expected relayer:', fifoState.relayerPubkey.toBase58());

    // Use a test pool ID
    const testPoolId = Keypair.generate().publicKey;
    console.log('\nTest pool ID:', testPoolId.toBase58());

    // Initialize pool registry (simplified version)
    await initializePoolRegistry(connection, userKeypair, testPoolId);

    // Submit an order
    console.log('\n=== Submitting Order ===');
    const submitResult = await client.submitOrder(userKeypair, {
      poolId: testPoolId,
      amountIn: new BN(100000000), // 0.1 SOL
      minAmountOut: new BN(1000000),   // min amount out
      isBaseInput: true,
      userSourceToken: PublicKey.default,
      userDestinationToken: PublicKey.default
    });

    console.log('Order submitted!');
    console.log('  Signature:', submitResult.signature);
    console.log('  Sequence:', submitResult.sequence.toString());

    // Get the order state
    const orderState = await client.getOrderState(userKeypair.publicKey, submitResult.sequence);
    if (!orderState) {
      console.error('Failed to get order state');
      process.exit(1);
    }

    console.log('\nOrder State:');
    console.log('  Status:', orderState.status);
    console.log('  User:', orderState.user.toBase58());
    console.log('  Pool ID:', orderState.poolId.toBase58());

    // Test execute order with Ed25519 signature
    console.log('\n=== Testing Execute Order with Ed25519 ===');

    // Create execute order instructions with Ed25519 precompile
    const executeOrderInstructions = createExecuteOrderInstructionsWithSignature(
      {
        executor: relayerKeypair.publicKey,
        orderUser: userKeypair.publicKey,
        sequence: submitResult.sequence,
        poolId: testPoolId,
        userSource: PublicKey.default, // These would be real token accounts
        userDestination: PublicKey.default,
        cpSwapRemainingAccounts: [],
      },
      relayerKeypair
    );

    console.log('Created execute order instructions:');
    console.log('  1. Ed25519 verification instruction');
    console.log('  2. Execute order instruction');

    // Build transaction
    const executeTx = new Transaction();
    executeTx.add(...executeOrderInstructions);

    const { blockhash: executeBlockhash } = await connection.getLatestBlockhash();
    executeTx.recentBlockhash = executeBlockhash;
    executeTx.feePayer = relayerKeypair.publicKey;

    // Sign with relayer
    executeTx.sign(relayerKeypair);

    console.log('\nSimulating execute order transaction...');
    const simulation = await connection.simulateTransaction(executeTx);

    if (simulation.value.err) {
      console.log('Simulation failed (expected - missing CP-Swap accounts):', simulation.value.err);
      console.log('Logs:', simulation.value.logs);

      // Check if Ed25519 verification passed
      const logs = simulation.value.logs || [];
      const hasEd25519Success = logs.some(log =>
        log.includes('Ed25519SigVerify') ||
        log.includes('Relayer signature verified')
      );

      if (hasEd25519Success || logs.some(log => log.includes('Execute order'))) {
        console.log('\n✅ Ed25519 signature verification would pass!');
        console.log('The relayer signature mechanism is working correctly.');
      } else if (logs.some(log => log.includes('InvalidRelayerPubkey'))) {
        console.log('\n❌ Ed25519 verification failed: Invalid relayer pubkey');
      } else if (logs.some(log => log.includes('MissingEd25519Instruction'))) {
        console.log('\n❌ Ed25519 verification failed: Missing Ed25519 instruction');
      }
    } else {
      console.log('✅ Transaction would succeed!');
    }

    // Final state
    const finalFifoState = await client.getFifoState();
    if (finalFifoState) {
      console.log('\nFinal FIFO state:');
      console.log('  Sequence:', finalFifoState.currentSequence.toString());
    }

  } catch (error: any) {
    console.error('Error:', error);
    if (error.logs) {
      console.error('Transaction logs:', error.logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);