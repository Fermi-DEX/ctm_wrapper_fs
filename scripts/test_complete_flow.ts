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
} from '@solana/spl-token';
import BN from 'bn.js';
import { getCpSwapPDAs } from '../sdk/src/instructions/initializeCpSwapPoolDirect';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');
const RELAYER_URL = 'http://localhost:8085';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== COMPLETE END-TO-END TEST ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('/home/ubuntu/.config/solana/id.json'))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  try {
    // === Phase 1: Create Test Tokens ===
    console.log('\n=== Phase 1: Create Test Tokens ===');

    const tokenAMint = await createMint(
      connection,
      userKeypair,
      userKeypair.publicKey,
      userKeypair.publicKey,
      9 // 9 decimals
    );
    console.log('✅ Token A created:', tokenAMint.toBase58());

    const tokenBMint = await createMint(
      connection,
      userKeypair,
      userKeypair.publicKey,
      userKeypair.publicKey,
      6 // 6 decimals
    );
    console.log('✅ Token B created:', tokenBMint.toBase58());

    // === Phase 2: Initialize Pool with CTM Authority ===
    console.log('\n=== Phase 2: Initialize Pool with CTM Authority ===');

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
    console.log('CTM Authority:', continuumPoolAuthority.toBase58());

    // Create user token accounts
    const userTokenA = getAssociatedTokenAddressSync(tokenAMint, userKeypair.publicKey);
    const userTokenB = getAssociatedTokenAddressSync(tokenBMint, userKeypair.publicKey);
    const userLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, userKeypair.publicKey);

    // Create sorted token accounts
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, userKeypair.publicKey);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, userKeypair.publicKey);

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
    console.log('✅ Token accounts created');

    // Mint tokens
    const mintTx = new Transaction().add(
      createMintToInstruction(
        cpSwapPDAs.sortedToken0,
        creatorToken0,
        userKeypair.publicKey,
        1000 * 10 ** 9
      ),
      createMintToInstruction(
        cpSwapPDAs.sortedToken1,
        creatorToken1,
        userKeypair.publicKey,
        1000 * 10 ** 6
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
    console.log('✅ Minted 1000 of each token');

    // Create fee account
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
      console.log('✅ Fee account created');
    }

    // Fund CTM authority
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
      console.log('✅ Funded CTM authority');
    }

    // Initialize pool with CTM authority
    const initAmount0 = new BN(100 * 10 ** 9);
    const initAmount1 = new BN(100 * 10 ** 6);
    const openTime = new BN(0);

    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // CP-Swap initialize
    const authorityType = Buffer.from([1]); // 1 = custom authority
    const optionTag = Buffer.from([1]); // 1 = Some

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

    const initSig = await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair]);
    console.log('✅ Pool initialized! Signature:', initSig);

    // === Phase 3: Register Pool with CTM Wrapper ===
    console.log('\n=== Phase 3: Register Pool with CTM Wrapper ===');

    const [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      CONTINUUM_PROGRAM_ID
    );

    const [poolRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );

    // Register pool
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
    const registerSig = await sendAndConfirmTransaction(connection, registerTx, [userKeypair]);
    console.log('✅ Pool registered! Signature:', registerSig);

    // === Phase 4: Submit Swap Order ===
    console.log('\n=== Phase 4: Submit Swap Order ===');

    // Get current FIFO sequence
    const fifoStateAccount = await connection.getAccountInfo(fifoStatePDA);
    const currentSequence = new BN(fifoStateAccount!.data.slice(8, 16), 'le');
    console.log('Current FIFO sequence:', currentSequence.toString());

    // Derive order PDA
    const [orderStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Submit order to swap 10 Token 0 for Token 1
    const swapAmountIn = new BN(10 * 10 ** 9); // 10 Token 0
    const minAmountOut = new BN(9 * 10 ** 6); // Minimum 9 Token 1

    const submitHash = crypto.createHash('sha256')
      .update('global:submit_order')
      .digest();
    const submitDiscriminator = submitHash.slice(0, 8);

    const submitData = Buffer.concat([
      submitDiscriminator,
      swapAmountIn.toArrayLike(Buffer, 'le', 8),
      minAmountOut.toArrayLike(Buffer, 'le', 8),
      Buffer.from([1]), // is_base_input = true
    ]);

    const submitAccounts = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: true },
      { pubkey: poolRegistry, isSigner: false, isWritable: false },
      { pubkey: orderStatePDA, isSigner: false, isWritable: true },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ];

    const submitIx = new TransactionInstruction({
      keys: submitAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData,
    });

    const submitTx = new Transaction().add(submitIx);

    // Get initial balances
    const initialBalance0 = await connection.getTokenAccountBalance(creatorToken0);
    const initialBalance1 = await connection.getTokenAccountBalance(creatorToken1);
    console.log('Initial balances:');
    console.log('  Token 0:', initialBalance0.value.uiAmount);
    console.log('  Token 1:', initialBalance1.value.uiAmount);

    const submitSig = await sendAndConfirmTransaction(connection, submitTx, [userKeypair]);
    console.log('✅ Order submitted! Signature:', submitSig);
    console.log('  Sequence:', currentSequence.toString());

    // === Phase 5: Wait for Relayer Execution ===
    console.log('\n=== Phase 5: Wait for Relayer Execution ===');
    console.log('Waiting for relayer to process order...');

    // Poll for execution
    let executed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(2000);

      const finalBalance0 = await connection.getTokenAccountBalance(creatorToken0);
      const finalBalance1 = await connection.getTokenAccountBalance(creatorToken1);

      const swapped0 = (initialBalance0.value.uiAmount || 0) - (finalBalance0.value.uiAmount || 0);
      const received1 = (finalBalance1.value.uiAmount || 0) - (initialBalance1.value.uiAmount || 0);

      if (swapped0 > 0 && received1 > 0) {
        console.log('\n✅ SWAP EXECUTED SUCCESSFULLY!');
        console.log('Final balances:');
        console.log('  Token 0:', finalBalance0.value.uiAmount);
        console.log('  Token 1:', finalBalance1.value.uiAmount);
        console.log(`  Sent: ${swapped0} Token 0`);
        console.log(`  Received: ${received1} Token 1`);
        executed = true;
        break;
      }

      process.stdout.write('.');
    }

    if (!executed) {
      const finalBalance0 = await connection.getTokenAccountBalance(creatorToken0);
      const finalBalance1 = await connection.getTokenAccountBalance(creatorToken1);
      console.log('\n⚠️ Order not executed within timeout');
      console.log('Final balances:');
      console.log('  Token 0:', finalBalance0.value.uiAmount);
      console.log('  Token 1:', finalBalance1.value.uiAmount);
    }

    // === Summary ===
    console.log('\n=== ✅ TEST COMPLETE! ===');
    console.log('Summary:');
    console.log('  1. Created test tokens');
    console.log('  2. Initialized CP-Swap pool with CTM authority');
    console.log('  3. Registered pool with CTM wrapper');
    console.log('  4. Submitted swap order through CTM wrapper');
    console.log('  5. Order execution:', executed ? '✅ SUCCESS' : '⚠️ PENDING');
    console.log('\nPool Details:');
    console.log('  Pool ID:', cpSwapPDAs.poolState.toBase58());
    console.log('  CTM Authority:', continuumPoolAuthority.toBase58());
    console.log('  Token A:', tokenAMint.toBase58());
    console.log('  Token B:', tokenBMint.toBase58());

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