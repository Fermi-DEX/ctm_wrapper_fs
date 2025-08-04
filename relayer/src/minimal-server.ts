import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Trust proxy headers when running behind nginx
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(express.json());

// Load or generate relayer keypair
let relayerKeypair: Keypair;
const keypairPath = process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json';

try {
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  relayerKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Loaded relayer keypair:', relayerKeypair.publicKey.toBase58());
} catch (error) {
  relayerKeypair = Keypair.generate();
  fs.writeFileSync(keypairPath, JSON.stringify(Array.from(relayerKeypair.secretKey)));
  console.log('Generated new relayer keypair:', relayerKeypair.publicKey.toBase58());
}

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    relayer: relayerKeypair.publicKey.toBase58(),
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/api/v1/info', (req, res) => {
  res.json({
    relayerAddress: relayerKeypair.publicKey.toBase58(),
    continuumProgram: process.env.CONTINUUM_PROGRAM_ID || 'A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn',
    cpSwapProgram: process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp',
    fee: 10,
    minOrderSize: '1000000',
    maxOrderSize: '1000000000000',
    supportedPools: [],
    performance: {
      successRate: 0.98,
      avgExecutionTime: 2500,
      totalOrders: 0
    }
  });
});

app.post('/api/v1/orders', (req, res) => {
  const { transaction, poolId, amountIn, minAmountOut, isBaseInput, userPublicKey } = req.body;
  
  console.log('Received order submission:', {
    poolId,
    amountIn,
    minAmountOut,
    userPublicKey
  });
  
  // Mock response
  res.json({
    success: true,
    orderId: `ord_${Date.now()}`,
    orderPda: Keypair.generate().publicKey.toBase58(),
    sequence: '1',
    estimatedExecutionTime: 5000,
    fee: '100000'
  });
});

app.get('/api/v1/orders/:orderId', (req, res) => {
  const { orderId } = req.params;
  
  // Mock response
  res.json({
    orderId,
    status: 'pending',
    sequence: '1',
    poolId: 'mock_pool',
    userPublicKey: 'mock_user',
    amountIn: '1000000000',
    createdAt: new Date().toISOString()
  });
});

app.get('/api/v1/pools', (req, res) => {
  res.json({
    pools: []
  });
});

app.get('/api/v1/stats', (req, res) => {
  res.json({
    totalOrders: 0,
    successfulOrders: 0,
    failedOrders: 0,
    successRate: 1,
    avgExecutionTime: 0,
    pendingOrders: 0,
    relayerBalance: 0
  });
});

// WebSocket handling
wss.on('connection', (ws, req) => {
  console.log('WebSocket connection established');
  
  ws.on('message', (message) => {
    console.log('WebSocket message:', message.toString());
  });
  
  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Start server
const PORT = process.env.PORT || 8085;
server.listen(PORT, () => {
  console.log(`🚀 Relayer server running on port ${PORT}`);
  console.log(`📡 HTTP: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`💚 Health check: http://localhost:${PORT}/health`);
});