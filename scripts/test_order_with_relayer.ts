import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  getMint
} from '@solana/spl-token';
import { ContinuumClient } from '../sdk/src';
import BN from 'bn.js';
import fs from 'fs';

// Test pool configuration (using a known devnet pool)
const POOL_ID = new PublicKey('8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj');
const TOKEN_A_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // SOL
const TOKEN_B_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC devnet

async function main() {
  console.log('=== Testing Order Placement with Relayer ===\n');

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load user wallet
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  // Initialize client
  const client = new ContinuumClient(connection);

  try {
    // Check FIFO state
    const fifoState = await client.getFifoState();
    if (!fifoState) {
      console.error('Program not initialized!');
      process.exit(1);
    }
    console.log('Current sequence:', fifoState.currentSequence.toString());
    console.log('Relayer pubkey:', fifoState.relayerPubkey.toBase58());

    // Get user token accounts
    const userTokenA = getAssociatedTokenAddressSync(TOKEN_A_MINT, userKeypair.publicKey);
    const userTokenB = getAssociatedTokenAddressSync(TOKEN_B_MINT, userKeypair.publicKey);

    console.log('\nUser token accounts:');
    console.log('  Token A (SOL):', userTokenA.toBase58());
    console.log('  Token B (USDC):', userTokenB.toBase58());

    // Create token accounts if they don't exist
    const tx = new Transaction();

    // Check Token A account
    const tokenAAccount = await connection.getAccountInfo(userTokenA);
    if (!tokenAAccount) {
      console.log('Creating Token A account...');
      tx.add(
        createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          userTokenA,
          userKeypair.publicKey,
          TOKEN_A_MINT
        )
      );
    }

    // Check Token B account
    const tokenBAccount = await connection.getAccountInfo(userTokenB);
    if (!tokenBAccount) {
      console.log('Creating Token B account...');
      tx.add(
        createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          userTokenB,
          userKeypair.publicKey,
          TOKEN_B_MINT
        )
      );
    }

    if (tx.instructions.length > 0) {
      const sig = await connection.sendTransaction(tx, [userKeypair]);
      await connection.confirmTransaction(sig);
      console.log('Token accounts created:', sig);
    }

    // Submit order to relayer
    console.log('\n=== Submitting Order to Relayer ===');

    const orderData = {
      poolId: POOL_ID.toBase58(),
      amountIn: '100000000', // 0.1 SOL
      minAmountOut: '1000000', // 1 USDC minimum
      isBaseInput: true,
      userPublicKey: userKeypair.publicKey.toBase58(),
      userTokenA: userTokenA.toBase58(),
      userTokenB: userTokenB.toBase58()
    };

    console.log('Order details:', orderData);

    // Submit to relayer API
    const response = await fetch('http://localhost:8082/api/submit-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderData)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Relayer error: ${error}`);
    }

    const result: any = await response.json();
    console.log('\n✅ Order submitted successfully!');
    console.log('Order ID:', result.orderId);
    console.log('Sequence:', result.sequence);
    console.log('Estimated execution time:', result.estimatedExecutionTime, 'ms');

    // Wait for execution
    console.log('\nWaiting for relayer to execute order...');

    let executed = false;
    let attempts = 0;
    const maxAttempts = 30;

    while (!executed && attempts < maxAttempts) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check order status via API
      const statusResponse = await fetch(`http://localhost:8082/api/order/${result.orderId}`);
      if (statusResponse.ok) {
        const status: any = await statusResponse.json();
        console.log(`Attempt ${attempts}: Order status = ${status.status}`);

        if (status.status === 'executed') {
          executed = true;
          console.log('\n✅ Order executed!');
          console.log('Signature:', status.signature);
          console.log('Actual amount out:', status.actualAmountOut);
          console.log('Execution price:', status.executionPrice);
        } else if (status.status === 'failed' || status.status === 'cancelled') {
          console.error('❌ Order failed or cancelled:', status.error);
          break;
        }
      }
    }

    if (!executed && attempts >= maxAttempts) {
      console.error('❌ Order execution timed out');
    }

    // Check final FIFO state
    const finalFifoState = await client.getFifoState();
    if (finalFifoState) {
      console.log('\nFinal sequence:', finalFifoState.currentSequence.toString());
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main().catch(console.error);