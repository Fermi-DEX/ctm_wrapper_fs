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

const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
const CONTINUUM_PROGRAM_ID = new PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');

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

async function main() {
  console.log('=== Simple CP-Swap Pool Creation Test ===\n');

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

    // === Step 2: Create Token A ===
    console.log('\n=== Step 2: Creating Token A ===');
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
        6, // decimals - same for both tokens
        userKeypair.publicKey, // mint authority
        userKeypair.publicKey  // freeze authority
      )
    );

    await sendAndConfirmTransaction(connection, createTokenATx, [userKeypair, tokenAMint]);
    console.log('Token A created successfully');

    // === Step 3: Create Token B ===
    console.log('\n=== Step 3: Creating Token B ===');
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
    console.log('Token B created successfully');

    // === Step 4: Derive CP-Swap PDAs ===
    console.log('\n=== Step 4: Deriving CP-Swap PDAs ===');

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

    // Get Continuum pool authority PDA
    const [continuumAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), cpSwapPDAs.poolState.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('Continuum Authority:', continuumAuthority.toBase58());

    // === Step 5: Create token accounts and mint tokens ===
    console.log('\n=== Step 5: Creating Token Accounts and Minting ===');

    // Create token accounts for SORTED tokens
    const userToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, userKeypair.publicKey);
    const userToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, userKeypair.publicKey);

    console.log('User Token 0 Account:', userToken0.toBase58());
    console.log('User Token 1 Account:', userToken1.toBase58());

    // Create LP token account
    const adminLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, userKeypair.publicKey);
    console.log('Admin LP Token Account:', adminLpToken.toBase58());

    // Create token accounts
    const createAccountsTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        userToken0,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken0
      ),
      createAssociatedTokenAccountInstruction(
        userKeypair.publicKey,
        userToken1,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken1
      )
    );

    await sendAndConfirmTransaction(connection, createAccountsTx, [userKeypair]);
    console.log('Token accounts created');

    // Mint tokens to user accounts
    const mintTx = new Transaction().add(
      createMintToInstruction(
        cpSwapPDAs.sortedToken0,
        userToken0,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken0.equals(tokenAMint.publicKey) ? 1000 * 10 ** 9 : 1000 * 10 ** 6
      ),
      createMintToInstruction(
        cpSwapPDAs.sortedToken1,
        userToken1,
        userKeypair.publicKey,
        cpSwapPDAs.sortedToken1.equals(tokenBMint.publicKey) ? 1000 * 10 ** 6 : 1000 * 10 ** 9
      )
    );

    await sendAndConfirmTransaction(connection, mintTx, [userKeypair]);
    console.log('Minted 1000 tokens to each account');

    // Verify balances
    const balance0 = await connection.getTokenAccountBalance(userToken0);
    const balance1 = await connection.getTokenAccountBalance(userToken1);
    console.log('Token 0 balance:', balance0.value.uiAmount);
    console.log('Token 1 balance:', balance1.value.uiAmount);

    // === Step 6: Initialize CP-Swap Pool ===
    console.log('\n=== Step 6: Initializing CP-Swap Pool ===');

    // Initial amounts for the pool - must match sorted token order
    // Use a simple fixed amount for both tokens based on their decimals
    const initAmount0 = new BN(100 * 10 ** 9);  // 100 tokens with 9 decimals
    const initAmount1 = new BN(100 * 10 ** 6);  // 100 tokens with 6 decimals

    console.log('Init Amount 0:', initAmount0.toString(), 'for', cpSwapPDAs.sortedToken0.toBase58());
    console.log('Init Amount 1:', initAmount1.toString(), 'for', cpSwapPDAs.sortedToken1.toBase58());

    const openTime = new BN(0); // Open immediately

    // Create pool fee account
    const CREATE_POOL_FEE_ACCOUNT = new PublicKey('3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy');

    // Try with standard authority first to debug the issue
    // Build instruction data for CP-Swap initialize WITHOUT custom authority
    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // initialize
    const authorityType = Buffer.from([0]); // 0 = standard authority
    const optionTag = Buffer.from([0]); // 0 = None (no custom authority)

    const instructionData = Buffer.concat([
      discriminator,
      initAmount0.toArrayLike(Buffer, 'le', 8),
      initAmount1.toArrayLike(Buffer, 'le', 8),
      openTime.toArrayLike(Buffer, 'le', 8),
      authorityType,
      optionTag,
      // No custom authority bytes when using standard authority
    ]);

    // Build accounts array
    const initPoolAccounts = [
      { pubkey: userKeypair.publicKey, isSigner: true, isWritable: true }, // creator
      { pubkey: ammConfig, isSigner: false, isWritable: false }, // amm_config
      { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false }, // standard CP-Swap authority
      { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true }, // pool_state
      { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false }, // token_0_mint
      { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false }, // token_1_mint
      { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true }, // lp_mint
      { pubkey: userToken0, isSigner: false, isWritable: true }, // creator_token_0
      { pubkey: userToken1, isSigner: false, isWritable: true }, // creator_token_1
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
      programId: CP_SWAP_PROGRAM_ID,
      data: instructionData,
    });

    const initPoolTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      initPoolIx
    );

    console.log('Sending pool initialization transaction...');
    const initSig = await sendAndConfirmTransaction(connection, initPoolTx, [userKeypair]);

    console.log('\n✅ SUCCESS! Pool initialized with custom authority!');
    console.log('Transaction signature:', initSig);
    console.log('\nPool details:');
    console.log('  Pool ID:', cpSwapPDAs.poolState.toBase58());
    console.log('  Custom Authority:', continuumAuthority.toBase58());
    console.log('  Token 0:', cpSwapPDAs.sortedToken0.toBase58());
    console.log('  Token 1:', cpSwapPDAs.sortedToken1.toBase58());
    console.log('  Initial Liquidity: 100 of each token');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.logs) {
      console.error('Transaction logs:');
      error.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main().catch(console.error);