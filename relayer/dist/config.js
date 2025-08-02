"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
dotenv.config();
// Load constants
const constants = JSON.parse(fs_1.default.readFileSync(path_1.default.join(__dirname, '../../constants.json'), 'utf8'));
// Determine network from command line args or env
const isDevnet = process.argv.includes('--devnet') || process.env.NETWORK === 'devnet';
const network = isDevnet ? 'devnet' : 'localnet';
const networkConfig = constants[network];
function loadKeypair(path) {
    const secretKey = JSON.parse(fs_1.default.readFileSync(path, 'utf-8'));
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}
// Default pool configuration for localnet
const DEFAULT_LOCALNET_POOL = {
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
function getPoolConfig() {
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
        }
        catch (e) {
            console.warn('Failed to parse SUPPORTED_POOLS, using default pool');
            return [DEFAULT_LOCALNET_POOL];
        }
    }
    return [DEFAULT_LOCALNET_POOL];
}
// Get default keypair path
function getKeypairPath() {
    if (process.env.RELAYER_KEYPAIR_PATH) {
        return process.env.RELAYER_KEYPAIR_PATH;
    }
    // Use default Solana keypair for devnet
    if (isDevnet) {
        const defaultPath = path_1.default.join(process.env.HOME, '.config/solana/id.json');
        if (fs_1.default.existsSync(defaultPath)) {
            return defaultPath;
        }
    }
    return './relayer-keypair.json';
}
exports.config = {
    connection: new web3_js_1.Connection(process.env.RPC_URL || networkConfig.rpc.endpoint, {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
        wsEndpoint: networkConfig.rpc.wsEndpoint,
    }),
    relayerKeypair: loadKeypair(getKeypairPath()),
    continuumProgramId: new web3_js_1.PublicKey(networkConfig.programs.continuum),
    cpSwapProgramId: new web3_js_1.PublicKey(networkConfig.programs.cpSwap),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
    maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
    // Server config
    port: parseInt(process.env.PORT || '8085'),
    host: process.env.HOST || '0.0.0.0',
    // Pool configurations
    supportedPools: getPoolConfig(),
    // Features
    enableMockMode: process.env.ENABLE_MOCK_MODE === 'true' || false, // Disable mock mode by default
    enableAirdrop: isDevnet || process.env.ENABLE_AIRDROP !== 'false',
    airdropAmountSol: parseFloat(process.env.AIRDROP_AMOUNT_SOL || (isDevnet ? '0.1' : '1')),
    airdropRateLimitMs: parseInt(process.env.AIRDROP_RATE_LIMIT_MS || '5000'), // 5 seconds
    // Transaction settings
    priorityFeeLevel: process.env.PRIORITY_FEE_LEVEL || 'medium',
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
console.log(`RPC Endpoint: ${exports.config.connection.rpcEndpoint}`);
console.log(`Continuum Program: ${exports.config.continuumProgramId.toBase58()}`);
console.log(`CP-Swap Program: ${exports.config.cpSwapProgramId.toBase58()}`);
console.log(`Supported Pools: ${exports.config.supportedPools.length}`);
