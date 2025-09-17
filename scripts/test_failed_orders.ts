import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  createMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from '@solana/spl-token';
import BN from 'bn.js';
import { getCpSwapPDAs } from '../sdk/src/instructions/initializeCpSwapPoolDirect';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== TEST: Failed Order Scenarios ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('/home/ubuntu/.config/solana/id.json'))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  try {
    // === Setup: Create Pool and Tokens ===
    console.log('=== Setup: Creating Pool and Tokens ===');

    const tokenAMint = await createMint(
      connection,
      userKeypair,
      userKeypair.publicKey,
      userKeypair.publicKey,
      9
    );
    console.log('Token A:', tokenAMint.toBase58());

    const tokenBMint = await createMint(
      connection,
      userKeypair,
      userKeypair.publicKey,
      userKeypair.publicKey,
      6
    );
    console.log('Token B:', tokenBMint.toBase58());

    // Setup AMM Config
    const ammConfigIndex = 0;
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(ammConfigIndex);

    const [ammConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      CP_SWAP_PROGRAM_ID
    );

    // Get CP-Swap PDAs
    const cpSwapPDAs = getCpSwapPDAs(tokenAMint, tokenBMint, ammConfig);
    console.log('Pool State:', cpSwapPDAs.poolState.toBase58());

    // Get CTM Wrapper pool authority
    const [continuumPoolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );

    // Create token accounts
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, userKeypair.publicKey);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, userKeypair.publicKey);
    const userLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, userKeypair.publicKey);

    const createATATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        creatorToken0,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken0
      ),
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        creatorToken1,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken1
      )
    );

    await sendAndConfirmTransaction(connection, createATATx, [userKeypair]);

    // Mint initial tokens - limited amount for testing
    const mintTx = new Transaction().add(
      createMintToInstruction(
        cpSwapPDAs.sortedToken0,
        creatorToken0,
        userKeypair.publicKey,
        200 * 10 ** 9 // Only 200 tokens for testing
      ),
      createMintToInstruction(
        cpSwapPDAs.sortedToken1,
        creatorToken1,
        userKeypair.publicKey,
        200 * 10 ** 6
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
    console.log('✅ Minted limited tokens for testing\n');

    // Initialize pool
    const feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
    const createPoolFee = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, feeOwner);

    const feeAccountInfo = await connection.getAccountInfo(createPoolFee);
    if (!feeAccountInfo) {
      const createFeeAccountTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
          userKeypair.publicKey,
          createPoolFee,
          feeOwner,
          cpSwapPDAs.sortedToken0
        )
      );
      await sendAndConfirmTransaction(connection, createFeeAccountTx, [userKeypair]);
    }

    // Fund authority
    const authorityInfo = await connection.getAccountInfo(continuumPoolAuthority);
    if (!authorityInfo || authorityInfo.lamports < 1000000) {
      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: userKeypair.publicKey,
          toPubkey: continuumPoolAuthority,
          lamports: 2000000,
        })
      );
      await sendAndConfirmTransaction(connection, fundTx, [userKeypair]);
    }

    // Initialize pool
    const initAmount0 = new BN(100 * 10 ** 9);
    const initAmount1 = new BN(100 * 10 ** 6);
    const openTime = new BN(0);

    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);
    const authorityType = Buffer.from([1]);
    const optionTag = Buffer.from([1]);

    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
      authorityType,
      optionTag,
      continuumPoolAuthority.toBuffer(),
    ]);

    const initPoolAccounts = [
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true },
      { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true },
      { pubkey: creatorToken0, isSigner: false, isWritable: true },
      { pubkey: creatorToken1, isSigner: false, isWritable: true },
      { pubkey: userLpToken, isSigner: false, isWritable: true },
      { pubkey: cpSwapPDAs.vault0, isSigner: false, isWritable: true },
      { pubkey: cpSwapPDAs.vault1, isSigner: false, isWritable: true },
      { pubkey: createPoolFee, isSigner: false, isWritable: true },
      { pubkey: cpSwapPDAs.observationState, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];

    const initPoolIx = new TransactionInstruction({
      keys: initPoolAccounts,
      programId: CP_SWAP_PROGRAM_ID,
      data: instructionData,
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initPoolIx
    );

    await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair]);
    console.log('✅ Pool initialized');

    // Register pool
    const [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      CONTINUUM_PROGRAM_ID
    );

    const [poolRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );

    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update('global:register_pool')
      .digest();
    const registerDiscriminator = hash.slice(0, 8);

    const registerData = Buffer.concat([
      registerDiscriminator,
      cpSwapPDAs.sortedToken0.toBuffer(),
      cpSwapPDAs.sortedToken1.toBuffer(),
    ]);

    const registerAccounts = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: false },
      { pubkey: poolRegistry, isSigner: false, isWritable: true },
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: false },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const registerIx = new TransactionInstruction({
      keys: registerAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: registerData,
    });

    const registerTx = new Transaction().add(registerIx);
    await sendAndConfirmTransaction(connection, registerTx, [userKeypair]);
    console.log('✅ Pool registered\n');

    // Check balances
    const token0Balance = await getAccount(connection, creatorToken0);
    const token1Balance = await getAccount(connection, creatorToken1);
    console.log('Current balances:');
    console.log(`  Token 0: ${Number(token0Balance.amount) / 10**9}`);
    console.log(`  Token 1: ${Number(token1Balance.amount) / 10**6}\n`);

    // === Test 1: Insufficient Funds ===
    console.log('=== Test 1: Insufficient Funds ===');
    console.log('Attempting to swap more tokens than available...');

    const fifoStateAccount = await connection.getAccountInfo(fifoStatePDA);
    let currentSequence = new BN(fifoStateAccount!.data.slice(8, 16), 'le');

    const [orderStatePDA1] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Try to swap 500 tokens when we only have 100 (after pool init)
    const swapAmountIn1 = new BN(500 * 10 ** 9); // More than available!
    const minAmountOut1 = new BN(450 * 10 ** 6);

    const submitHash = crypto.createHash('sha256')
      .update('global:submit_order')
      .digest();
    const submitDiscriminator = submitHash.slice(0, 8);

    const submitData1 = Buffer.concat([
      submitDiscriminator,
      swapAmountIn1.toArrayLike(Buffer, 'le', 8),
      minAmountOut1.toArrayLike(Buffer, 'le', 8),
      Buffer.from([1]), // is_base_input = true
    ]);

    const submitAccounts1 = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: true },
      { pubkey: poolRegistry, isSigner: false, isWritable: false },
      { pubkey: orderStatePDA1, isSigner: false, isWritable: true },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ];

    const submitIx1 = new TransactionInstruction({
      keys: submitAccounts1,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData1,
    });

    const submitTx1 = new Transaction().add(submitIx1);

    try {
      await sendAndConfirmTransaction(connection, submitTx1, [userKeypair]);
      console.log('✅ Order submitted (will fail on execution due to insufficient funds)');
      console.log('  Sequence:', currentSequence.toString());
    } catch (error: any) {
      console.log('❌ Failed to submit order:', error.message);
    }

    console.log('');

    // === Test 2: Tight Slippage (Impossible Min Output) ===
    console.log('=== Test 2: Tight Slippage Tolerance ===');
    console.log('Attempting swap with impossible minimum output...');

    // Update sequence for next order
    const fifoStateAccount2 = await connection.getAccountInfo(fifoStatePDA);
    currentSequence = new BN(fifoStateAccount2!.data.slice(8, 16), 'le');

    const [orderStatePDA2] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Swap 10 token0 but demand 100 token1 (impossible!)
    const swapAmountIn2 = new BN(10 * 10 ** 9);
    const minAmountOut2 = new BN(100 * 10 ** 6); // Impossible output!

    const submitData2 = Buffer.concat([
      submitDiscriminator,
      swapAmountIn2.toArrayLike(Buffer, 'le', 8),
      minAmountOut2.toArrayLike(Buffer, 'le', 8),
      Buffer.from([1]),
    ]);

    const submitAccounts2 = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: true },
      { pubkey: poolRegistry, isSigner: false, isWritable: false },
      { pubkey: orderStatePDA2, isSigner: false, isWritable: true },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ];

    const submitIx2 = new TransactionInstruction({
      keys: submitAccounts2,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData2,
    });

    const submitTx2 = new Transaction().add(submitIx2);

    try {
      await sendAndConfirmTransaction(connection, submitTx2, [userKeypair]);
      console.log('✅ Order submitted (will fail on execution due to slippage)');
      console.log('  Sequence:', currentSequence.toString());
    } catch (error: any) {
      console.log('❌ Failed to submit order:', error.message);
    }

    console.log('');

    // === Test 3: Valid Order for Comparison ===
    console.log('=== Test 3: Valid Order (Control Test) ===');
    console.log('Submitting a valid order for comparison...');

    const fifoStateAccount3 = await connection.getAccountInfo(fifoStatePDA);
    currentSequence = new BN(fifoStateAccount3!.data.slice(8, 16), 'le');

    const [orderStatePDA3] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Valid swap: 10 token0 for ~9 token1
    const swapAmountIn3 = new BN(10 * 10 ** 9);
    const minAmountOut3 = new BN(9 * 10 ** 6);

    const submitData3 = Buffer.concat([
      submitDiscriminator,
      swapAmountIn3.toArrayLike(Buffer, 'le', 8),
      minAmountOut3.toArrayLike(Buffer, 'le', 8),
      Buffer.from([1]),
    ]);

    const submitAccounts3 = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: true },
      { pubkey: poolRegistry, isSigner: false, isWritable: false },
      { pubkey: orderStatePDA3, isSigner: false, isWritable: true },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ];

    const submitIx3 = new TransactionInstruction({
      keys: submitAccounts3,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData3,
    });

    const submitTx3 = new Transaction().add(submitIx3);

    try {
      await sendAndConfirmTransaction(connection, submitTx3, [userKeypair]);
      console.log('✅ Valid order submitted successfully');
      console.log('  Sequence:', currentSequence.toString());
    } catch (error: any) {
      console.log('❌ Failed to submit order:', error.message);
    }

    // === Summary ===
    console.log('\n=== TEST SUMMARY ===');
    console.log('Submitted 3 orders:');
    console.log('  1. Insufficient funds order - Will fail on execution');
    console.log('  2. Tight slippage order - Will fail on execution');
    console.log('  3. Valid order - Should execute successfully');
    console.log('\nMonitor relayer logs to see execution attempts and failures.');
    console.log('Expected behavior:');
    console.log('  - Orders 1 & 2 should fail with specific error messages');
    console.log('  - Order 3 should execute successfully');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main();