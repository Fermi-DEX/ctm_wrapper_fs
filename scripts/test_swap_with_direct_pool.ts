import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';
import BN from 'bn.js';

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');
const RELAYER_URL = 'http://localhost:8082';

// Use the pool we just created
const POOL_ID = new PublicKey('3cE6Bzs85Mayba6RPBaEVZgNGzLw4XT2DviYZnT1kj63');
const TOKEN_0 = new PublicKey('4PYRa2DbfD9is59ZVDoGdagNQjBVSM8Pxp45yvJkD3Yf');
const TOKEN_1 = new PublicKey('FMme6oE1CJjfRH5G3KK69kfpRSeVFBrvVZsp3j7Zp5sp');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Test: Swap with Direct-Initialized Pool ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair
  const userKeypair = Keypair.fromSecretKey(
    Uint8Array.from(require('/home/ubuntu/.config/solana/id.json'))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());
  console.log('Pool ID:', POOL_ID.toBase58());

  try {
    // === Phase 1: Manual Pool Registration ===
    console.log('=== Phase 1: Manual Pool Registration ===');

    // Derive pool registry PDA
    const [poolRegistry, registryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_registry'), POOL_ID.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('Pool Registry PDA:', poolRegistry.toBase58());

    // Check if already registered
    const registryAccount = await connection.getAccountInfo(poolRegistry);
    if (registryAccount) {
      console.log('✅ Pool already registered');
    } else {
      console.log('Registering pool manually...');

      // We need to call an instruction that creates this account
      // Since there's no separate registration, we'll skip to testing swaps
      console.log('⚠️  Cannot register pool without wrapper initialization');
      console.log('The pool must be initialized through CTM wrapper to be usable');
      return;
    }

    // === Phase 2: Prepare Token Accounts ===
    console.log('\n=== Phase 2: Prepare Token Accounts ===');

    // Create user token accounts if needed
    const userToken0 = getAssociatedTokenAddressSync(TOKEN_0, userKeypair.publicKey);
    const userToken1 = getAssociatedTokenAddressSync(TOKEN_1, userKeypair.publicKey);

    // Check if accounts exist
    const token0Account = await connection.getAccountInfo(userToken0);
    const token1Account = await connection.getAccountInfo(userToken1);

    if (!token0Account || !token1Account) {
      console.log('Creating token accounts...');
      const createATATx = new Transaction();

      if (!token0Account) {
        createATATx.add(
          createAssociatedTokenAccountInstruction(
            userKeypair.publicKey,
            userToken0,
            userKeypair.publicKey,
            TOKEN_0
          )
        );
      }

      if (!token1Account) {
        createATATx.add(
          createAssociatedTokenAccountInstruction(
            userKeypair.publicKey,
            userToken1,
            userKeypair.publicKey,
            TOKEN_1
          )
        );
      }

      if (createATATx.instructions.length > 0) {
        await sendAndConfirmTransaction(connection, createATATx, [userKeypair]);
        console.log('✅ Token accounts created');
      }
    }

    // Mint some tokens if balance is low
    const balance0 = await connection.getTokenAccountBalance(userToken0);
    const balance1 = await connection.getTokenAccountBalance(userToken1);

    console.log('Current balances:');
    console.log('  Token 0:', balance0.value.uiAmount);
    console.log('  Token 1:', balance1.value.uiAmount);

    if ((balance0.value.uiAmount || 0) < 100) {
      console.log('Minting Token 0...');
      const mintTx = new Transaction().add(
        createMintToInstruction(
          TOKEN_0,
          userToken0,
          userKeypair.publicKey,
          500 * 10 ** 9
        )
      );
      await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
      console.log('✅ Minted 500 Token 0');
    }

    if ((balance1.value.uiAmount || 0) < 100) {
      console.log('Minting Token 1...');
      const mintTx = new Transaction().add(
        createMintToInstruction(
          TOKEN_1,
          userToken1,
          userKeypair.publicKey,
          500 * 10 ** 6
        )
      );
      await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
      console.log('✅ Minted 500 Token 1');
    }

    // === Phase 3: Submit Swap Order ===
    console.log('\n=== Phase 3: Submit Swap Order ===');

    // Get FIFO state
    const [fifoStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('fifo_state')],
      CONTINUUM_PROGRAM_ID
    );

    const fifoStateAccount = await connection.getAccountInfo(fifoStatePDA);
    if (!fifoStateAccount) {
      console.error('CTM Wrapper not initialized');
      return;
    }

    const currentSequence = new BN(fifoStateAccount.data.slice(8, 16), 'le');
    console.log('Current FIFO sequence:', currentSequence.toString());

    // Derive order PDA
    const [orderStatePDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order'), userKeypair.publicKey.toBuffer(), currentSequence.toArrayLike(Buffer, 'le', 8)],
      CONTINUUM_PROGRAM_ID
    );

    // Submit order to swap 10 Token 0 for Token 1
    const swapAmountIn = new BN(10 * 10 ** 9); // 10 Token 0
    const minAmountOut = new BN(9 * 10 ** 6); // Minimum 9 Token 1

    // Calculate discriminator using Anchor's method
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256')
      .update('global:submit_order')
      .digest();
    const submitDiscriminator = hash.slice(0, 8);

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
      { pubkey: POOL_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('SysvarC1ock11111111111111111111111111111111'), isSigner: false, isWritable: false }, // clock
    ];

    const submitIx = new TransactionInstruction({
      keys: submitAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: submitData,
    });

    const submitTx = new Transaction().add(submitIx);

    console.log('Submitting swap order...');
    const submitSig = await sendAndConfirmTransaction(connection, submitTx, [userKeypair]);
    console.log('✅ Order submitted! Signature:', submitSig);
    console.log('  Sequence:', currentSequence.toString());

    // === Phase 4: Execute via Relayer ===
    console.log('\n=== Phase 4: Execute via Relayer ===');

    // Get initial balances
    const initialBalance0 = await connection.getTokenAccountBalance(userToken0);
    const initialBalance1 = await connection.getTokenAccountBalance(userToken1);

    console.log('Initial balances:');
    console.log('  Token 0:', initialBalance0.value.uiAmount);
    console.log('  Token 1:', initialBalance1.value.uiAmount);

    // Call relayer
    console.log('Calling relayer service...');
    try {
      const response = await fetch(`${RELAYER_URL}/api/process-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poolId: POOL_ID.toBase58() }),
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

    const finalBalance0 = await connection.getTokenAccountBalance(userToken0);
    const finalBalance1 = await connection.getTokenAccountBalance(userToken1);

    console.log('\nFinal balances:');
    console.log('  Token 0:', finalBalance0.value.uiAmount);
    console.log('  Token 1:', finalBalance1.value.uiAmount);

    const swapped0 = (initialBalance0.value.uiAmount || 0) - (finalBalance0.value.uiAmount || 0);
    const received1 = (finalBalance1.value.uiAmount || 0) - (initialBalance1.value.uiAmount || 0);

    if (swapped0 > 0 && received1 > 0) {
      console.log('\n✅ Swap executed successfully!');
      console.log(`  Sent: ${swapped0} Token 0`);
      console.log(`  Received: ${received1} Token 1`);
    } else {
      console.log('\n⚠️  Order pending execution');
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main();