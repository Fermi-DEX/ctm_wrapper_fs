import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
export declare enum OrderStatus {
    Pending = 0,
    Executed = 1,
    Cancelled = 2,
    Failed = 3
}
export interface OrderState {
    sequence: BN;
    user: PublicKey;
    poolId: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
    isBaseInput: boolean;
    status: OrderStatus;
    submittedAt: BN;
    executedAt: BN | null;
}
export interface FifoState {
    currentSequence: BN;
    admin: PublicKey;
    relayerPubkey: PublicKey;
    emergencyPause: boolean;
}
export interface CpSwapPoolRegistry {
    poolId: PublicKey;
    token0: PublicKey;
    token1: PublicKey;
    continuumAuthority: PublicKey;
    createdAt: BN;
    isActive: boolean;
}
export interface SwapParams {
    poolId: PublicKey;
    amountIn: BN;
    minAmountOut: BN;
    isBaseInput: boolean;
    userSourceToken: PublicKey;
    userDestinationToken: PublicKey;
}
