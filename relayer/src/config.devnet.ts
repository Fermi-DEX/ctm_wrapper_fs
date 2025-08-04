import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Devnet Configuration
export const config = {
  // Network
  connection: new Connection(
    process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com',
    {
      commitment: 'confirmed',
      wsEndpoint: process.env.DEVNET_WS_URL || 'wss://api.devnet.solana.com'
    }
  ),
  
  // Server
  port: parseInt(process.env.PORT || '8080', 10),
  
  // Programs
  continuumProgramId: new PublicKey('EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq'),
  cpSwapProgramId: new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'),
  
  // Relayer wallet
  relayerKeypair: (() => {
    const keypairPath = process.env.RELAYER_KEYPAIR_PATH || 
                       path.join(process.env.HOME!, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    return Keypair.fromSecretKey(new Uint8Array(keypairData));
  })(),
  
  // Supported pools (to be loaded from devnet-pool.json if available)
  supportedPools: (() => {
    const poolConfigPath = path.join(__dirname, '../../scripts/devnet/devnet-pool.json');
    if (fs.existsSync(poolConfigPath)) {
      const poolInfo = JSON.parse(fs.readFileSync(poolConfigPath, 'utf8'));
      return [{
        poolId: poolInfo.poolId,
        ammConfig: poolInfo.ammConfig,
        tokenAMint: poolInfo.token0,
        tokenBMint: poolInfo.token1,
        tokenASymbol: poolInfo.token0Symbol,
        tokenBSymbol: poolInfo.token1Symbol,
        tokenADecimals: poolInfo.token0Decimals,
        tokenBDecimals: poolInfo.token1Decimals,
        tokenAVault: '', // To be fetched from pool state
        tokenBVault: '', // To be fetched from pool state
        authority: poolInfo.authority,
        authorityType: 'custom'
      }];
    }
    return [];
  })(),
  
  // Transaction settings
  priorityFeeLevel: 'medium' as 'none' | 'low' | 'medium' | 'high',
  computeUnitLimit: 400000,
  
  // Execution settings
  maxRetries: 3,
  retryDelay: 1000, // ms
  executionTimeout: 30000, // ms
  
  // Pool monitoring
  poolRefreshInterval: 10000, // ms
  priceUpdateInterval: 5000, // ms
  
  // Order management
  maxPendingOrders: 100,
  orderExpirationTime: 300000, // 5 minutes
  
  // Fees
  relayerFeeBps: 10, // 0.1%
  minOrderSize: '1000000', // 1 USDC minimum
  maxOrderSize: '1000000000000', // 1M USDC maximum
  
  // Security
  maxSlippageBps: 100, // 1%
  blacklistedAddresses: [],
  
  // Monitoring
  metricsEnabled: true,
  metricsPort: 9090,
  
  // Feature flags
  enableMockMode: false, // Disable mock mode for devnet
  enableWebSocket: true,
  enableOrderCancellation: true,
  enablePoolRegistration: true,
  enableAirdrop: true, // Enable for devnet testing
  
  // Airdrop settings (devnet only)
  airdropAmountSol: 2,
  airdropRateLimitMs: 5000, // 5 seconds between airdrops
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: 'relayer-devnet.log',
  
  // Database (optional)
  databaseUrl: process.env.DATABASE_URL,
  
  // External services
  priceOracleUrl: process.env.PRICE_ORACLE_URL,
  
  // Admin settings
  adminPublicKeys: [
    // Add admin public keys here
  ]
};

// Validate configuration
function validateConfig() {
  const required = [
    'connection',
    'continuumProgramId',
    'cpSwapProgramId',
    'relayerKeypair'
  ];
  
  for (const field of required) {
    if (!config[field as keyof typeof config]) {
      throw new Error(`Missing required configuration: ${field}`);
    }
  }
  
  // Check relayer balance on startup
  config.connection.getBalance(config.relayerKeypair.publicKey)
    .then(balance => {
      console.log(`Relayer wallet (${config.relayerKeypair.publicKey.toBase58()}) balance: ${balance / 1e9} SOL`);
      if (balance < 0.1 * 1e9) {
        console.warn('⚠️  Low relayer balance! Consider airdropping SOL:');
        console.warn(`solana airdrop 2 ${config.relayerKeypair.publicKey.toBase58()} --url devnet`);
      }
    })
    .catch(err => {
      console.error('Failed to check relayer balance:', err);
    });
}

// Run validation
validateConfig();

export default config;