import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from '@solana/web3.js';
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount
} from '@solana/spl-token';
import { ContinuumClient } from '../sdk/src';
import {
  createExecuteOrderInstructionsWithSignature,
  createInitializeCpSwapPoolInstruction
} from '../sdk/src/instructions';
import {
  getPoolRegistryPDA,
  getPoolAuthorityPDA,
  getFifoStatePDA,
  getOrderPDA
} from '../sdk/src/utils';
import BN from 'bn.js';
import fs from 'fs';

const CONTINUUM_PROGRAM_ID = new PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function airdropIfNeeded(connection: Connection, pubkey: PublicKey, minBalance: number) {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    console.log(`Airdropping to ${pubkey.toBase58()}...`);
    const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    console.log(`Airdropped 2 SOL, new balance: ${await connection.getBalance(pubkey) / LAMPORTS_PER_SOL} SOL`);
  }
}

async function main() {
  console.log('=== Full Integration Test with Real Accounts ===\n');

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

    // === Step 1: Setup wallets with SOL ===
    console.log('\n=== Step 1: Setup Wallets ===');
    await airdropIfNeeded(connection, userKeypair.publicKey, LAMPORTS_PER_SOL);
    await airdropIfNeeded(connection, relayerKeypair.publicKey, 0.5 * LAMPORTS_PER_SOL);

    // === Step 2: Create test tokens ===
    console.log('\n=== Step 2: Creating Test Tokens ===');

    // Create Token A
    const tokenAMint = Keypair.generate();
    console.log('Creating Token A mint:', tokenAMint.publicKey.toBase58());

    const createTokenATx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: userKeypair.publicKey,
        newAccountPubkey: tokenAMint.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        tokenAMint.publicKey,
        9, // decimals
        userKeypair.publicKey, // mint authority
        userKeypair.publicKey  // freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, createTokenATx, [userKeypair, tokenAMint]);
    console.log('Token A created');

    // Create Token B
    const tokenBMint = Keypair.generate();
    console.log('Creating Token B mint:', tokenBMint.publicKey.toBase58());

    const createTokenBTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: userKeypair.publicKey,
        newAccountPubkey: tokenBMint.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        tokenBMint.publicKey,
        6, // decimals
        userKeypair.publicKey,
        userKeypair.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createTokenBTx, [userKeypair, tokenBMint]);
    console.log('Token B created');

    // === Step 3: Create token accounts and mint tokens ===
    console.log('\n=== Step 3: Creating Token Accounts and Minting ===');

    // Create user token accounts
    const userTokenA = getAssociatedTokenAddressSync(tokenAMint.publicKey, userKeypair.publicKey);
    const userTokenB = getAssociatedTokenAddressSync(tokenBMint.publicKey, userKeypair.publicKey);

    const createATATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        userTokenA,
        userKeypair.publicKey,
        tokenAMint.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        userTokenB,
        userKeypair.publicKey,
        tokenBMint.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createATATx, [userKeypair]);
    console.log('User token accounts created');

    // Mint tokens to user
    const mintTx = new Transaction().add(
      createMintToInstruction(
        tokenAMint.publicKey,
        userTokenA,
        userKeypair.publicKey,
        1000 * 10 ** 9 // 1000 Token A
      ),
      createMintToInstruction(
        tokenBMint.publicKey,
        userTokenB,
        userKeypair.publicKey,
        1000 * 10 ** 6 // 1000 Token B
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
    console.log('Minted tokens to user');

    // === Step 4: Initialize CP-Swap Pool ===
    console.log('\n=== Step 4: Initializing CP-Swap Pool ===');

    // Generate pool ID
    const poolId = Keypair.generate();
    console.log('Pool ID:', poolId.publicKey.toBase58());

    // Get pool authority PDA for Continuum
    const [poolAuthority, poolAuthorityBump] = getPoolAuthorityPDA(poolId.publicKey);
    console.log('Pool Authority (Continuum):', poolAuthority.toBase58());

    // Create pool token accounts for the authority
    const poolTokenA = getAssociatedTokenAddressSync(tokenAMint.publicKey, poolAuthority, true);
    const poolTokenB = getAssociatedTokenAddressSync(tokenBMint.publicKey, poolAuthority, true);

    // Create pool authority token accounts
    const createPoolATATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        poolTokenA,
        poolAuthority,
        tokenAMint.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        poolTokenB,
        poolAuthority,
        tokenBMint.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createPoolATATx, [userKeypair]);
    console.log('Pool authority token accounts created');

    // Transfer initial liquidity to pool authority accounts
    const transferLiquidityTx = new Transaction().add(
      createMintToInstruction(
        tokenAMint.publicKey,
        poolTokenA,
        userKeypair.publicKey,
        100 * 10 ** 9 // 100 Token A
      ),
      createMintToInstruction(
        tokenBMint.publicKey,
        poolTokenB,
        userKeypair.publicKey,
        100 * 10 ** 6 // 100 Token B
      )
    );

    await sendAndConfirmTransaction(connection, transferLiquidityTx, [userKeypair]);
    console.log('Initial liquidity transferred to pool');

    // === Step 5: Register Pool with Continuum ===
    console.log('\n=== Step 5: Registering Pool with Continuum ===');

    const initPoolIx = createInitializeCpSwapPoolInstruction({
      admin: userKeypair.publicKey,
      poolState: poolId.publicKey,
      initAmount0: new BN(100 * 10 ** 9),
      initAmount1: new BN(100 * 10 ** 6),
      openTime: new BN(0),
      cpSwapAccounts: [
        tokenAMint.publicKey,  // token0 mint
        tokenBMint.publicKey,  // token1 mint
        poolTokenA,            // token0 vault
        poolTokenB,            // token1 vault
      ]
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      initPoolIx
    );

    await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair, poolId]);
    console.log('Pool registered with Continuum');

    // === Step 6: Submit Order ===
    console.log('\n=== Step 6: Submitting Order ===');

    const submitResult = await client.submitOrder(userKeypair, {
      poolId: poolId.publicKey,
      amountIn: new BN(10 * 10 ** 9), // 10 Token A
      minAmountOut: new BN(9 * 10 ** 6), // Min 9 Token B
      isBaseInput: true,
      userSourceToken: userTokenA,
      userDestinationToken: userTokenB
    });

    console.log('Order submitted!');
    console.log('  Signature:', submitResult.signature);
    console.log('  Sequence:', submitResult.sequence.toString());

    // Get order state
    const orderState = await client.getOrderState(userKeypair.publicKey, submitResult.sequence);
    if (!orderState) {
      throw new Error('Failed to get order state');
    }

    console.log('Order State:');
    console.log('  Status:', orderState.status);
    console.log('  Amount In:', orderState.amountIn.toString());
    console.log('  Min Amount Out:', orderState.minAmountOut.toString());

    // === Step 7: Execute Order with Ed25519 Signature ===
    console.log('\n=== Step 7: Executing Order with Ed25519 Signature ===');

    // Create execute order instructions with Ed25519 precompile
    const executeOrderInstructions = createExecuteOrderInstructionsWithSignature(
      {
        executor: relayerKeypair.publicKey,
        orderUser: userKeypair.publicKey,
        sequence: submitResult.sequence,
        poolId: poolId.publicKey,
        userSource: userTokenA,
        userDestination: userTokenB,
        cpSwapRemainingAccounts: [
          // Add CP-Swap specific accounts
          poolId.publicKey, // pool state account
          poolTokenA,       // vault 0
          poolTokenB,       // vault 1
        ],
      },
      relayerKeypair
    );

    console.log('Created execute order instructions:');
    console.log('  1. Ed25519 verification instruction');
    console.log('  2. Execute order instruction');

    // Build and send transaction
    const executeTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...executeOrderInstructions
    );

    // Get initial balances
    const initialBalanceA = await connection.getTokenAccountBalance(userTokenA);
    const initialBalanceB = await connection.getTokenAccountBalance(userTokenB);
    console.log('\nInitial balances:');
    console.log('  Token A:', initialBalanceA.value.uiAmount);
    console.log('  Token B:', initialBalanceB.value.uiAmount);

    console.log('\nExecuting order...');
    const executeSig = await sendAndConfirmTransaction(
      connection,
      executeTx,
      [relayerKeypair],
      { commitment: 'confirmed' }
    );

    console.log('✅ Order executed successfully!');
    console.log('  Signature:', executeSig);

    // Get final balances
    const finalBalanceA = await connection.getTokenAccountBalance(userTokenA);
    const finalBalanceB = await connection.getTokenAccountBalance(userTokenB);
    console.log('\nFinal balances:');
    console.log('  Token A:', finalBalanceA.value.uiAmount);
    console.log('  Token B:', finalBalanceB.value.uiAmount);

    // Calculate swap amounts
    const swappedA = (initialBalanceA.value.uiAmount || 0) - (finalBalanceA.value.uiAmount || 0);
    const receivedB = (finalBalanceB.value.uiAmount || 0) - (initialBalanceB.value.uiAmount || 0);
    console.log('\nSwap summary:');
    console.log(`  Sent: ${swappedA} Token A`);
    console.log(`  Received: ${receivedB} Token B`);

    // Check final order state
    const finalOrderState = await client.getOrderState(userKeypair.publicKey, submitResult.sequence);
    if (finalOrderState) {
      console.log('\nFinal order status:', finalOrderState.status === 1 ? 'EXECUTED' : finalOrderState.status);
    }

    // Check final FIFO state
    const finalFifoState = await client.getFifoState();
    if (finalFifoState) {
      console.log('Final FIFO sequence:', finalFifoState.currentSequence.toString());
    }

    console.log('\n=== ✅ Full Integration Test Completed Successfully! ===');
    console.log('The complete flow works:');
    console.log('  1. Created SPL tokens');
    console.log('  2. Initialized CP-Swap pool with liquidity');
    console.log('  3. Registered pool with Continuum');
    console.log('  4. Submitted order through Continuum');
    console.log('  5. Executed order with relayer Ed25519 signature');
    console.log('  6. Successfully swapped tokens!');

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