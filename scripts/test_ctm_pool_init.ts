import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { ContinuumClient } from '../sdk/src';
import {
  getPoolRegistryPDA,
  getPoolAuthorityPDA,
  getFifoStatePDA
} from '../sdk/src/utils';
import BN from 'bn.js';
import fs from 'fs';

// Program IDs for devnet
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
    try {
      const sig = await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      console.log(`Airdropped 2 SOL, new balance: ${await connection.getBalance(pubkey) / LAMPORTS_PER_SOL} SOL`);
    } catch (err) {
      console.log('Airdrop failed, continuing anyway...');
    }
  }
}

async function main() {
  console.log('=== CP-Swap Pool Initialization with CTM Wrapper Authority ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load wallets
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const adminKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );

  console.log('Admin wallet:', adminKeypair.publicKey.toBase58());
  console.log('CTM Wrapper Program (devnet):', CONTINUUM_PROGRAM_ID.toBase58());
  console.log('CP-Swap Program (devnet):', CP_SWAP_PROGRAM_ID.toBase58());

  const client = new ContinuumClient(connection);

  try {
    // Check FIFO state
    const fifoState = await client.getFifoState();
    if (!fifoState) {
      console.error('CTM Wrapper not initialized! Please initialize first.');
      process.exit(1);
    }
    console.log('CTM Wrapper initialized');

    // === Step 1: Setup wallet with SOL ===
    console.log('\n=== Step 1: Setup Wallet ===');
    await airdropIfNeeded(connection, adminKeypair.publicKey, LAMPORTS_PER_SOL);

    // === Step 2: Create test tokens ===
    console.log('\n=== Step 2: Creating Test Tokens ===');

    // Create Token A
    const tokenAMint = Keypair.generate();
    console.log('Creating Token A mint:', tokenAMint.publicKey.toBase58());

    const createTokenATx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: adminKeypair.publicKey,
        newAccountPubkey: tokenAMint.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        tokenAMint.publicKey,
        9, // decimals
        adminKeypair.publicKey, // mint authority
        adminKeypair.publicKey  // freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, createTokenATx, [adminKeypair, tokenAMint]);
    console.log('Token A created');

    // Create Token B
    const tokenBMint = Keypair.generate();
    console.log('Creating Token B mint:', tokenBMint.publicKey.toBase58());

    const createTokenBTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: adminKeypair.publicKey,
        newAccountPubkey: tokenBMint.publicKey,
        space: MINT_SIZE,
        lamports: await getMinimumBalanceForRentExemptMint(connection),
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMintInstruction(
        tokenBMint.publicKey,
        6, // decimals
        adminKeypair.publicKey,
        adminKeypair.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createTokenBTx, [adminKeypair, tokenBMint]);
    console.log('Token B created');

    // === Step 3: Setup AMM Config ===
    console.log('\n=== Step 3: Setting up AMM Config ===');

    // Use AMM config index 0
    const ammConfigIndex = 0;
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
      console.log('AMM Config does not exist. Creating default AMM config...');

      // Note: In production, AMM config needs to be created by CP-Swap admin
      // For testing, we'll assume it exists or skip this test
      console.log('Please ensure AMM Config is created on devnet first.');
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
    console.log('CTM Wrapper Pool Authority:', continuumPoolAuthority.toBase58());
    console.log('Pool Authority Bump:', poolAuthorityBump);

    // === Step 5: Create token accounts and mint tokens ===
    console.log('\n=== Step 5: Creating Token Accounts and Minting ===');

    // Create admin token accounts
    const adminTokenA = getAssociatedTokenAddressSync(tokenAMint.publicKey, adminKeypair.publicKey);
    const adminTokenB = getAssociatedTokenAddressSync(tokenBMint.publicKey, adminKeypair.publicKey);

    const createATATx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        adminKeypair.publicKey,
        adminTokenA,
        adminKeypair.publicKey,
        tokenAMint.publicKey
      ),
      createAssociatedTokenAccountInstruction(
        adminKeypair.publicKey,
        adminTokenB,
        adminKeypair.publicKey,
        tokenBMint.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createATATx, [adminKeypair]);
    console.log('Admin token accounts created');

    // Create LP token account for admin
    const adminLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, adminKeypair.publicKey);

    // Mint tokens to admin
    const mintTx = new Transaction().add(
      createMintToInstruction(
        tokenAMint.publicKey,
        adminTokenA,
        adminKeypair.publicKey,
        1000 * 10 ** 9 // 1000 Token A
      ),
      createMintToInstruction(
        tokenBMint.publicKey,
        adminTokenB,
        adminKeypair.publicKey,
        1000 * 10 ** 6 // 1000 Token B
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [adminKeypair]);
    console.log('Minted tokens to admin');

    // === Step 6: Fund CTM Wrapper Authority PDA ===
    console.log('\n=== Step 6: Funding CTM Wrapper Authority PDA ===');

    // The CTM Wrapper authority PDA needs SOL to pay for pool creation
    const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(0);
    const poolCreationFee = 0.002 * LAMPORTS_PER_SOL; // Pool creation fee
    const requiredBalance = rentExemptBalance + poolCreationFee;

    const currentBalance = await connection.getBalance(continuumPoolAuthority);
    if (currentBalance < requiredBalance) {
      const transferAmount = requiredBalance - currentBalance;
      console.log(`Funding CTM Wrapper authority PDA with ${transferAmount / LAMPORTS_PER_SOL} SOL...`);

      const fundTx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: adminKeypair.publicKey,
          toPubkey: continuumPoolAuthority,
          lamports: transferAmount,
        })
      );

      await sendAndConfirmTransaction(connection, fundTx, [adminKeypair]);
      console.log('Authority PDA funded');
    }

    // === Step 7: Initialize CP-Swap Pool with CTM Wrapper Authority ===
    console.log('\n=== Step 7: Initializing CP-Swap Pool with CTM Wrapper Authority ===');

    // Determine initial amounts based on token sorting
    const initAmount0 = cpSwapPDAs.sortedToken0.equals(tokenAMint.publicKey)
      ? new BN(100 * 10 ** 9)  // 100 Token A
      : new BN(100 * 10 ** 6); // 100 Token B

    const initAmount1 = cpSwapPDAs.sortedToken1.equals(tokenBMint.publicKey)
      ? new BN(100 * 10 ** 6)  // 100 Token B
      : new BN(100 * 10 ** 9); // 100 Token A

    const openTime = new BN(0);

    // Get CTM Wrapper PDAs
    const [fifoStatePDA] = getFifoStatePDA();
    const [poolRegistry] = getPoolRegistryPDA(cpSwapPDAs.poolState);

    // Create pool fee receiver for devnet
    const CREATE_POOL_FEE_ACCOUNT = new PublicKey('3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy');

    // Get creator token accounts based on sorting
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, adminKeypair.publicKey);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, adminKeypair.publicKey);

    console.log('Token Account Mapping:');
    console.log('  Creator Token 0:', creatorToken0.toBase58());
    console.log('  Creator Token 1:', creatorToken1.toBase58());

    // Build the instruction data for CTM Wrapper's initialize_cp_swap_pool
    const discriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]); // initialize_cp_swap_pool
    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
    ]);

    // Build accounts for CTM Wrapper initialization
    const initPoolAccounts = [
      // CTM Wrapper accounts
      { pubkey: fifoStatePDA, isSigner: false, isWritable: false },
      { pubkey: poolRegistry, isSigner: false, isWritable: true },
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: false },
      { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true },
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    // Remaining accounts for CP-Swap initialize (passed through)
    const cpSwapAccounts = [
      { pubkey: continuumPoolAuthority, isSigner: false, isWritable: true }, // creator (will be signed by PDA)
      { pubkey: ammConfig, isSigner: false, isWritable: false }, // amm_config
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false }, // CP-Swap authority
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
      keys: [...initPoolAccounts, ...cpSwapAccounts],
      programId: CONTINUUM_PROGRAM_ID,
      data: instructionData,
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initPoolIx
    );

    console.log('Sending pool initialization transaction...');
    console.log('This will:');
    console.log('  1. Initialize CP-Swap pool with CTM Wrapper authority as custom authority');
    console.log('  2. Register the pool in CTM Wrapper registry');

    const initSig = await sendAndConfirmTransaction(connection, initPoolTx, [adminKeypair]);
    console.log('✅ Pool initialized with CTM Wrapper authority!');
    console.log('  Signature:', initSig);

    // === Step 8: Verify Pool Creation ===
    console.log('\n=== Step 8: Verifying Pool Creation ===');

    // Check pool state
    const poolStateAccount = await connection.getAccountInfo(cpSwapPDAs.poolState);
    if (poolStateAccount) {
      console.log('✅ Pool state account created');
      console.log('  Size:', poolStateAccount.data.length, 'bytes');
    }

    // Check pool registry
    const poolRegistryAccount = await connection.getAccountInfo(poolRegistry);
    if (poolRegistryAccount) {
      console.log('✅ Pool registered in CTM Wrapper');
      console.log('  Registry size:', poolRegistryAccount.data.length, 'bytes');
    }

    // Check vaults
    const vault0Account = await connection.getAccountInfo(cpSwapPDAs.vault0);
    const vault1Account = await connection.getAccountInfo(cpSwapPDAs.vault1);
    if (vault0Account && vault1Account) {
      console.log('✅ Token vaults created');
    }

    // Check LP mint
    const lpMintAccount = await connection.getAccountInfo(cpSwapPDAs.lpMint);
    if (lpMintAccount) {
      console.log('✅ LP mint created');
    }

    console.log('\n=== ✅ CP-Swap Pool Initialization Successful! ===');
    console.log('Pool Details:');
    console.log('  Pool ID:', cpSwapPDAs.poolState.toBase58());
    console.log('  CTM Authority:', continuumPoolAuthority.toBase58());
    console.log('  Token 0:', cpSwapPDAs.sortedToken0.toBase58());
    console.log('  Token 1:', cpSwapPDAs.sortedToken1.toBase58());
    console.log('  LP Mint:', cpSwapPDAs.lpMint.toBase58());
    console.log('\nThe pool is now ready to accept orders through the CTM Wrapper!');

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