import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Load constants
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../constants.json'), 'utf8')
);

// Determine network from command line args or env
const isDevnet = process.argv.includes('--devnet') || process.env.NETWORK === 'devnet';
const network = isDevnet ? 'devnet' : 'localnet';
const networkConfig = constants[network];

export interface PoolConfig {
  poolId: string;
  ammConfig: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  tokenADecimals: number;
  tokenBDecimals: number;
  tokenAVault: string;
  tokenBVault: string;
  observationState: string;
}

export interface RelayerConfig {
  connection: Connection;
  relayerKeypair: Keypair;
  continuumProgramId: PublicKey;
  cpSwapProgramId: PublicKey;
  pollIntervalMs: number;
  maxConcurrentExecutions: number;
  retryAttempts: number;
  retryDelayMs: number;
  
  // Server config
  port: number;
  host: string;
  
  // Pool configurations
  supportedPools: PoolConfig[];
  
  // Features
  enableMockMode: boolean;
  enableAirdrop: boolean;
  airdropAmountSol: number;
  airdropRateLimitMs: number;
  
  // Transaction settings
  priorityFeeLevel: 'none' | 'low' | 'medium' | 'high';
  computeUnitLimit: number;
  confirmationTimeoutMs: number;
  
  // Network info
  network: string;
  isDevnet: boolean;
  
  // Token configurations for airdrops
  tokens: typeof constants.devnet.tokens;
}

function loadKeypair(path: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(path, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

// Default pool configuration for localnet
const DEFAULT_LOCALNET_POOL: PoolConfig = {
  poolId: 'F7wLNYJrsnxAC23tomtxLBCUEBaaovK3pRxwe4qektdb',
  ammConfig: 'EPyDg2LEJDdq3QKR1am2rawQtkBXbE4HFsWSMFvLwiHa',
  tokenAMint: '4PV5koSWtfu9C1keSMNNMooK14PQynNBz1YNPpSsJLJa', // WSOL
  tokenBMint: '914qoamoCDj7W3cN6192LPhfE3UMo3WVg5nqURb1LAPw', // USDC
  tokenASymbol: 'WSOL',
  tokenBSymbol: 'USDC',
  tokenADecimals: 9,
  tokenBDecimals: 6,
  tokenAVault: '4DuSHNmLGkSiQiVHAuQyu9uxqHbBx1DpSWgkPaBsveWC',
  tokenBVault: 'AZMSnpm9hkQZ8ZKQJdYTn3Tb9DPpSWYSZmr267dqdE9P',
  observationState: 'BnMncnpNemtfqUMPaXGZMpQcb6vFLgk8oZd8pQFT1dqT',
};

// Get pool configuration based on network
function getPoolConfig(): PoolConfig[] {
  if (isDevnet && networkConfig.pools) {
    // Convert devnet pool format to PoolConfig
    const devnetPool = networkConfig.pools['USDC-WSOL'];
    return [{
      poolId: devnetPool.poolId,
      ammConfig: devnetPool.ammConfig,
      tokenAMint: devnetPool.tokenAMint,
      tokenBMint: devnetPool.tokenBMint,
      tokenASymbol: 'USDC',
      tokenBSymbol: 'WSOL',
      tokenADecimals: 6,
      tokenBDecimals: 9,
      tokenAVault: devnetPool.tokenAVault,
      tokenBVault: devnetPool.tokenBVault,
      observationState: devnetPool.observationState,
    }];
  }
  
  // For localnet, use environment or default
  if (process.env.SUPPORTED_POOLS) {
    try {
      return JSON.parse(process.env.SUPPORTED_POOLS);
    } catch (e) {
      console.warn('Failed to parse SUPPORTED_POOLS, using default pool');
      return [DEFAULT_LOCALNET_POOL];
    }
  }
  return [DEFAULT_LOCALNET_POOL];
}

// Get default keypair path
function getKeypairPath(): string {
  if (process.env.RELAYER_KEYPAIR_PATH) {
    return process.env.RELAYER_KEYPAIR_PATH;
  }
  
  // Use default Solana keypair for devnet
  if (isDevnet) {
    const defaultPath = path.join(process.env.HOME!, '.config/solana/id.json');
    if (fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  }
  
  return './relayer-keypair.json';
}

export const config: RelayerConfig = {
  connection: new Connection(
    process.env.RPC_URL || networkConfig.rpc.endpoint,
    {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
      wsEndpoint: networkConfig.rpc.wsEndpoint,
    }
  ),
  relayerKeypair: loadKeypair(getKeypairPath()),
  continuumProgramId: new PublicKey(networkConfig.programs.continuum),
  cpSwapProgramId: new PublicKey(networkConfig.programs.cpSwap),
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
  maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
  retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
  retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
  
  // Server config
  port: parseInt(process.env.PORT || '8080'),
  host: process.env.HOST || '0.0.0.0',
  
  // Pool configurations
  supportedPools: getPoolConfig(),
  
  // Features
  enableMockMode: process.env.ENABLE_MOCK_MODE === 'true' || false, // Disable mock mode by default
  enableAirdrop: isDevnet || process.env.ENABLE_AIRDROP !== 'false',
  airdropAmountSol: parseFloat(process.env.AIRDROP_AMOUNT_SOL || (isDevnet ? '0.1' : '1')),
  airdropRateLimitMs: parseInt(process.env.AIRDROP_RATE_LIMIT_MS || '5000'), // 5 seconds
  
  // Transaction settings
  priorityFeeLevel: (process.env.PRIORITY_FEE_LEVEL as any) || 'medium',
  computeUnitLimit: parseInt(process.env.COMPUTE_UNIT_LIMIT || '400000'),
  confirmationTimeoutMs: parseInt(process.env.CONFIRMATION_TIMEOUT_MS || '60000'),
  
  // Network info
  network,
  isDevnet,
  
  // Token configurations
  tokens: isDevnet ? networkConfig.tokens : {},
};

// Log configuration on startup
console.log(`Relayer configured for ${network}`);
console.log(`RPC Endpoint: ${config.connection.rpcEndpoint}`);
console.log(`Continuum Program: ${config.continuumProgramId.toBase58()}`);
console.log(`CP-Swap Program: ${config.cpSwapProgramId.toBase58()}`);
console.log(`Supported Pools: ${config.supportedPools.length}`);