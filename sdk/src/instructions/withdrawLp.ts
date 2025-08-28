import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA } from '../utils';

export interface WithdrawLpParams {
  user: PublicKey;
  cpSwapProgram: PublicKey;
  poolId: PublicKey;
  lpAmount: BN;
  minAmount0: BN;
  minAmount1: BN;
  poolAuthorityBump: number;
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export function createWithdrawLpInstruction(
  params: WithdrawLpParams
): TransactionInstruction {
  const {
    user,
    cpSwapProgram,
    poolId,
    lpAmount,
    minAmount0,
    minAmount1,
    poolAuthorityBump,
    remainingAccounts
  } = params;

  const [fifoState] = getFifoStatePDA();

  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
    ...remainingAccounts
  ];

  const discriminator = Buffer.from([225, 221, 45, 211, 49, 60, 51, 163]);

  const data = Buffer.concat([
    discriminator,
    lpAmount.toArrayLike(Buffer, 'le', 8),
    minAmount0.toArrayLike(Buffer, 'le', 8),
    minAmount1.toArrayLike(Buffer, 'le', 8),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump])
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data
  });
}
