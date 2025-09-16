"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContinuumClient = void 0;
const web3_js_1 = require("@solana/web3.js");
const bn_js_1 = __importDefault(require("bn.js"));
const anchor_1 = require("@coral-xyz/anchor");
const instructions_1 = require("../instructions");
const utils_1 = require("../utils");
class ContinuumClient {
    constructor(connection, wallet) {
        this.connection = connection;
        if (wallet) {
            const provider = new anchor_1.AnchorProvider(connection, wallet, {});
            // Note: In production, load the actual IDL
            // this.program = new Program(IDL, CONTINUUM_PROGRAM_ID, provider);
        }
    }
    /**
     * Initialize the Continuum FIFO state
     */
    async initialize(admin, relayerPubkey) {
        const ix = (0, instructions_1.createInitializeInstruction)(admin.publicKey, relayerPubkey);
        const tx = new web3_js_1.Transaction().add(ix);
        return await this.sendTransaction(tx, [admin]);
    }
    /**
     * Get the current FIFO state
     */
    async getFifoState() {
        const [fifoStatePDA] = (0, utils_1.getFifoStatePDA)();
        const accountInfo = await this.connection.getAccountInfo(fifoStatePDA);
        if (!accountInfo)
            return null;
        // Parse the account data (simplified - use Anchor's decoder in production)
        const data = accountInfo.data;
        return {
            currentSequence: new bn_js_1.default(data.slice(8, 16), 'le'),
            admin: new web3_js_1.PublicKey(data.slice(16, 48)),
            relayerPubkey: new web3_js_1.PublicKey(data.slice(48, 80)),
            emergencyPause: data[80] === 1,
        };
    }
    /**
     * Submit a swap order
     */
    async submitOrder(user, params) {
        const fifoState = await this.getFifoState();
        if (!fifoState)
            throw new Error('FIFO state not initialized');
        const ix = await (0, instructions_1.createSubmitOrderInstruction)(user.publicKey, params.poolId, params.amountIn, params.minAmountOut, params.isBaseInput, fifoState.currentSequence);
        const tx = new web3_js_1.Transaction().add(ix);
        const signature = await this.sendTransaction(tx, [user]);
        return {
            signature,
            sequence: fifoState.currentSequence.add(new bn_js_1.default(1))
        };
    }
    /**
     * Execute an order (for relayers)
     */
    async executeOrder(executor, params) {
        const instructions = (0, instructions_1.createExecuteOrderInstructionsWithSignature)(params, executor);
        const tx = new web3_js_1.Transaction().add(...instructions);
        return await this.sendTransaction(tx, [executor]);
    }
    /**
     * Cancel an order
     */
    async cancelOrder(user, sequence) {
        const ix = (0, instructions_1.createCancelOrderInstruction)(user.publicKey, sequence);
        const tx = new web3_js_1.Transaction().add(ix);
        return await this.sendTransaction(tx, [user]);
    }
    /**
     * Get order state
     */
    async getOrderState(user, sequence) {
        const [orderPDA] = (0, utils_1.getOrderPDA)(user, sequence);
        const accountInfo = await this.connection.getAccountInfo(orderPDA);
        if (!accountInfo)
            return null;
        // Parse the account data (simplified - use Anchor's decoder in production)
        const data = accountInfo.data;
        let offset = 8; // Skip discriminator
        return {
            sequence: new bn_js_1.default(data.slice(offset, offset + 8), 'le'),
            user: new web3_js_1.PublicKey(data.slice(offset + 8, offset + 40)),
            poolId: new web3_js_1.PublicKey(data.slice(offset + 40, offset + 72)),
            amountIn: new bn_js_1.default(data.slice(offset + 72, offset + 80), 'le'),
            minAmountOut: new bn_js_1.default(data.slice(offset + 80, offset + 88), 'le'),
            isBaseInput: data[offset + 88] === 1,
            status: data[offset + 89],
            submittedAt: new bn_js_1.default(data.slice(offset + 90, offset + 98), 'le'),
            executedAt: data[offset + 98] === 0 ? null : new bn_js_1.default(data.slice(offset + 99, offset + 107), 'le'),
        };
    }
    /**
     * Get all pending orders for a pool
     */
    async getPendingOrders(poolId) {
        // In production, use getProgramAccounts with filters
        // This is a simplified version
        return [];
    }
    /**
     * Create a partially signed transaction for order submission
     */
    async createPartiallySignedSubmitOrder(user, params) {
        const fifoState = await this.getFifoState();
        if (!fifoState)
            throw new Error('FIFO state not initialized');
        const ix = await (0, instructions_1.createSubmitOrderInstruction)(user, params.poolId, params.amountIn, params.minAmountOut, params.isBaseInput, fifoState.currentSequence);
        const tx = new web3_js_1.Transaction().add(ix);
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = user;
        return {
            transaction: tx,
            sequence: fifoState.currentSequence.add(new bn_js_1.default(1))
        };
    }
    /**
     * Helper to send and confirm transaction
     */
    async sendTransaction(transaction, signers) {
        const { blockhash } = await this.connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = signers[0].publicKey;
        transaction.sign(...signers);
        const signature = await this.connection.sendRawTransaction(transaction.serialize());
        await this.connection.confirmTransaction(signature);
        return signature;
    }
    /**
     * Initialize a CP-Swap pool with Continuum authority
     */
    async initializeCpSwapPool(admin, params) {
        const ix = (0, instructions_1.createInitializeCpSwapPoolInstruction)(params);
        const tx = new web3_js_1.Transaction().add(ix);
        return await this.sendTransaction(tx, [admin]);
    }
    /**
     * Get pool registry
     */
    async getPoolRegistry(poolId) {
        const [registryPDA] = (0, utils_1.getPoolRegistryPDA)(poolId);
        const accountInfo = await this.connection.getAccountInfo(registryPDA);
        if (!accountInfo)
            return null;
        // Parse the account data (simplified - use Anchor's decoder in production)
        const data = accountInfo.data;
        let offset = 8; // Skip discriminator
        return {
            poolId: new web3_js_1.PublicKey(data.slice(offset, offset + 32)),
            token0: new web3_js_1.PublicKey(data.slice(offset + 32, offset + 64)),
            token1: new web3_js_1.PublicKey(data.slice(offset + 64, offset + 96)),
            continuumAuthority: new web3_js_1.PublicKey(data.slice(offset + 96, offset + 128)),
            createdAt: new bn_js_1.default(data.slice(offset + 128, offset + 136), 'le'),
            isActive: data[offset + 136] === 1,
        };
    }
}
exports.ContinuumClient = ContinuumClient;
