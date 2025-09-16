import { TransactionInstruction, PublicKey, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
export interface ExecuteOrderParams {
    executor: PublicKey;
    orderUser: PublicKey;
    sequence: BN;
    poolId: PublicKey;
    userSource: PublicKey;
    userDestination: PublicKey;
    cpSwapRemainingAccounts: PublicKey[];
}
export declare function createExecuteOrderInstruction(params: ExecuteOrderParams): TransactionInstruction;
/**
 * Create Ed25519 precompile instruction + execute order instruction
 * for relayer signature verification
 */
export declare function createExecuteOrderInstructionsWithSignature(params: ExecuteOrderParams, relayerKeypair: Keypair): TransactionInstruction[];
