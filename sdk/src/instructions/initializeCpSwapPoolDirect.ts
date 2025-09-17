import {
  TransactionInstruction,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync
} from '@solana/spl-token';
import { CONTINUUM_PROGRAM_ID, CP_SWAP_PROGRAM_ID } from '../constants';
import { getPoolAuthorityPDA } from '../utils/pda';
import BN from 'bn.js';

export interface InitializeCpSwapPoolDirectParams {
  creator: PublicKey;
  ammConfig: PublicKey;
  token0Mint: PublicKey;
  token1Mint: PublicKey;
  initAmount0: BN;
  initAmount1: BN;
  openTime?: BN;
  feeOwner?: PublicKey;
}

export interface CpSwapPDAs {
  poolState: PublicKey;
  cpSwapAuthority: PublicKey;
  lpMint: PublicKey;
  vault0: PublicKey;
  vault1: PublicKey;
  observationState: PublicKey;
  sortedToken0: PublicKey;
  sortedToken1: PublicKey;
}

/**
 * Derives all CP-Swap PDAs for a pool
 */
export function getCpSwapPDAs(
  token0: PublicKey,
  token1: PublicKey,
  ammConfig: PublicKey
): CpSwapPDAs {
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

/**
 * Creates an instruction to initialize a CP-Swap pool with CTM Wrapper as custom authority
 * This directly calls the CP-Swap program with the CTM authority set
 */
export function createInitializeCpSwapPoolDirectInstruction(
  params: InitializeCpSwapPoolDirectParams
): TransactionInstruction {
  const {
    creator,
    ammConfig,
    token0Mint,
    token1Mint,
    initAmount0,
    initAmount1,
    openTime = new BN(0),
    feeOwner = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq')
  } = params;

  // Get CP-Swap PDAs
  const cpSwapPDAs = getCpSwapPDAs(token0Mint, token1Mint, ammConfig);

  // Get CTM Wrapper pool authority
  const [ctmPoolAuthority] = getPoolAuthorityPDA(cpSwapPDAs.poolState);

  // Get creator token accounts
  const creatorToken0 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, creator);
  const creatorToken1 = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken1, creator);
  const creatorLpToken = getAssociatedTokenAddressSync(cpSwapPDAs.lpMint, creator);

  // Get fee account
  const createPoolFee = getAssociatedTokenAddressSync(cpSwapPDAs.sortedToken0, feeOwner);

  // Build instruction data with custom authority
  const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // CP-Swap initialize
  const authorityType = Buffer.from([1]); // 1 = custom authority
  const optionTag = Buffer.from([1]); // 1 = Some (authority provided)

  const instructionData = Buffer.concat([
    discriminator,
    initAmount0.toArrayLike(Buffer, 'le', 8),
    initAmount1.toArrayLike(Buffer, 'le', 8),
    openTime.toArrayLike(Buffer, 'le', 8),
    authorityType,
    optionTag,
    ctmPoolAuthority.toBuffer(), // CTM Wrapper authority as custom authority
  ]);

  // Build accounts array
  const keys = [
    { pubkey: creator, isSigner: true, isWritable: true },
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
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
    { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: CP_SWAP_PROGRAM_ID,
    data: instructionData,
  });
}

/**
 * Creates an instruction to ensure the fee account exists
 */
export function createFeeAccountInstruction(
  payer: PublicKey,
  sortedToken0: PublicKey,
  feeOwner: PublicKey = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq')
): TransactionInstruction | null {
  const feeAccount = getAssociatedTokenAddressSync(sortedToken0, feeOwner);

  // This returns null if account exists, instruction if it needs to be created
  // Caller should check if account exists before including this instruction
  return {
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: feeAccount, isSigner: false, isWritable: true },
      { pubkey: feeOwner, isSigner: false, isWritable: false },
      { pubkey: sortedToken0, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // Create associated token account instruction
  };
}