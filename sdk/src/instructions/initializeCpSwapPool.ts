import { TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js';
import { CONTINUUM_PROGRAM_ID, CP_SWAP_PROGRAM_ID } from '../constants';
import { getFifoStatePDA, getPoolRegistryPDA, getPoolAuthorityPDA } from '../utils/pda';
import BN from 'bn.js';

export interface InitializeCpSwapPoolParams {
  admin: PublicKey;
  poolState: PublicKey;
  initAmount0: BN;
  initAmount1: BN;
  openTime: BN;
  cpSwapAccounts: PublicKey[]; // All accounts needed for CP-Swap initialize
}

export function createInitializeCpSwapPoolInstruction(
  params: InitializeCpSwapPoolParams
): TransactionInstruction {
  const { admin, poolState, initAmount0, initAmount1, openTime, cpSwapAccounts } = params;
  
  const [fifoState] = getFifoStatePDA();
  const [poolRegistry] = getPoolRegistryPDA(poolState);
  const [poolAuthority] = getPoolAuthorityPDA(poolState);
  
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: false },
    { pubkey: poolRegistry, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: admin, isSigner: true, isWritable: true },
    { pubkey: poolState, isSigner: true, isWritable: false }, // Pool state needs to be a signer (creator)
    { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    // Add CP-Swap specific accounts
    ...cpSwapAccounts.map(pubkey => ({
      pubkey,
      isSigner: false,
      isWritable: true,
    })),
  ];

  // Discriminator for initialize_cp_swap_pool: [82, 124, 68, 116, 214, 40, 134, 198]
  const discriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]);
  
  // Encode arguments
  const data = Buffer.concat([
    discriminator,
    initAmount0.toArrayLike(Buffer, 'le', 8),
    initAmount1.toArrayLike(Buffer, 'le', 8),
    openTime.toArrayLike(Buffer, 'le', 8),
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}