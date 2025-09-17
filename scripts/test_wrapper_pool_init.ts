import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
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
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';

// Your custom CP-Swap program ID
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('EmCthKmtC2B6xXKF9uYxo9EF5C5zJjbYvUMW3VrhFXX3');

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

// Get Continuum PDAs
function getContinuumPDAs(poolState: PublicKey) {
  const [fifoState] = PublicKey.findProgramAddressSync(
    [Buffer.from('fifo_state')],
    CONTINUUM_PROGRAM_ID
  );

  const [poolRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool_registry'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  const [poolAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('cp_pool_authority'), poolState.toBuffer()],
    CONTINUUM_PROGRAM_ID
  );

  return { fifoState, poolRegistry, poolAuthority };
}

async function main() {
  console.log('=== Initialize CP-Swap Pool via Continuum Wrapper ===\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load wallet
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const userKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('User wallet:', userKeypair.publicKey.toBase58());

  try {
    // === Step 1: Ensure wallet has SOL ===
    console.log('\n=== Step 1: Checking SOL Balance ===');
    let balance = await connection.getBalance(userKeypair.publicKey);
    console.log(`Current balance: ${balance / LAMPORTS_PER_SOL} SOL`);

    if (balance < LAMPORTS_PER_SOL) {
      console.log('Requesting airdrop...');
      const sig = await connection.requestAirdrop(userKeypair.publicKey, 2 * LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig);
      balance = await connection.getBalance(userKeypair.publicKey);
      console.log(`New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    }

    // === Step 2: Create Tokens ===
    console.log('\n=== Step 2: Creating Tokens ===');

    // Token A
    const tokenAMint = Keypair.generate();
    console.log('Token A mint:', tokenAMint.publicKey.toBase58());

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
        6, // decimals
        userKeypair.publicKey,
        userKeypair.publicKey
      )
    );

    await sendAndConfirmTransaction(connection, createTokenATx, [userKeypair, tokenAMint]);
    console.log('Token A created');

    // Token B
    const tokenBMint = Keypair.generate();
    console.log('Token B mint:', tokenBMint.publicKey.toBase58());

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

    // === Step 3: Derive PDAs ===
    console.log('\n=== Step 3: Deriving PDAs ===');

    // AMM Config (index 0)
    const ammConfigIndex = 0;
    const indexBuffer = Buffer.allocUnsafe(2);
    indexBuffer.writeUInt16BE(ammConfigIndex);
    const [ammConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('amm_config'), indexBuffer],
      CP_SWAP_PROGRAM_ID
    );
    console.log('AMM Config:', ammConfig.toBase58());

    const cpSwapPDAs = getCpSwapPDAs(tokenAMint.publicKey, tokenBMint.publicKey, ammConfig);
    console.log('Pool State:', cpSwapPDAs.poolState.toBase58());
    console.log('Sorted Token 0:', cpSwapPDAs.sortedToken0.toBase58());
    console.log('Sorted Token 1:', cpSwapPDAs.sortedToken1.toBase58());

    const continuumPDAs = getContinuumPDAs(cpSwapPDAs.poolState);
    console.log('Continuum Authority:', continuumPDAs.poolAuthority.toBase58());
    console.log('Pool Registry:', continuumPDAs.poolRegistry.toBase58());

    // === Step 4: Fund pool authority and create token accounts ===
    console.log('\n=== Step 4: Funding Pool Authority and Creating Token Accounts ===');

    // Transfer SOL to pool authority PDA for account creation
    const transferSolTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: userKeypair.publicKey,
        toPubkey: continuumPDAs.poolAuthority,
        lamports: 0.05 * LAMPORTS_PER_SOL, // 0.05 SOL to cover all account creation
      })
    );
    await sendAndConfirmTransaction(connection, transferSolTx, [userKeypair]);
    console.log('Transferred 0.05 SOL to pool authority');

    // Token accounts for the pool authority PDA (creator)
    const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, continuumPDAs.poolAuthority, true);
    const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, continuumPDAs.poolAuthority, true);
    // LP token account will be created by CP-Swap, so we just derive the address
    const creatorLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, continuumPDAs.poolAuthority, true);

    console.log('Creator Token 0:', creatorToken0.toBase58());
    console.log('Creator Token 1:', creatorToken1.toBase58());
    console.log('Creator LP Token (will be created):', creatorLpToken.toBase58());

    // Create token accounts for pool authority
    const createAccountsTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        creatorToken0,
        continuumPDAs.poolAuthority,
        cpSwapPDAs.sortedToken0
      ),
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        creatorToken1,
        continuumPDAs.poolAuthority,
        cpSwapPDAs.sortedToken1
      )
    );

    await sendAndConfirmTransaction(connection, createAccountsTx, [userKeypair]);
    console.log('Token accounts created for pool authority');

    // Mint tokens to pool authority's accounts
    const mintTx = new Transaction().add(
      createMintToInstruction(
        cpSwapPDAs.sortedToken0,
        creatorToken0,
        userKeypair.publicKey,
        1000 * 10 ** 6
      ),
      createMintToInstruction(
        cpSwapPDAs.sortedToken1,
        creatorToken1,
        userKeypair.publicKey,
        1000 * 10 ** 6
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
    console.log('Minted 1000 tokens to pool authority accounts');

    // === Step 5: Initialize Pool via Wrapper ===
    console.log('\n=== Step 5: Initializing Pool via Continuum Wrapper ===');

    const initAmount0 = new BN(100 * 10 ** 6);
    const initAmount1 = new BN(100 * 10 ** 6);
    const openTime = new BN(0); // Open immediately

    console.log('Init Amount 0:', initAmount0.toString());
    console.log('Init Amount 1:', initAmount1.toString());

    // Create pool fee account
    const CREATE_POOL_FEE_ACCOUNT = new PublicKey('3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy');

    // Build the initialize_cp_swap_pool instruction
    const discriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]);

    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
    ]);

    // Build accounts for the wrapper instruction
    const wrapperAccounts = [
      { pubkey: continuumPDAs.fifoState, isSigner: false, isWritable: false }, // fifo_state
      { pubkey: continuumPDAs.poolRegistry, isSigner: false, isWritable: true }, // pool_registry
      { pubkey: continuumPDAs.poolAuthority, isSigner: false, isWritable: false }, // pool_authority
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true }, // admin
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true }, // pool_state
      { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false }, // cp_swap_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      // CP-Swap specific accounts (remaining_accounts) - order matters!
      // The creator must be the pool_authority PDA (which wrapper will sign for)
      { pubkey: continuumPDAs.poolAuthority, isSigner: false, isWritable: true }, // creator (pool_authority signs via CPI)
      { pubkey: ammConfig, isSigner: false, isWritable: false }, // amm_config
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false }, // authority (CP-Swap's standard authority for vaults)
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true }, // pool_state
      { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false }, // token_0_mint
      { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false }, // token_1_mint
      { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true }, // lp_mint
      { pubkey: creatorToken0, isSigner: false, isWritable: true }, // creator_token_0
      { pubkey: creatorToken1, isSigner: false, isWritable: true }, // creator_token_1
      { pubkey: creatorLpToken, isSigner: false, isWritable: true }, // creator_lp_token
      { pubkey: cpSwapPDAs.vault0, isSigner: false, isWritable: true }, // token_0_vault
      { pubkey: cpSwapPDAs.vault1, isSigner: false, isWritable: true }, // token_1_vault
      { pubkey: CREATE_POOL_FEE_ACCOUNT, isSigner: false, isWritable: true }, // create_pool_fee
      { pubkey: cpSwapPDAs.observationState, isSigner: false, isWritable: true }, // observation_state
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // associated_token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program (CP-Swap needs it)
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // rent
    ];

    const initPoolIx = new TransactionInstruction({
      keys: wrapperAccounts,
      programId: CONTINUUM_PROGRAM_ID,
      data: instructionData,
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initPoolIx
    );

    console.log('Sending pool initialization transaction via wrapper...');
    const initSig = await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair]);

    console.log('\n✅ SUCCESS! Pool initialized via Continuum wrapper!');
    console.log('Transaction signature:', initSig);
    console.log('\nPool details:');
    console.log('  Pool ID:', cpSwapPDAs.poolState.toBase58());
    console.log('  Authority:', continuumPDAs.poolAuthority.toBase58());
    console.log('  Token 0:', cpSwapPDAs.sortedToken0.toBase58());
    console.log('  Token 1:', cpSwapPDAs.sortedToken1.toBase58());

    // Verify pool registry was created
    const poolRegistryAccount = await connection.getAccountInfo(continuumPDAs.poolRegistry);
    if (poolRegistryAccount) {
      console.log('\n✅ Pool successfully registered with Continuum!');
      console.log('Pool registry account exists at:', continuumPDAs.poolRegistry.toBase58());
    }

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main().catch(console.error);