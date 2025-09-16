import { Connection, PublicKey, Transaction, TransactionSignature, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
import { Wallet } from '@coral-xyz/anchor';
import { ExecuteOrderParams, InitializeCpSwapPoolParams } from '../instructions';
import { FifoState, OrderState, CpSwapPoolRegistry, SwapParams } from '../types';
export declare class ContinuumClient {
    private connection;
    private program?;
    constructor(connection: Connection, wallet?: Wallet);
    /**
     * Initialize the Continuum FIFO state
     */
    initialize(admin: Keypair, relayerPubkey: PublicKey): Promise<TransactionSignature>;
    /**
     * Get the current FIFO state
     */
    getFifoState(): Promise<FifoState | null>;
    /**
     * Submit a swap order
     */
    submitOrder(user: Keypair, params: SwapParams): Promise<{
        signature: TransactionSignature;
        sequence: BN;
    }>;
    /**
     * Execute an order (for relayers)
     */
    executeOrder(executor: Keypair, params: ExecuteOrderParams): Promise<TransactionSignature>;
    /**
     * Cancel an order
     */
    cancelOrder(user: Keypair, sequence: BN): Promise<TransactionSignature>;
    /**
     * Get order state
     */
    getOrderState(user: PublicKey, sequence: BN): Promise<OrderState | null>;
    /**
     * Get all pending orders for a pool
     */
    getPendingOrders(poolId: PublicKey): Promise<OrderState[]>;
    /**
     * Create a partially signed transaction for order submission
     */
    createPartiallySignedSubmitOrder(user: PublicKey, params: SwapParams): Promise<{
        transaction: Transaction;
        sequence: BN;
    }>;
    /**
     * Helper to send and confirm transaction
     */
    private sendTransaction;
    /**
     * Initialize a CP-Swap pool with Continuum authority
     */
    initializeCpSwapPool(admin: Keypair, params: InitializeCpSwapPoolParams): Promise<TransactionSignature>;
    /**
     * Get pool registry
     */
    getPoolRegistry(poolId: PublicKey): Promise<CpSwapPoolRegistry | null>;
}
