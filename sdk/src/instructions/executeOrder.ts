import { TransactionInstruction, PublicKey, SYSVAR_CLOCK_PUBKEY, SYSVAR_INSTRUCTIONS_PUBKEY, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { CONTINUUM_PROGRAM_ID, CP_SWAP_PROGRAM_ID } from '../constants';
import { getFifoStatePDA, getPoolRegistryPDA, getOrderPDA, getPoolAuthorityPDA, createEd25519Instruction } from '../utils';
import BN from 'bn.js';

export interface ExecuteOrderParams {
  executor: PublicKey;
  orderUser: PublicKey;
  sequence: BN;
  poolId: PublicKey;
  userSource: PublicKey;
  userDestination: PublicKey;
  cpSwapRemainingAccounts: PublicKey[]; // Pool state, vaults, etc.
}

export function createExecuteOrderInstruction(
  params: ExecuteOrderParams
): TransactionInstruction {
  const { executor, orderUser, sequence, poolId, userSource, userDestination, cpSwapRemainingAccounts } = params;
  
  const [fifoState] = getFifoStatePDA();
  const [orderState] = getOrderPDA(orderUser, sequence);
  const [poolRegistry] = getPoolRegistryPDA(poolId);
  const [poolAuthority] = getPoolAuthorityPDA(poolId);
  
  const keys = [
    { pubkey: fifoState, isSigner: false, isWritable: false },
    { pubkey: orderState, isSigner: false, isWritable: true },
    { pubkey: poolRegistry, isSigner: false, isWritable: false },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: executor, isSigner: true, isWritable: true },
    { pubkey: userSource, isSigner: false, isWritable: true },
    { pubkey: userDestination, isSigner: false, isWritable: true },
    { pubkey: CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
    // Add CP-Swap specific accounts
    ...cpSwapRemainingAccounts.map(pubkey => ({
      pubkey,
      isSigner: false,
      isWritable: true, // Most CP-Swap accounts are writable
    })),
  ];

  // Discriminator for execute_order: [115, 61, 180, 24, 168, 32, 215, 20]
  const discriminator = Buffer.from([115, 61, 180, 24, 168, 32, 215, 20]);
  
  // Encode expected_sequence
  const data = Buffer.concat([
    discriminator,
    sequence.toArrayLike(Buffer, 'le', 8),
  ]);

  return new TransactionInstruction({
    keys,
    programId: CONTINUUM_PROGRAM_ID,
    data,
  });
}

/**
 * Create Ed25519 precompile instruction + execute order instruction
 * for relayer signature verification
 */
export function createExecuteOrderInstructionsWithSignature(
  params: ExecuteOrderParams,
  relayerKeypair: Keypair
): TransactionInstruction[] {
  const { executor, sequence } = params;

  // Create Ed25519 precompile instruction for relayer signature verification
  const ed25519Ix = createEd25519Instruction(relayerKeypair, sequence, executor);

  // Create execute order instruction
  const executeOrderIx = createExecuteOrderInstruction(params);

  return [ed25519Ix, executeOrderIx];
}