import { TransactionInstruction, PublicKey } from '@solana/web3.js';
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
export declare function getCpSwapPDAs(token0: PublicKey, token1: PublicKey, ammConfig: PublicKey): CpSwapPDAs;
/**
 * Creates an instruction to initialize a CP-Swap pool with CTM Wrapper as custom authority
 * This directly calls the CP-Swap program with the CTM authority set
 */
export declare function createInitializeCpSwapPoolDirectInstruction(params: InitializeCpSwapPoolDirectParams): TransactionInstruction;
/**
 * Creates an instruction to ensure the fee account exists
 */
export declare function createFeeAccountInstruction(payer: PublicKey, sortedToken0: PublicKey, feeOwner?: PublicKey): TransactionInstruction | null;
