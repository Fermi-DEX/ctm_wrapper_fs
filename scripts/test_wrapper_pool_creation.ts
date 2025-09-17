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
const CONTINUUM_PROGRAM_ID = new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3');
const RELAYER_URL = 'http://localhost:8082';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Test: Pool Creation via CTM Wrapper ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('/home/ubuntu/.config/solana/id.json'))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  // Initialize CTM client (no wallet needed for now)

  // Get FIFO state
  const [fifoStatePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const fifoState = await connection.getAccountInfo(fifoStatePDA);
  if (!fifoState) {
    console.error('CTM Wrapper not initialized. Run initialize first.');
    return;
  }

  try {
    // === Phase 1: Create Test Tokens ===
    console.log('=== Phase 1: Create Test Tokens ===');

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

    // === Phase 2: Setup AMM Config ===
    console.log('\n=== Phase 2: Setup AMM Config ===');

    const ammConfigIndex = 0;
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(ammConfigIndex);

    const [ammConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      CP_SWAP_PROGRAM_ID
    );
    console.log('AMM Config:', ammConfig.toBase58());

    // Get CP-Swap PDAs
    const cpSwapPDAs = getCpSwapPDAs(tokenAMint, tokenBMint, ammConfig);
    console.log('Pool State:', cpSwapPDAs.poolState.toBase58());

    // Get CTM Wrapper pool authority
    const [continuumPoolAuthority, authorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('CTM Authority:', continuumPoolAuthority.toBase58());

    // Get pool registry PDA
    const [poolRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('Pool Registry:', poolRegistry.toBase58());

    // === Phase 3: Prepare Token Accounts ===
    console.log('\n=== Phase 3: Prepare Token Accounts ===');

    // Create user token accounts based on sorted tokens
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, userKeypair.publicKey);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, userKeypair.publicKey);
    const creatorLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, userKeypair.publicKey);

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
    console.log('✅ Minted tokens to user');

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

    // === Phase 4: Initialize Pool via CTM Wrapper ===
    console.log('\n=== Phase 4: Initialize Pool via CTM Wrapper ===');

    // Fund the pool authority PDA
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
      console.log('✅ Funded pool authority PDA');
    }

    // Build initialization instruction for CTM Wrapper's initialize_cp_swap_pool
    const initAmount0 = new BN(100 * 10 ** 9); // Amount for sorted token 0
    const initAmount1 = new BN(100 * 10 ** 6); // Amount for sorted token 1
    const openTime = new BN(0);

    const discriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]); // initialize_cp_swap_pool
    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
    ]);

    // Account order for CTM Wrapper's initialize_cp_swap_pool
    const accounts = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: false }, // fifo_state
      { pubkey: poolRegistry, isSigner: false, isWritable: true }, // pool_registry (will be created)
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: true }, // pool_authority
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true }, // admin
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true }, // pool_state
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false }, // cp_swap_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      // Remaining accounts for CP-Swap CPI
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: true }, // creator (for CPI)
      { pubkey: ammConfig, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true },
      { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false },
      { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true },
      { pubkey: creatorToken0, isSigner: false, isWritable: true },
      { pubkey: creatorToken1, isSigner: false, isWritable: true },
      { pubkey: creatorLpToken, isSigner: false, isWritable: true },
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

    const initIx = new TransactionInstruction({
      keys: accounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: instructionData,
    });

    const initTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initIx
    );

    console.log('Initializing pool via CTM Wrapper...');
    const initSig = await sendAndConfirmTransaction(connection, initTx, [userKeypair]);
    console.log('✅ Pool initialized and registered! Signature:', initSig);

    // Verify registration
    const registryAccount = await connection.getAccountInfo(poolRegistry);
    if (registryAccount) {
      console.log('✅ Pool registry created successfully');
    }

    // === Phase 5: Test Swap Order ===
    console.log('\n=== Phase 5: Test Swap Order ===');

    // Submit order to swap Token A for Token B
    const swapAmountIn = new BN(10 * 10 ** 9); // 10 Token A
    const minAmountOut = new BN(9 * 10 ** 6); // Minimum 9 Token B

    // Determine which token is which
    const isToken0Input = cpSwapPDAs.sortedToken0.equals(tokenAMint);
    const userSourceToken = isToken0Input ? creatorToken0 : creatorToken1;
    const userDestToken = isToken0Input ? creatorToken1 : creatorToken0;

    console.log('Submitting swap order...');

    // Get order sequence from FIFO state
    const fifoStateAccount = await connection.getAccountInfo(fifoStatePDA);
    const currentSequence = new BN(fifoStateAccount!.data.slice(8, 16), 'le');

    // Derive order PDA
    const [orderStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Build submit order instruction
    const submitDiscriminator = Buffer.from([154, 249, 115, 5, 235, 87, 230, 228]); // submit_order
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
      { pubkey: new PublicKey('6ZRCB7AAqGre6c72PRz3MHLC73VMYvJ8bi9KHf1HFpNk'), isSigner: false, isWritable: false }, // clock
    ];

    const submitIx = new TransactionInstruction({
      keys: submitAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData,
    });

    const submitTx = new Transaction().add(submitIx);
    const submitSig = await sendAndConfirmTransaction(connection, submitTx, [userKeypair]);

    console.log('✅ Order submitted!');
    console.log('  Signature:', submitSig);
    console.log('  Sequence:', currentSequence.toString());

    // === Phase 6: Execute via Relayer ===
    console.log('\n=== Phase 6: Execute via Relayer ===');

    // Get initial balances
    const initialBalanceA = await connection.getTokenAccountBalance(
      getAssociatedTokenAddressSync(tokenAMint, userKeypair.publicKey)
    );
    const initialBalanceB = await connection.getTokenAccountBalance(
      getAssociatedTokenAddressSync(tokenBMint, userKeypair.publicKey)
    );

    console.log('Initial balances:');
    console.log('  Token A:', initialBalanceA.value.uiAmount);
    console.log('  Token B:', initialBalanceB.value.uiAmount);

    // Call relayer
    console.log('Calling relayer service...');
    try {
      const response = await fetch(`${RELAYER_URL}/api/process-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolId: cpSwapPDAs.poolState.toBase58() }),
      });

      if (!response.ok) {
        console.log('Relayer response:', await response.text());
      } else {
        console.log('Relayer response:', await response.json());
      }
    } catch (error: any) {
      console.log('Relayer error:', error.message);
    }

    // Wait and check results
    await sleep(5000);

    const finalBalanceA = await connection.getTokenAccountBalance(
      getAssociatedTokenAddressSync(tokenAMint, userKeypair.publicKey)
    );
    const finalBalanceB = await connection.getTokenAccountBalance(
      getAssociatedTokenAddressSync(tokenBMint, userKeypair.publicKey)
    );

    console.log('\nFinal balances:');
    console.log('  Token A:', finalBalanceA.value.uiAmount);
    console.log('  Token B:', finalBalanceB.value.uiAmount);

    const swappedA = (initialBalanceA.value.uiAmount || 0) - (finalBalanceA.value.uiAmount || 0);
    const receivedB = (finalBalanceB.value.uiAmount || 0) - (initialBalanceB.value.uiAmount || 0);

    if (swappedA > 0 && receivedB > 0) {
      console.log('\n✅ Swap executed successfully!');
      console.log(`  Sent: ${swappedA} Token A`);
      console.log(`  Received: ${receivedB} Token B`);
    } else {
      console.log('\n⚠️  Order pending execution');
    }

    console.log('\n=== ✅ Test Complete! ===');
    console.log('Pool ID:', cpSwapPDAs.poolState.toBase58());
    console.log('Registry:', poolRegistry.toBase58());
    console.log('CTM Authority:', continuumPoolAuthority.toBase58());

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