import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import BN from 'bn.js';
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
export declare function createWithdrawLpInstruction(params: WithdrawLpParams): TransactionInstruction;
