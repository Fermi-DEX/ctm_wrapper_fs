import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { RelayerService } from './relayerService';
import { config } from './config';
import winston from 'winston';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createTransferInstruction, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ filename: 'relayer.log' })
  ]
});

// Initialize services
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests from this IP'
});

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 submissions per minute
  message: 'Too many order submissions'
});

app.use('/api/', limiter);
app.use('/api/v1/orders', submitLimiter);

// Request validation schemas
const submitOrderSchema = z.object({
  transaction: z.string(),
  poolId: z.string(),
  amountIn: z.string(),
  minAmountOut: z.string(),
  isBaseInput: z.boolean(),
  userPublicKey: z.string()
});

const createOrderSchema = z.object({
  poolId: z.string(),
  amountIn: z.string(),
  minAmountOut: z.string(),
  isBaseInput: z.boolean(),
  userPublicKey: z.string(),
  userTokenA: z.string(),
  userTokenB: z.string()
});

const orderStatusSchema = z.object({
  orderId: z.string()
});

// Initialize relayer
let relayerService: RelayerService;
let relayerWallet: Keypair;
let connection: Connection;

// WebSocket connections tracking
const wsClients = new Map<string, Set<any>>();

// Airdrop rate limiting tracking
const airdropLastRequest = new Map<string, number>();

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
    continuumProgram: config.continuumProgramId.toBase58(),
    cpSwapProgram: config.cpSwapProgramId.toBase58(),
    fee: 0, // TODO: Add relayerFeeBps to config if needed
    minOrderSize: '0', // TODO: Add minOrderSize to config if needed
    maxOrderSize: '1000000000000', // TODO: Add maxOrderSize to config if needed
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
    let transaction: Transaction | VersionedTransaction;
    try {
      const txBuffer = Buffer.from(params.transaction, 'base64');
      
      // Try versioned transaction first
      try {
        transaction = VersionedTransaction.deserialize(txBuffer);
      } catch {
        // Fall back to legacy transaction
        transaction = Transaction.from(txBuffer);
      }
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid transaction format'
      });
    }

    // Verify transaction is partially signed by user
    const userPubkey = new PublicKey(params.userPublicKey);
    const isUserSigned = transaction instanceof VersionedTransaction
      ? transaction.signatures.some((sig, idx) => {
          const signer = transaction.message.staticAccountKeys[idx];
          return signer.equals(userPubkey) && sig !== null;
        })
      : transaction.signatures.some((sig, idx) => {
          if (!sig.signature) return false;
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
      poolId: new PublicKey(params.poolId),
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

  } catch (error) {
    logger.error('Order submission failed', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.errors
      });
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
    });
  }
});

// Create order endpoint - relayer builds and partially signs transaction
app.post('/api/v1/orders2', async (req, res) => {
  try {
    // Validate request
    const params = createOrderSchema.parse(req.body);
    
    logger.info('Received order creation request', {
      poolId: params.poolId,
      user: params.userPublicKey,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      isBaseInput: params.isBaseInput,
      userTokenA: params.userTokenA,
      userTokenB: params.userTokenB
    });

    // Build transaction with relayer signature
    const result = await relayerService.createOrderTransaction(params);
    
    res.json({
      success: true,
      orderId: result.orderId,
      transaction: result.transactionBase64,
      orderPda: result.orderPda.toBase58(),
      sequence: result.sequence.toString(),
      estimatedExecutionTime: result.estimatedExecutionTime,
      fee: result.fee,
      message: 'Transaction built and partially signed by relayer. Please sign with wallet and broadcast.'
    });
    
  } catch (error) {
    logger.error('Error creating order transaction:', error);
    
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request parameters',
        details: error.errors
      });
    }

    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error'
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
  } catch (error) {
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

  } catch (error) {
    logger.error('Order cancellation failed', error);
    res.status(500).json({
      error: 'Failed to cancel order',
      message: error instanceof Error ? error.message : String(error)
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
  } catch (error) {
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
  } catch (error) {
    logger.error('Failed to get statistics', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics'
    });
  }
});

// Get current pool price
app.get('/api/v1/pools/:poolId/price', async (req, res) => {
  try {
    const { poolId } = req.params;
    
    // Validate pool ID
    try {
      new PublicKey(poolId);
    } catch {
      return res.status(400).json({
        error: 'Invalid pool ID'
      });
    }

    // Find pool configuration
    const poolConfig = config.supportedPools.find(p => p.poolId === poolId);
    if (!poolConfig) {
      return res.status(404).json({
        error: 'Pool not found'
      });
    }

    // Fetch pool state from CP-Swap
    const poolPubkey = new PublicKey(poolId);
    const poolAccount = await connection.getAccountInfo(poolPubkey);
    
    if (!poolAccount) {
      return res.status(404).json({
        error: 'Pool account not found on chain'
      });
    }

    // Fetch vault balances
    const [tokenAVault, tokenBVault] = await Promise.all([
      connection.getTokenAccountBalance(new PublicKey(poolConfig.tokenAVault)),
      connection.getTokenAccountBalance(new PublicKey(poolConfig.tokenBVault))
    ]);

    const tokenABalance = Number(tokenAVault.value.amount);
    const tokenBBalance = Number(tokenBVault.value.amount);

    // Calculate prices accounting for decimals
    const tokenAUiAmount = tokenABalance / Math.pow(10, poolConfig.tokenADecimals);
    const tokenBUiAmount = tokenBBalance / Math.pow(10, poolConfig.tokenBDecimals);

    // Price calculations
    const tokenAPerTokenB = tokenAUiAmount / tokenBUiAmount;
    const tokenBPerTokenA = tokenBUiAmount / tokenAUiAmount;

    const response = {
      poolId,
      tokenA: {
        mint: poolConfig.tokenAMint,
        symbol: poolConfig.tokenASymbol,
        decimals: poolConfig.tokenADecimals,
        balance: tokenABalance,
        uiAmount: tokenAUiAmount
      },
      tokenB: {
        mint: poolConfig.tokenBMint,
        symbol: poolConfig.tokenBSymbol,
        decimals: poolConfig.tokenBDecimals,
        balance: tokenBBalance,
        uiAmount: tokenBUiAmount
      },
      price: {
        [`${poolConfig.tokenASymbol}Per${poolConfig.tokenBSymbol}`]: tokenAPerTokenB.toFixed(6),
        [`${poolConfig.tokenBSymbol}Per${poolConfig.tokenASymbol}`]: tokenBPerTokenA.toFixed(6)
      },
      liquidity: {
        tokenA: tokenABalance,
        tokenB: tokenBBalance,
        totalValueUSD: null // Can be calculated if we have USD prices
      },
      lastUpdate: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    logger.error('Failed to get pool price', error);
    res.status(500).json({
      error: 'Failed to fetch pool price',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Airdrop endpoint (for testing)
app.post('/api/v1/airdrop', async (req, res) => {
  try {
    // Check if airdrop is enabled
    if (!config.enableAirdrop) {
      return res.status(403).json({
        error: 'Airdrop is disabled'
      });
    }

    // Validate request
    const airdropSchema = z.object({
      address: z.string().refine(addr => {
        try {
          new PublicKey(addr);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid public key'),
      token: z.enum(['SOL', 'USDC', 'WSOL']).optional(),
      amount: z.number().optional()
    });

    const params = airdropSchema.parse(req.body);
    const recipientPubkey = new PublicKey(params.address);
    const tokenType = params.token || 'USDC';

    // Check rate limit
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const lastRequest = airdropLastRequest.get(clientIp) || 0;
    const now = Date.now();

    if (now - lastRequest < config.airdropRateLimitMs) {
      const remainingTime = Math.ceil((config.airdropRateLimitMs - (now - lastRequest)) / 1000);
      return res.status(429).json({
        error: `Rate limited. Please wait ${remainingTime} seconds before requesting another airdrop`
      });
    }

    // Handle different token types
    if (tokenType === 'SOL') {
      // SOL airdrop
      const amountLamports = params.amount ? params.amount * 1e9 : config.airdropAmountSol * 1e9;
      
      // Validate amount
      const maxAmount = 2 * 1e9; // 2 SOL max
      if (amountLamports < 0 || amountLamports > maxAmount) {
        return res.status(400).json({
          error: `Invalid amount. Must be between 0 and ${maxAmount / 1e9} SOL`
        });
      }

      logger.info('Processing SOL airdrop request', {
        recipient: recipientPubkey.toBase58(),
        amount: amountLamports / 1e9,
        ip: clientIp
      });

      // Request airdrop
      const signature = await connection.requestAirdrop(recipientPubkey, amountLamports);
      
      // Wait for confirmation
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      });

      // Update rate limit
      airdropLastRequest.set(clientIp, now);

      // Get new balance
      const newBalance = await connection.getBalance(recipientPubkey);

      res.json({
        success: true,
        token: 'SOL',
        signature,
        amount: amountLamports / 1e9,
        recipient: recipientPubkey.toBase58(),
        newBalance: newBalance / 1e9
      });

      logger.info('SOL airdrop successful', {
        signature,
        recipient: recipientPubkey.toBase58(),
        amount: amountLamports / 1e9
      });
    } else {
      // Token airdrop (USDC or WSOL)
      if (!config.isDevnet || !config.tokens) {
        return res.status(400).json({
          error: 'Token airdrops only available on devnet'
        });
      }

      const tokenConfig = config.tokens[tokenType];
      if (!tokenConfig) {
        return res.status(400).json({
          error: `Token ${tokenType} not supported`
        });
      }

      // Determine amount based on token type
      let tokenAmount: number;
      if (params.amount) {
        tokenAmount = params.amount;
      } else {
        // Default amounts from constants.json
        const defaultAmounts = {
          USDC: 1000,
          WSOL: 10
        };
        tokenAmount = defaultAmounts[tokenType] || 100;
      }

      const tokenMint = new PublicKey(tokenConfig.mint);
      const decimals = tokenConfig.decimals;
      const amountUnits = tokenAmount * Math.pow(10, decimals);

      logger.info(`Processing ${tokenType} airdrop request`, {
        recipient: recipientPubkey.toBase58(),
        amount: tokenAmount,
        mint: tokenMint.toBase58(),
        ip: clientIp
      });

      // Get or create recipient token account
      const recipientTokenAccount = getAssociatedTokenAddressSync(tokenMint, recipientPubkey);
      
      // Get relayer token account (source of tokens)
      const relayerTokenAccount = getAssociatedTokenAddressSync(tokenMint, relayerWallet.publicKey);

      // Check relayer balance
      try {
        const relayerBalance = await connection.getTokenAccountBalance(relayerTokenAccount);
        if (parseInt(relayerBalance.value.amount) < amountUnits) {
          return res.status(500).json({
            error: `Insufficient ${tokenType} balance in relayer wallet`
          });
        }
      } catch (err) {
        return res.status(500).json({
          error: `Relayer doesn't have ${tokenType} tokens. Please fund the relayer wallet.`
        });
      }

      // Build transaction
      const transaction = new Transaction();
      
      // Check if recipient token account exists
      const recipientAccountInfo = await connection.getAccountInfo(recipientTokenAccount);
      if (!recipientAccountInfo) {
        // Create associated token account
        transaction.add(
          createAssociatedTokenAccountInstruction(
            relayerWallet.publicKey,
            recipientTokenAccount,
            recipientPubkey,
            tokenMint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          )
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          relayerTokenAccount,
          recipientTokenAccount,
          relayerWallet.publicKey,
          amountUnits,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // Send and confirm transaction
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [relayerWallet]
      );

      // Update rate limit
      airdropLastRequest.set(clientIp, now);

      // Get new balance
      const newBalanceResponse = await connection.getTokenAccountBalance(recipientTokenAccount);
      const newBalance = parseFloat(newBalanceResponse.value.uiAmountString || '0');

      res.json({
        success: true,
        token: tokenType,
        signature,
        amount: tokenAmount,
        recipient: recipientPubkey.toBase58(),
        tokenAccount: recipientTokenAccount.toBase58(),
        newBalance
      });

      logger.info(`${tokenType} airdrop successful`, {
        signature,
        recipient: recipientPubkey.toBase58(),
        amount: tokenAmount
      });
    }

  } catch (error) {
    logger.error('Airdrop failed', error);
    
    if (error instanceof Error && error.name === 'ZodError') {
      return res.status(400).json({
        error: 'Invalid request',
        details: (error as any).errors
      });
    }

    res.status(500).json({
      error: 'Airdrop failed',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  const path = url.pathname;

  logger.info('WebSocket connection established', { path });

  if (path.startsWith('/ws/orders/')) {
    // Subscribe to specific order updates
    const orderId = path.substring('/ws/orders/'.length);
    
    if (!wsClients.has(orderId)) {
      wsClients.set(orderId, new Set());
    }
    wsClients.get(orderId)!.add(ws);

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

  } else if (path === '/ws/feed') {
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
      } catch (error) {
        logger.error('Invalid WebSocket message', error);
      }
    });
  }

  ws.on('error', (error) => {
    logger.error('WebSocket error', error);
  });
});

// Broadcast to order subscribers
function broadcastToOrderSubscribers(orderId: string, data: any) {
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
    
    // Initialize connection - config.connection is already a Connection object
    connection = config.connection;

    // Load relayer keypair - config.relayerKeypair is already a Keypair object
    relayerWallet = config.relayerKeypair;

    logger.info('Relayer address:', relayerWallet.publicKey.toBase58());

    // Check relayer balance
    const balance = await connection.getBalance(relayerWallet.publicKey);
    logger.info(`Relayer balance: ${balance / 1e9} SOL`);
    
    if (balance < 0.1 * 1e9) {
      logger.warn('Low relayer balance! Please fund the relayer wallet.');
    }

    // Initialize relayer service
    relayerService = new RelayerService(
      connection,
      relayerWallet,
      config.continuumProgramId,
      config.cpSwapProgramId,
      logger
    );

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
    const PORT = config.port;
    server.listen(PORT, () => {
      logger.info(`Relayer server listening on port ${PORT}`);
      logger.info(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
      logger.info(`HTTP API endpoint: http://localhost:${PORT}/api/v1`);
    });

    // Graceful shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
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
  } catch (error) {
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