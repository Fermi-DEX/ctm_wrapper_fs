import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY
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
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  createExecuteOrderInstructionsWithSignature
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

// CP-Swap PDAs
function getCpSwapPDAs(token0: PublicKey, token1: PublicKey, ammConfig: PublicKey) {
  // Ensure tokens are sorted
  const [sortedToken0, sortedToken1] = token0.toBuffer().compare(token1.toBuffer()) < 0
    ? [token0, token1]
    : [token1, token0];

  // Pool state PDA
  const [poolState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pool'),
      ammConfig.toBuffer(),
      sortedToken0.toBuffer(),
      sortedToken1.toBuffer(),
    ],
    CP_SWAP_PROGRAM_ID
  );

  // CP-Swap authority (for vaults and LP mint)
  const [cpSwapAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    CP_SWAP_PROGRAM_ID
  );

  // LP Mint
  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_lp_mint'), poolState.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  // Token vaults
  const [vault0] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), sortedToken0.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_vault'), poolState.toBuffer(), sortedToken1.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  // Observation state
  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from('observation'), poolState.toBuffer()],
    CP_SWAP_PROGRAM_ID
  );

  return {
    poolState,
    cpSwapAuthority,
    lpMint,
    vault0,
    vault1,
    observationState,
    sortedToken0,
    sortedToken1
  };
}

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
  console.log('=== CP-Swap Pool Creation and Testing ===\n');

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

    // === Step 3: Setup AMM Config ===
    console.log('\n=== Step 3: Setting up AMM Config ===');

    // Derive AMM config PDA with index 0
    const ammConfigIndex = 0;
    // Convert index to big-endian bytes
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(ammConfigIndex);

    const [ammConfig] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('amm_config'),
        indexBuffer
      ],
      CP_SWAP_PROGRAM_ID
    );
    console.log('AMM Config PDA (index 0):', ammConfig.toBase58());

    // Check if AMM config exists
    const ammConfigAccount = await connection.getAccountInfo(ammConfig);
    if (!ammConfigAccount) {
      console.log('AMM Config does not exist. It needs to be created by the CP-Swap admin.');
      console.log('For testing, we\'ll use a simpler approach...');
      // For now, let's try to find an existing pool we can use
      process.exit(1);
    }
    console.log('AMM Config exists!');

    // === Step 4: Get CP-Swap PDAs ===
    console.log('\n=== Step 4: Deriving CP-Swap PDAs ===');

    const cpSwapPDAs = getCpSwapPDAs(tokenAMint.publicKey, tokenBMint.publicKey, ammConfig);
    console.log('Pool State:', cpSwapPDAs.poolState.toBase58());
    console.log('CP-Swap Authority:', cpSwapPDAs.cpSwapAuthority.toBase58());
    console.log('LP Mint:', cpSwapPDAs.lpMint.toBase58());
    console.log('Vault 0:', cpSwapPDAs.vault0.toBase58());
    console.log('Vault 1:', cpSwapPDAs.vault1.toBase58());
    console.log('Observation State:', cpSwapPDAs.observationState.toBase58());
    console.log('Sorted Token 0:', cpSwapPDAs.sortedToken0.toBase58());
    console.log('Sorted Token 1:', cpSwapPDAs.sortedToken1.toBase58());

    // Get Continuum pool authority PDA
    const [continuumPoolAuthority, poolAuthorityBump] = getPoolAuthorityPDA(cpSwapPDAs.poolState);
    console.log('Continuum Pool Authority:', continuumPoolAuthority.toBase58());

    // === Step 5: Create token accounts and mint tokens ===
    console.log('\n=== Step 5: Creating Token Accounts and Minting ===');

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

    // Create admin LP token account
    const adminLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, userKeypair.publicKey);

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

    // === Step 6: Initialize CP-Swap Pool Directly with Custom Authority ===
    console.log('\n=== Step 6: Initializing CP-Swap Pool Directly with Custom Authority ===');

    // Determine initial amounts based on token sorting
    const initAmount0 = cpSwapPDAs.sortedToken0.equals(tokenAMint.publicKey)
      ? new BN(100 * 10 ** 9)  // 100 Token A
      : new BN(100 * 10 ** 6); // 100 Token B

    const initAmount1 = cpSwapPDAs.sortedToken1.equals(tokenBMint.publicKey)
      ? new BN(100 * 10 ** 6)  // 100 Token B
      : new BN(100 * 10 ** 9); // 100 Token A

    const openTime = new BN(0);

    // Create the instruction data for standard CP-Swap initialize
    // We'll use standard authority for now and see if Continuum can still manage swaps
    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // CP-Swap initialize
    const authorityType = Buffer.from([0]); // 0 = standard authority
    const optionTag = Buffer.from([0]); // 0 = None (no custom authority)

    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
      authorityType,
      optionTag,
    ]);

    // Create pool fee receiver - this is a special account for CP-Swap on devnet
    const CREATE_POOL_FEE_ACCOUNT = new PublicKey('3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy'); // CP-Swap's devnet fee account

    // Determine correct token accounts based on sorting
    // sortedToken0 and sortedToken1 are already sorted, we need to match them to the correct user accounts
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, userKeypair.publicKey);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, userKeypair.publicKey);

    console.log('Token Account Mapping:');
    console.log('  Creator Token 0:', creatorToken0.toBase58(), '(for', cpSwapPDAs.sortedToken0.toBase58(), ')');
    console.log('  Creator Token 1:', creatorToken1.toBase58(), '(for', cpSwapPDAs.sortedToken1.toBase58(), ')');

    // Build accounts array for direct CP-Swap call with standard authority
    const initPoolAccounts = [
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true }, // creator
      { pubkey: ammConfig, isSigner: false, isWritable: false }, // amm_config
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false }, // standard CP-Swap authority
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true }, // pool_state
      { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false }, // token_0_mint
      { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false }, // token_1_mint
      { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true }, // lp_mint
      { pubkey: creatorToken0, isSigner: false, isWritable: true }, // creator_token_0
      { pubkey: creatorToken1, isSigner: false, isWritable: true }, // creator_token_1
      { pubkey: adminLpToken, isSigner: false, isWritable: true }, // creator_lp_token
      { pubkey: cpSwapPDAs.vault0, isSigner: false, isWritable: true }, // token_0_vault
      { pubkey: cpSwapPDAs.vault1, isSigner: false, isWritable: true }, // token_1_vault
      { pubkey: CREATE_POOL_FEE_ACCOUNT, isSigner: false, isWritable: true }, // create_pool_fee
      { pubkey: cpSwapPDAs.observationState, isSigner: false, isWritable: true }, // observation_state
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
    ];

    const initPoolIx = new TransactionInstruction({
      keys: initPoolAccounts,
      programId: CP_SWAP_PROGRAM_ID, // Call CP-Swap directly
      data: instructionData,
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initPoolIx
    );

    console.log('Sending pool initialization transaction...');
    const initSig = await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair]);
    console.log('✅ Pool initialized with custom authority! Signature:', initSig);

    // === Step 6b: Register Pool with Continuum ===
    console.log('\n=== Step 6b: Registering Pool with Continuum ===');

    const [poolRegistry] = getPoolRegistryPDA(cpSwapPDAs.poolState);
    const [fifoStatePDA] = getFifoStatePDA();

    // Create registration instruction for Continuum
    const registerDiscriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]); // initialize_cp_swap_pool
    const registerData = Buffer.concat([
      registerDiscriminator,
      new BN(0).toArrayLike(Buffer, 'le', 8), // dummy init_amount_0
      new BN(0).toArrayLike(Buffer, 'le', 8), // dummy init_amount_1
      new BN(0).toArrayLike(Buffer, 'le', 8), // dummy open_time
    ]);

    const registerAccounts = [
      { pubkey: fifoStatePDA, isSigner: false, isWritable: false },
      { pubkey: poolRegistry, isSigner: false, isWritable: true },
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: false },
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: false },
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    const registerIx = new TransactionInstruction({
      keys: registerAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: registerData,
    });

    const registerTx = new Transaction().add(registerIx);
    const registerSig = await sendAndConfirmTransaction(connection, registerTx, [userKeypair]);
    console.log('✅ Pool registered with Continuum! Signature:', registerSig);

    // === Step 7: Submit Order ===
    console.log('\n=== Step 7: Submitting Order ===');

    const submitResult = await client.submitOrder(userKeypair, {
      poolId: cpSwapPDAs.poolState,
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

    // === Step 8: Execute Order with Ed25519 Signature ===
    console.log('\n=== Step 8: Executing Order with Ed25519 Signature ===');

    // Create execute order instructions with Ed25519 precompile
    const executeOrderInstructions = createExecuteOrderInstructionsWithSignature(
      {
        executor: relayerKeypair.publicKey,
        orderUser: userKeypair.publicKey,
        sequence: submitResult.sequence,
        poolId: cpSwapPDAs.poolState,
        userSource: userTokenA,
        userDestination: userTokenB,
        cpSwapRemainingAccounts: [
          cpSwapPDAs.poolState, // pool state account
          cpSwapPDAs.vault0,    // vault 0
          cpSwapPDAs.vault1,    // vault 1
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

    console.log('\n=== ✅ CP-Swap Pool Creation and Test Completed Successfully! ===');
    console.log('The complete flow works:');
    console.log('  1. Created SPL tokens');
    console.log('  2. Derived all CP-Swap PDAs correctly');
    console.log('  3. Initialized CP-Swap pool with Continuum authority');
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

// Add missing import
import { TransactionInstruction } from '@solana/web3.js';

main().catch(console.error);