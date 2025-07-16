"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const ws_1 = require("ws");
const web3_js_1 = require("@solana/web3.js");
const relayerService_1 = require("./relayerService");
const config_1 = require("./config");
const winston_1 = __importDefault(require("winston"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const helmet_1 = __importDefault(require("helmet"));
const zod_1 = require("zod");
// Configure logger
const logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.simple())
        }),
        new winston_1.default.transports.File({ filename: 'relayer.log' })
    ]
});
// Initialize services
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server });
// Middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));
app.use(express_1.default.json({ limit: '10mb' }));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests from this IP'
});
const submitLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 10, // 10 submissions per minute
    message: 'Too many order submissions'
});
app.use('/api/', limiter);
app.use('/api/v1/orders', submitLimiter);
// Request validation schemas
const submitOrderSchema = zod_1.z.object({
    transaction: zod_1.z.string(),
    poolId: zod_1.z.string(),
    amountIn: zod_1.z.string(),
    minAmountOut: zod_1.z.string(),
    isBaseInput: zod_1.z.boolean(),
    userPublicKey: zod_1.z.string()
});
const orderStatusSchema = zod_1.z.object({
    orderId: zod_1.z.string()
});
// Initialize relayer
let relayerService;
let relayerWallet;
let connection;
// WebSocket connections tracking
const wsClients = new Map();
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        relayer: relayerWallet.publicKey.toBase58(),
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0'
    });
});
// Get relayer info
app.get('/api/v1/info', (req, res) => {
    res.json({
        relayerAddress: relayerWallet.publicKey.toBase58(),
        continuumProgram: config_1.config.CONTINUUM_PROGRAM_ID,
        cpSwapProgram: config_1.config.CP_SWAP_PROGRAM_ID,
        fee: config_1.config.RELAYER_FEE_BPS || 0,
        minOrderSize: config_1.config.MIN_ORDER_SIZE || '0',
        maxOrderSize: config_1.config.MAX_ORDER_SIZE || '1000000000000',
        supportedPools: relayerService.getSupportedPools(),
        performance: {
            successRate: relayerService.getSuccessRate(),
            avgExecutionTime: relayerService.getAvgExecutionTime(),
            totalOrders: relayerService.getTotalOrders()
        }
    });
});
// Submit order endpoint
app.post('/api/v1/orders', async (req, res) => {
    try {
        // Validate request
        const params = submitOrderSchema.parse(req.body);
        logger.info('Received order submission', {
            poolId: params.poolId,
            user: params.userPublicKey,
            amountIn: params.amountIn
        });
        // Deserialize transaction
        let transaction;
        try {
            const txBuffer = Buffer.from(params.transaction, 'base64');
            // Try versioned transaction first
            try {
                transaction = web3_js_1.VersionedTransaction.deserialize(txBuffer);
            }
            catch {
                // Fall back to legacy transaction
                transaction = web3_js_1.Transaction.from(txBuffer);
            }
        }
        catch (error) {
            return res.status(400).json({
                error: 'Invalid transaction format'
            });
        }
        // Verify transaction is partially signed by user
        const userPubkey = new web3_js_1.PublicKey(params.userPublicKey);
        const isUserSigned = transaction instanceof web3_js_1.VersionedTransaction
            ? transaction.signatures.some((sig, idx) => {
                const signer = transaction.message.staticAccountKeys[idx];
                return signer.equals(userPubkey) && sig !== null;
            })
            : transaction.signatures.some((sig, idx) => {
                if (!sig.signature)
                    return false;
                const signer = transaction.feePayer || transaction.instructions[0]?.keys[0]?.pubkey;
                return signer?.equals(userPubkey);
            });
        if (!isUserSigned) {
            return res.status(400).json({
                error: 'Transaction must be signed by user'
            });
        }
        // Submit to relayer service
        const result = await relayerService.submitOrder({
            transaction,
            poolId: new web3_js_1.PublicKey(params.poolId),
            amountIn: params.amountIn,
            minAmountOut: params.minAmountOut,
            isBaseInput: params.isBaseInput,
            userPublicKey: userPubkey
        });
        // Send response
        res.json({
            success: true,
            orderId: result.orderId,
            orderPda: result.orderPda.toBase58(),
            sequence: result.sequence.toString(),
            estimatedExecutionTime: result.estimatedExecutionTime,
            fee: result.fee
        });
        // Notify WebSocket subscribers
        broadcastToOrderSubscribers(result.orderId, {
            type: 'order_submitted',
            orderId: result.orderId,
            sequence: result.sequence.toString(),
            status: 'pending'
        });
    }
    catch (error) {
        logger.error('Order submission failed', error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                error: 'Invalid request parameters',
                details: error.errors
            });
        }
        res.status(500).json({
            error: error.message || 'Internal server error'
        });
    }
});
// Get order status
app.get('/api/v1/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = orderStatusSchema.parse({ orderId: req.params.orderId });
        const status = await relayerService.getOrderStatus(orderId);
        if (!status) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }
        res.json(status);
    }
    catch (error) {
        logger.error('Failed to get order status', error);
        res.status(500).json({
            error: 'Failed to retrieve order status'
        });
    }
});
// Cancel order (only for pending orders)
app.delete('/api/v1/orders/:orderId', async (req, res) => {
    try {
        const { orderId } = orderStatusSchema.parse({ orderId: req.params.orderId });
        // Verify user signature for cancellation
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Authorization required'
            });
        }
        const signature = authHeader.substring(7);
        const result = await relayerService.cancelOrder(orderId, signature);
        res.json({
            success: true,
            message: 'Order cancelled',
            refund: result.refund
        });
        // Notify WebSocket subscribers
        broadcastToOrderSubscribers(orderId, {
            type: 'order_cancelled',
            orderId,
            status: 'cancelled'
        });
    }
    catch (error) {
        logger.error('Order cancellation failed', error);
        res.status(500).json({
            error: 'Failed to cancel order'
        });
    }
});
// Get supported pools
app.get('/api/v1/pools', async (req, res) => {
    try {
        const pools = await relayerService.getSupportedPoolsWithInfo();
        res.json({
            pools: pools.map(pool => ({
                poolId: pool.poolId,
                token0: pool.token0,
                token1: pool.token1,
                fee: pool.fee,
                liquidity: pool.liquidity,
                volume24h: pool.volume24h,
                isActive: pool.isActive
            }))
        });
    }
    catch (error) {
        logger.error('Failed to get pools', error);
        res.status(500).json({
            error: 'Failed to retrieve pools'
        });
    }
});
// Get relayer statistics
app.get('/api/v1/stats', async (req, res) => {
    try {
        const stats = await relayerService.getStatistics();
        res.json(stats);
    }
    catch (error) {
        logger.error('Failed to get statistics', error);
        res.status(500).json({
            error: 'Failed to retrieve statistics'
        });
    }
});
// WebSocket handling
wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    logger.info('WebSocket connection established', { path });
    if (path.startsWith('/ws/orders/')) {
        // Subscribe to specific order updates
        const orderId = path.substring('/ws/orders/'.length);
        if (!wsClients.has(orderId)) {
            wsClients.set(orderId, new Set());
        }
        wsClients.get(orderId).add(ws);
        // Send current status
        relayerService.getOrderStatus(orderId).then(status => {
            if (status) {
                ws.send(JSON.stringify({
                    type: 'status_update',
                    ...status
                }));
            }
        });
        ws.on('close', () => {
            const clients = wsClients.get(orderId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    wsClients.delete(orderId);
                }
            }
        });
    }
    else if (path === '/ws/feed') {
        // Subscribe to all order updates
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());
                if (data.type === 'subscribe') {
                    // Handle subscription to specific events
                    ws.send(JSON.stringify({
                        type: 'subscribed',
                        events: data.events || ['all']
                    }));
                }
            }
            catch (error) {
                logger.error('Invalid WebSocket message', error);
            }
        });
    }
    ws.on('error', (error) => {
        logger.error('WebSocket error', error);
    });
});
// Broadcast to order subscribers
function broadcastToOrderSubscribers(orderId, data) {
    const clients = wsClients.get(orderId);
    if (clients) {
        const message = JSON.stringify(data);
        clients.forEach(client => {
            if (client.readyState === 1) { // OPEN
                client.send(message);
            }
        });
    }
}
// Initialize and start server
async function start() {
    try {
        // Load configuration
        logger.info('Starting Continuum relayer service...');
        // Initialize connection
        connection = new web3_js_1.Connection(config_1.config.RPC_URL, {
            commitment: 'confirmed',
            wsEndpoint: config_1.config.WS_URL
        });
        // Load relayer keypair
        const keypairPath = config_1.config.RELAYER_KEYPAIR_PATH || './relayer-keypair.json';
        try {
            const keypairData = require(keypairPath);
            relayerWallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(keypairData));
        }
        catch (error) {
            logger.error('Failed to load relayer keypair', error);
            logger.info('Generating new relayer keypair...');
            relayerWallet = web3_js_1.Keypair.generate();
            // Save for future use
            const fs = require('fs');
            fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerWallet.secretKey)));
        }
        logger.info('Relayer address:', relayerWallet.publicKey.toBase58());
        // Check relayer balance
        const balance = await connection.getBalance(relayerWallet.publicKey);
        logger.info(`Relayer balance: ${balance / 1e9} SOL`);
        if (balance < 0.1 * 1e9) {
            logger.warn('Low relayer balance! Please fund the relayer wallet.');
        }
        // Initialize relayer service
        relayerService = new relayerService_1.RelayerService(connection, relayerWallet, new web3_js_1.PublicKey(config_1.config.CONTINUUM_PROGRAM_ID), new web3_js_1.PublicKey(config_1.config.CP_SWAP_PROGRAM_ID), logger);
        // Set up order execution callbacks
        relayerService.on('orderExecuted', (orderId, result) => {
            broadcastToOrderSubscribers(orderId, {
                type: 'order_executed',
                orderId,
                status: 'executed',
                signature: result.signature,
                executionPrice: result.executionPrice,
                actualAmountOut: result.actualAmountOut
            });
        });
        relayerService.on('orderFailed', (orderId, error) => {
            broadcastToOrderSubscribers(orderId, {
                type: 'order_failed',
                orderId,
                status: 'failed',
                error: error.message
            });
        });
        // Start relayer service
        await relayerService.start();
        // Start HTTP server
        const PORT = process.env.PORT || 8085;
        server.listen(PORT, () => {
            logger.info(`Relayer server listening on port ${PORT}`);
            logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
            logger.info(`HTTP API endpoint: http://localhost:${PORT}/api/v1`);
        });
        // Graceful shutdown
        process.on('SIGTERM', shutdown);
        process.on('SIGINT', shutdown);
    }
    catch (error) {
        logger.error('Failed to start relayer', error);
        process.exit(1);
    }
}
async function shutdown() {
    logger.info('Shutting down relayer...');
    try {
        // Stop accepting new connections
        server.close();
        // Close WebSocket connections
        wss.clients.forEach(client => {
            client.close();
        });
        // Stop relayer service
        if (relayerService) {
            await relayerService.stop();
        }
        logger.info('Relayer shutdown complete');
        process.exit(0);
    }
    catch (error) {
        logger.error('Error during shutdown', error);
        process.exit(1);
    }
}
// Error handling
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown();
});
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled rejection', error);
    shutdown();
});
// Start the server
start().catch(error => {
    logger.error('Failed to start server', error);
    process.exit(1);
});
