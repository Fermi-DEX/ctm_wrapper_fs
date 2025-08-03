"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerService = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const events_1 = require("events");
const cp_swap_sdk_1 = require("@continuum/cp-swap-sdk");
const config_1 = require("./config");
class RelayerService extends events_1.EventEmitter {
    constructor(connection, relayerWallet, continuumProgramId, cpSwapProgramId, logger) {
        super();
        this.connection = connection;
        this.relayerWallet = relayerWallet;
        this.continuumProgramId = continuumProgramId;
        this.cpSwapProgramId = cpSwapProgramId;
        this.logger = logger;
        this.orders = new Map();
        this.executionQueue = [];
        this.isRunning = false;
        this.stats = {
            totalOrders: 0,
            successfulOrders: 0,
            failedOrders: 0,
            totalExecutionTime: 0,
        };
    }
    async start() {
        this.isRunning = true;
        this.logger.info('Relayer service started');
        // Start execution loop
        this.executionLoop();
    }
    async stop() {
        this.isRunning = false;
        this.logger.info('Relayer service stopped');
    }
    async submitOrder(params) {
        const orderId = `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sequence = new anchor_1.BN(this.stats.totalOrders + 1);
        // Create order status
        const orderStatus = {
            orderId,
            status: 'pending',
            sequence: sequence.toString(),
            poolId: params.poolId.toBase58(),
            userPublicKey: params.userPublicKey.toBase58(),
            amountIn: params.amountIn,
        };
        this.orders.set(orderId, orderStatus);
        this.executionQueue.push(orderId);
        this.stats.totalOrders++;
        // Calculate PDA (mock)
        const [orderPda] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('order'),
            params.userPublicKey.toBuffer(),
            sequence.toArrayLike(Buffer, 'le', 8)
        ], this.continuumProgramId);
        const result = {
            orderId,
            orderPda,
            sequence,
            estimatedExecutionTime: 5000, // 5 seconds estimate
            fee: '100000', // 0.0001 SOL
        };
        this.logger.info('Order submitted', {
            orderId,
            sequence: sequence.toString(),
            poolId: params.poolId.toBase58(),
        });
        return result;
    }
    async getOrderStatus(orderId) {
        return this.orders.get(orderId) || null;
    }
    async cancelOrder(orderId, signature) {
        const order = this.orders.get(orderId);
        if (!order) {
            throw new Error('Order not found');
        }
        if (order.status !== 'pending') {
            throw new Error('Can only cancel pending orders');
        }
        // TODO: Verify signature
        order.status = 'cancelled';
        // Remove from execution queue
        const index = this.executionQueue.indexOf(orderId);
        if (index > -1) {
            this.executionQueue.splice(index, 1);
        }
        return { refund: '0' }; // No refund in this mock
    }
    getSupportedPools() {
        // Mock pool list
        return [
            'BhPUKnKuzpEYNhSSNxkze51tMVza25rgXfEv5LWgGng2',
            'HaDuGHuAQEocjTvN4nTM3c1uHGv3KSTasen58aizEhVW',
        ];
    }
    async getSupportedPoolsWithInfo() {
        // Mock pool info
        return this.getSupportedPools().map(poolId => ({
            poolId,
            token0: 'So11111111111111111111111111111111111111112',
            token1: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            fee: 0.003,
            liquidity: '1000000000000',
            volume24h: '50000000000',
            isActive: true,
        }));
    }
    getSuccessRate() {
        if (this.stats.totalOrders === 0)
            return 1;
        return this.stats.successfulOrders / this.stats.totalOrders;
    }
    getAvgExecutionTime() {
        if (this.stats.successfulOrders === 0)
            return 0;
        return this.stats.totalExecutionTime / this.stats.successfulOrders;
    }
    getTotalOrders() {
        return this.stats.totalOrders;
    }
    async getStatistics() {
        return {
            totalOrders: this.stats.totalOrders,
            successfulOrders: this.stats.successfulOrders,
            failedOrders: this.stats.failedOrders,
            successRate: this.getSuccessRate(),
            avgExecutionTime: this.getAvgExecutionTime(),
            pendingOrders: this.executionQueue.length,
            relayerBalance: await this.connection.getBalance(this.relayerWallet.publicKey) / 1e9,
        };
    }
    async executionLoop() {
        while (this.isRunning) {
            if (this.executionQueue.length > 0) {
                const orderId = this.executionQueue.shift();
                await this.executeOrder(orderId);
            }
            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    async executeOrder(orderId) {
        const order = this.orders.get(orderId);
        if (!order || order.status !== 'pending')
            return;
        const startTime = Date.now();
        try {
            this.logger.info('Executing order', { orderId, sequence: order.sequence });
            // If using mock mode, keep the old behavior
            if (config_1.config.enableMockMode) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const signature = 'mock_' + Math.random().toString(36).substr(2, 9);
                order.status = 'executed';
                order.signature = signature;
                order.actualAmountOut = (parseInt(order.amountIn) * 0.98).toString();
                order.executionPrice = 0.98;
                order.executedAt = new Date().toISOString();
                const executionTime = Date.now() - startTime;
                this.stats.successfulOrders++;
                this.stats.totalExecutionTime += executionTime;
                this.logger.info('Order executed (mock)', {
                    orderId,
                    signature,
                    executionTime,
                });
                this.emit('orderExecuted', orderId, {
                    signature,
                    executionPrice: order.executionPrice,
                    actualAmountOut: order.actualAmountOut,
                });
                return;
            }
            // Real blockchain execution
            // Build execute order instruction
            const executeParams = {
                poolId: new web3_js_1.PublicKey(order.poolId),
                fifoSequence: new anchor_1.BN(order.sequence),
                executor: this.relayerWallet.publicKey,
            };
            const executeIx = (0, cp_swap_sdk_1.createExecuteOrderInstruction)(executeParams);
            const transaction = new web3_js_1.Transaction().add(executeIx);
            // Add priority fee if configured
            if (config_1.config.priorityFeeLevel !== 'none') {
                const priorityFeeMap = {
                    low: 10000,
                    medium: 50000,
                    high: 100000
                };
                const microLamports = priorityFeeMap[config_1.config.priorityFeeLevel];
                transaction.add(web3_js_1.ComputeBudgetProgram.setComputeUnitPrice({
                    microLamports
                }));
            }
            // Send and confirm transaction
            const signature = await this.connection.sendTransaction(transaction, [this.relayerWallet], {
                skipPreflight: false,
                preflightCommitment: 'confirmed'
            });
            // Wait for confirmation
            const latestBlockhash = await this.connection.getLatestBlockhash();
            const confirmationResult = await this.connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, 'confirmed');
            if (confirmationResult.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmationResult.value.err)}`);
            }
            // Parse transaction result to get actual output amount
            // In a real implementation, we would parse the transaction logs or account data
            // For now, we'll estimate based on pool state
            const poolConfig = config_1.config.supportedPools.find(p => p.poolId === order.poolId);
            if (poolConfig) {
                const [tokenAVault, tokenBVault] = await Promise.all([
                    this.connection.getTokenAccountBalance(new web3_js_1.PublicKey(poolConfig.tokenAVault)),
                    this.connection.getTokenAccountBalance(new web3_js_1.PublicKey(poolConfig.tokenBVault))
                ]);
                const tokenABalance = Number(tokenAVault.value.amount);
                const tokenBBalance = Number(tokenBVault.value.amount);
                // Simple constant product calculation
                const amountIn = parseInt(order.amountIn);
                const k = tokenABalance * tokenBBalance;
                const newTokenABalance = tokenABalance + amountIn;
                const newTokenBBalance = k / newTokenABalance;
                const amountOut = tokenBBalance - newTokenBBalance;
                order.actualAmountOut = Math.floor(amountOut * 0.9975).toString(); // Apply 0.25% fee
                order.executionPrice = amountOut / amountIn;
            }
            else {
                // Fallback estimation
                order.actualAmountOut = (parseInt(order.amountIn) * 0.98).toString();
                order.executionPrice = 0.98;
            }
            order.status = 'executed';
            order.signature = signature;
            order.executedAt = new Date().toISOString();
            const executionTime = Date.now() - startTime;
            this.stats.successfulOrders++;
            this.stats.totalExecutionTime += executionTime;
            this.logger.info('Order executed', {
                orderId,
                signature,
                executionTime,
                actualAmountOut: order.actualAmountOut
            });
            this.emit('orderExecuted', orderId, {
                signature,
                executionPrice: order.executionPrice,
                actualAmountOut: order.actualAmountOut,
            });
        }
        catch (error) {
            order.status = 'failed';
            order.error = error instanceof Error ? error.message : String(error);
            this.stats.failedOrders++;
            this.logger.error('Order execution failed', {
                orderId,
                error: error instanceof Error ? error.message : String(error),
            });
            this.emit('orderFailed', orderId, error);
        }
    }
}
exports.RelayerService = RelayerService;
