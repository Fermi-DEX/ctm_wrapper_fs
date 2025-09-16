import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
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
export declare function createDepositLpInstruction(params: DepositLpParams): TransactionInstruction;
