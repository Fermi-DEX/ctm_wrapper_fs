import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA } from '../utils';

// Discriminators for wrapper instructions
const DEPOSIT_LIQUIDITY_DISCRIMINATOR = Buffer.from([245, 99, 59, 25, 151, 71, 233, 249]);
const WITHDRAW_LIQUIDITY_DISCRIMINATOR = Buffer.from([149, 158, 33, 185, 47, 243, 253, 31]);

export interface DepositLiquidityParams {
  cpSwapProgram: PublicKey;
  poolId: PublicKey;
  minLpAmount: BN;
  maxToken0Amount: BN;
  maxToken1Amount: BN;
  poolAuthorityBump: number;
  owner: PublicKey;
  lpMint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  tokenProgram: PublicKey;
}

export interface WithdrawLiquidityParams {
  cpSwapProgram: PublicKey;
  poolId: PublicKey;
  lpAmount: BN;
  minToken0Amount: BN;
  minToken1Amount: BN;
  poolAuthorityBump: number;
  owner: PublicKey;
  lpMint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  token0Vault: PublicKey;
  token1Vault: PublicKey;
  tokenProgram: PublicKey;
}

export function createDepositLiquidityInstruction(params: DepositLiquidityParams): TransactionInstruction {
  const [fifoState] = getFifoStatePDA();
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: params.cpSwapProgram, isSigner: false, isWritable: false },
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: params.poolId, isSigner: false, isWritable: true },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.token0Vault, isSigner: false, isWritable: true },
    { pubkey: params.token1Vault, isSigner: false, isWritable: true },
    { pubkey: params.tokenProgram, isSigner: false, isWritable: false },
  ];

  const data = Buffer.concat([
    DEPOSIT_LIQUIDITY_DISCRIMINATOR,
    params.minLpAmount.toArrayLike(Buffer, 'le', 8),
    params.maxToken0Amount.toArrayLike(Buffer, 'le', 8),
    params.maxToken1Amount.toArrayLike(Buffer, 'le', 8),
    params.poolId.toBuffer(),
    Buffer.from([params.poolAuthorityBump]),
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}

export function createWithdrawLiquidityInstruction(params: WithdrawLiquidityParams): TransactionInstruction {
  const [fifoState] = getFifoStatePDA();
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: params.cpSwapProgram, isSigner: false, isWritable: false },
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: params.poolId, isSigner: false, isWritable: true },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.token0Vault, isSigner: false, isWritable: true },
    { pubkey: params.token1Vault, isSigner: false, isWritable: true },
    { pubkey: params.tokenProgram, isSigner: false, isWritable: false },
  ];

  const data = Buffer.concat([
    WITHDRAW_LIQUIDITY_DISCRIMINATOR,
    params.lpAmount.toArrayLike(Buffer, 'le', 8),
    params.minToken0Amount.toArrayLike(Buffer, 'le', 8),
    params.minToken1Amount.toArrayLike(Buffer, 'le', 8),
    params.poolId.toBuffer(),
    Buffer.from([params.poolAuthorityBump]),
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}
