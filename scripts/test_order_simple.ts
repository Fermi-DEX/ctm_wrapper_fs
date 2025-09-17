import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import { ContinuumClient } from '../sdk/src';
import {
  createExecuteOrderInstructionsWithSignature
} from '../sdk/src/instructions';
import BN from 'bn.js';
import fs from 'fs';

// Use existing devnet test pool - SOL/USDC
const POOL_ID = new PublicKey('8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj');
const TOKEN_A_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // SOL
const TOKEN_B_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC devnet

async function main() {
  console.log('=== Testing Order Execution with Ed25519 Signature ===\n');

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
    console.log('Program initialized with relayer:', fifoState.relayerPubkey.toBase58());
    console.log('Current sequence:', fifoState.currentSequence.toString());

    // === Step 1: Ensure user has SOL ===
    console.log('\n=== Step 1: Checking User Balance ===');
    const balance = await connection.getBalance(userKeypair.publicKey);
    console.log(`User balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < 0.5 * LAMPORTS_PER_SOL) {
      console.log('Requesting airdrop...');
      const sig = await connection.requestAirdrop(userKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      console.log('Airdrop complete');
    }

    // === Step 2: Create token accounts ===
    console.log('\n=== Step 2: Setting Up Token Accounts ===');

    const userTokenA = getAssociatedTokenAddressSync(TOKEN_A_MINT, userKeypair.publicKey);
    const userTokenB = getAssociatedTokenAddressSync(TOKEN_B_MINT, userKeypair.publicKey);

    console.log('User Token A (SOL):', userTokenA.toBase58());
    console.log('User Token B (USDC):', userTokenB.toBase58());

    // Check and create token accounts if needed
    const tokenAAccount = await connection.getAccountInfo(userTokenA);
    const tokenBAccount = await connection.getAccountInfo(userTokenB);

    if (!tokenAAccount || !tokenBAccount) {
      const tx = new Transaction();

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
        const sig = await sendAndConfirmTransaction(connection, tx, [userKeypair]);
        console.log('Token accounts created:', sig);
      }
    }

    // === Step 3: Submit Order ===
    console.log('\n=== Step 3: Submitting Order ===');

    const amountIn = new BN(100_000_000); // 0.1 SOL
    const minAmountOut = new BN(1_000_000); // Min 1 USDC

    console.log('Order details:');
    console.log('  Pool:', POOL_ID.toBase58());
    console.log('  Amount In: 0.1 SOL');
    console.log('  Min Amount Out: 1 USDC');

    const submitResult = await client.submitOrder(userKeypair, {
      poolId: POOL_ID,
      amountIn: amountIn,
      minAmountOut: minAmountOut,
      isBaseInput: true,
      userSourceToken: userTokenA,
      userDestinationToken: userTokenB
    });

    console.log('\n✅ Order submitted!');
    console.log('  Signature:', submitResult.signature);
    console.log('  Sequence:', submitResult.sequence.toString());

    // Get order state
    const orderState = await client.getOrderState(userKeypair.publicKey, submitResult.sequence);
    if (!orderState) {
      throw new Error('Failed to get order state');
    }

    console.log('\nOrder State:');
    console.log('  Status:', orderState.status === 0 ? 'PENDING' : orderState.status === 1 ? 'EXECUTED' : 'UNKNOWN');
    console.log('  Pool ID:', orderState.poolId.toBase58());
    console.log('  Amount In:', orderState.amountIn.toString());
    console.log('  Min Amount Out:', orderState.minAmountOut.toString());

    // === Step 4: Execute Order with Ed25519 Signature ===
    console.log('\n=== Step 4: Executing Order with Ed25519 Signature ===');

    // Create execute order instructions with Ed25519 signature verification
    const executeOrderInstructions = createExecuteOrderInstructionsWithSignature(
      {
        executor: relayerKeypair.publicKey,
        orderUser: userKeypair.publicKey,
        sequence: submitResult.sequence,
        poolId: POOL_ID,
        userSource: userTokenA,
        userDestination: userTokenB,
        cpSwapRemainingAccounts: [
          // These are placeholder accounts for the CP-Swap CPI
          // In a real scenario, you'd need the actual pool accounts
          POOL_ID,
          userTokenA,
          userTokenB,
        ],
      },
      relayerKeypair
    );

    console.log('Created instructions:');
    console.log('  1. Ed25519 signature verification (precompile)');
    console.log('  2. Execute order with verified signature');

    // Build transaction
    const executeTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...executeOrderInstructions
    );

    // Get initial balance
    let initialSolBalance = 0;
    try {
      const tokenABalance = await connection.getTokenAccountBalance(userTokenA);
      initialSolBalance = tokenABalance.value.uiAmount || 0;
    } catch (e) {
      console.log('No initial SOL token balance');
    }

    let initialUsdcBalance = 0;
    try {
      const tokenBBalance = await connection.getTokenAccountBalance(userTokenB);
      initialUsdcBalance = tokenBBalance.value.uiAmount || 0;
    } catch (e) {
      console.log('No initial USDC token balance');
    }

    console.log('\nInitial balances:');
    console.log('  SOL tokens:', initialSolBalance);
    console.log('  USDC tokens:', initialUsdcBalance);

    // Execute transaction
    console.log('\nSending execute transaction...');
    try {
      const executeSig = await sendAndConfirmTransaction(
        connection,
        executeTx,
        [relayerKeypair],
        { commitment: 'confirmed' }
      );

      console.log('\n✅ Order executed successfully!');
      console.log('  Signature:', executeSig);

      // Get final balances
      let finalSolBalance = 0;
      try {
        const tokenABalance = await connection.getTokenAccountBalance(userTokenA);
        finalSolBalance = tokenABalance.value.uiAmount || 0;
      } catch (e) {
        console.log('No final SOL token balance');
      }

      let finalUsdcBalance = 0;
      try {
        const tokenBBalance = await connection.getTokenAccountBalance(userTokenB);
        finalUsdcBalance = tokenBBalance.value.uiAmount || 0;
      } catch (e) {
        console.log('No final USDC token balance');
      }

      console.log('\nFinal balances:');
      console.log('  SOL tokens:', finalSolBalance);
      console.log('  USDC tokens:', finalUsdcBalance);

      const solSwapped = initialSolBalance - finalSolBalance;
      const usdcReceived = finalUsdcBalance - initialUsdcBalance;

      if (solSwapped > 0 || usdcReceived > 0) {
        console.log('\nSwap summary:');
        console.log(`  Sent: ${solSwapped} SOL`);
        console.log(`  Received: ${usdcReceived} USDC`);
      }

      // Check final order state
      const finalOrderState = await client.getOrderState(userKeypair.publicKey, submitResult.sequence);
      if (finalOrderState) {
        console.log('\nFinal order status:', finalOrderState.status === 1 ? 'EXECUTED' : 'PENDING');
      }

      // Check FIFO state
      const finalFifoState = await client.getFifoState();
      if (finalFifoState) {
        console.log('Final FIFO sequence:', finalFifoState.currentSequence.toString());
      }

      console.log('\n=== ✅ Test Complete! ===');
      console.log('Successfully demonstrated:');
      console.log('  1. Order submission to Continuum');
      console.log('  2. Ed25519 signature generation by relayer');
      console.log('  3. Signature verification on-chain');
      console.log('  4. Order execution with MEV protection');

    } catch (error: any) {
      console.error('\n❌ Execution failed:', error.message);

      // The error might be because the pool doesn't exist or isn't registered
      // Let's check if the pool is registered with Continuum
      console.log('\nChecking if pool is registered with Continuum...');

      const { getPoolRegistryPDA } = await import('../sdk/src/utils');
      const [poolRegistry] = getPoolRegistryPDA(POOL_ID);
      const registryAccount = await connection.getAccountInfo(poolRegistry);

      if (!registryAccount) {
        console.log('❌ Pool is not registered with Continuum!');
        console.log('The pool must be initialized through Continuum first.');
      } else {
        console.log('✅ Pool is registered with Continuum');
        console.log('Error might be due to other reasons:');
        if (error.logs) {
          console.log('\nTransaction logs:');
          error.logs.forEach((log: string) => console.log('  ', log));
        }
      }
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);