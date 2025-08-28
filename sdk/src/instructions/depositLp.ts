import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
import { CONTINUUM_PROGRAM_ID } from '../constants';
import { getFifoStatePDA } from '../utils';

export interface DepositLpParams {
  user: PublicKey;
  cpSwapProgram: PublicKey;
  poolId: PublicKey;
  minLpAmount: BN;
  maxAmount0: BN;
  maxAmount1: BN;
  poolAuthorityBump: number;
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

export function createDepositLpInstruction(
  params: DepositLpParams
): TransactionInstruction {
  const {
    user,
    cpSwapProgram,
    poolId,
    minLpAmount,
    maxAmount0,
    maxAmount1,
    poolAuthorityBump,
    remainingAccounts
  } = params;

  const [fifoState] = getFifoStatePDA();

  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: true },
    { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
    ...remainingAccounts
  ];

  const discriminator = Buffer.from([83, 107, 16, 26, 26, 20, 130, 56]);

  const data = Buffer.concat([
    discriminator,
    minLpAmount.toArrayLike(Buffer, 'le', 8),
    maxAmount0.toArrayLike(Buffer, 'le', 8),
    maxAmount1.toArrayLike(Buffer, 'le', 8),
    poolId.toBuffer(),
    Buffer.from([poolAuthorityBump])
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data
  });
}
