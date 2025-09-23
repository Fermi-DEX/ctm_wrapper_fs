import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import { ContinuumCpSwapSDK } from "..";
import {
  ammConfigIndex,
  CONNECTION,
  PAYER_1,
  RELAYER_KEY_1,
  token0,
  token1,
} from ".";
import { InitializeCpSwapPoolParams } from "../types";
import { BN } from "bn.js";
import { CP_SWAP_PROGRAM } from "../constants";
import {
  createMint,
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const preInitializeCpSwapPool = async () => {
  const mintAuthorityA = Keypair.generate();
  const mintAuthorityB = Keypair.generate();

  // Create Token A (e.g., USDC-like with 6 decimals)
  const tokenA = await createMint(
    CONNECTION,
    PAYER_1,
    mintAuthorityA.publicKey,
    null,
    6
  );
  console.log("Token A created:", tokenA.toBase58());

  // Create Token B (e.g., SOL-like with 9 decimals)
  const tokenB = await createMint(
    CONNECTION,
    PAYER_1,
    mintAuthorityB.publicKey,
    null,
    9
  );
  console.log("Token B created:", tokenB.toBase58());

  // Sort tokens (CP-Swap requires token0 < token1)
  const [token0, token1, mintAuth0, mintAuth1] =
    tokenA.toBuffer().compare(tokenB.toBuffer()) < 0
      ? [tokenA, tokenB, mintAuthorityA, mintAuthorityB]
      : [tokenB, tokenA, mintAuthorityB, mintAuthorityA];

  console.log("Token 0 (sorted):", token0.toBase58());
  console.log("Token 1 (sorted):", token1.toBase58());

  // Create admin token accounts
  const adminToken0Account = await getOrCreateAssociatedTokenAccount(
    CONNECTION,
    PAYER_1,
    token0,
    PAYER_1.publicKey
  );

  const adminToken1Account = await getOrCreateAssociatedTokenAccount(
    CONNECTION,
    PAYER_1,
    token1,
    PAYER_1.publicKey
  );

  // Mint tokens to admin
  const amount0 = 1_000_000 * 10 ** 6; // 1M tokens with 6 decimals
  const amount1 = 500_000 * 10 ** 9; // 500K tokens with 9 decimals

  await mintTo(
    CONNECTION,
    PAYER_1,
    token0,
    adminToken0Account.address,
    mintAuth0,
    amount0
  );
  console.log("Minted", amount0 / 10 ** 6, "Token 0 to admin");

  await mintTo(
    CONNECTION,
    PAYER_1,
    token1,
    adminToken1Account.address,
    mintAuth1,
    amount1
  );
  console.log("Minted", amount1 / 10 ** 9, "Token 1 to admin");
};
const initializeCpSwapPool = async () => {
  const sdk = new ContinuumCpSwapSDK({ connection: CONNECTION });

  let ammConfigPDA: PublicKey  = new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2");

  const [poolState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool"),
      ammConfigPDA.toBuffer(),
      token0.toBuffer(),
      token1.toBuffer(),
    ],
    CP_SWAP_PROGRAM
  );

  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_and_lp_mint_auth_seed")],
    CP_SWAP_PROGRAM
  );

  const [lpMint] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_lp_mint"), poolState.toBuffer()],
    CP_SWAP_PROGRAM
  );

  const [vault0] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), poolState.toBuffer(), token0.toBuffer()],
    CP_SWAP_PROGRAM
  );

  const [vault1] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_vault"), poolState.toBuffer(), token1.toBuffer()],
    CP_SWAP_PROGRAM
  );

  const [observationState] = PublicKey.findProgramAddressSync(
    [Buffer.from("observation"), poolState.toBuffer()],
    CP_SWAP_PROGRAM
  );

  // Get Continuum PDAs
  const [poolAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("cp_pool_authority"), poolState.toBuffer()],
    ContinuumCpSwapSDK.getProgramId()
  );

  const [poolRegistryPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_registry"), poolState.toBuffer()],
    ContinuumCpSwapSDK.getProgramId()
  );

  console.log("Pool state:", poolState.toBase58());
  console.log("Continuum authority:", poolAuthorityPDA.toBase58());

  // Get admin LP token account
  const adminLpToken = await getAssociatedTokenAddress(
    lpMint,
    PAYER_1.publicKey
  );

  const adminToken0Account = await getOrCreateAssociatedTokenAccount(
    CONNECTION,
    PAYER_1,
    token0,
    PAYER_1.publicKey
  );

  const adminToken1Account = await getOrCreateAssociatedTokenAccount(
    CONNECTION,
    PAYER_1,
    token1,
    PAYER_1.publicKey
  );

  // Initial liquidity
  const initAmount0 = new BN(100_000 * 10 ** 6); // 100K token0
  const initAmount1 = new BN(50_000 * 10 ** 9); // 50K token1
  const openTime = new BN(0);

  // Build CP-Swap accounts for CPI
  const cpSwapAccounts = [
    { pubkey: PAYER_1.publicKey, isSigner: true, isWritable: true },
    { pubkey: ammConfigPDA, isSigner: false, isWritable: false },
    { pubkey: poolAuthorityPDA, isSigner: false, isWritable: false }, // Continuum authority
    { pubkey: poolState, isSigner: false, isWritable: true },
    { pubkey: token0, isSigner: false, isWritable: false },
    { pubkey: token1, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: adminToken0Account.address, isSigner: false, isWritable: true },
    { pubkey: adminToken1Account.address, isSigner: false, isWritable: true },
    { pubkey: adminLpToken, isSigner: false, isWritable: true },
    { pubkey: vault0, isSigner: false, isWritable: true },
    { pubkey: vault1, isSigner: false, isWritable: true },
    { pubkey: adminToken0Account.address, isSigner: false, isWritable: true }, // fee receiver
    { pubkey: observationState, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    {
      pubkey: SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];

  const poolTokenA = getAssociatedTokenAddressSync(
    token0,
    poolAuthorityPDA,
    true
  );
  const poolTokenB = getAssociatedTokenAddressSync(
    token1,
    poolAuthorityPDA,
    true
  );

  const param: InitializeCpSwapPoolParams = {
    cpSwapAccounts: [token0, token1],
    initAmount0: new BN(100_000 * 10 ** 6),
    initAmount1: new BN(50_000 * 10 ** 9),
    openTime: new BN(0),
    poolState,
    cpSwapProgram: CP_SWAP_PROGRAM,
    admin: PAYER_1.publicKey,
  };

  const ix = await sdk.buildInitializeCpSwapPoolIx(param, cpSwapAccounts);

  const transaction = new Transaction();

  transaction.add(ix);

  transaction.feePayer = PAYER_1.publicKey;
  transaction.recentBlockhash = (
    await CONNECTION.getLatestBlockhash()
  ).blockhash;

  const sig = await sendAndConfirmTransaction(CONNECTION, transaction, [
    PAYER_1,
  ]);

  console.log(sig);
};

// preInitializeCpSwapPool();
initializeCpSwapPool();
