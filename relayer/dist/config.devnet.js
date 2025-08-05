"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const web3_js_1 = require("@solana/web3.js");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Load environment variables
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
// Devnet Configuration
exports.config = {
    // Network
    connection: new web3_js_1.Connection(process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com', {
        commitment: 'confirmed',
        wsEndpoint: process.env.DEVNET_WS_URL || 'wss://api.devnet.solana.com'
    }),
    // Server
    port: parseInt(process.env.PORT || '8080', 10),
    // Programs
    continuumProgramId: new web3_js_1.PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m'),
    cpSwapProgramId: new web3_js_1.PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'),
    // Relayer wallet
    relayerKeypair: (() => {
        const keypairPath = process.env.RELAYER_KEYPAIR_PATH ||
            path_1.default.join(process.env.HOME, '.config/solana/id.json');
        const keypairData = JSON.parse(fs_1.default.readFileSync(keypairPath, 'utf8'));
        return web3_js_1.Keypair.fromSecretKey(new Uint8Array(keypairData));
    })(),
    // Supported pools (to be loaded from constants.json)
    supportedPools: (() => {
        const constantsPath = path_1.default.join(__dirname, '../../constants.json');
        if (fs_1.default.existsSync(constantsPath)) {
            const constants = JSON.parse(fs_1.default.readFileSync(constantsPath, 'utf8'));
            const pools = [];
            // Load all pools from devnet configuration
            if (constants.devnet && constants.devnet.pools) {
                for (const [poolName, poolData] of Object.entries(constants.devnet.pools)) {
                    const [tokenA, tokenB] = poolName.split('-');
                    pools.push({
                        poolId: poolData.poolId,
                        ammConfig: poolData.ammConfig,
                        tokenAMint: poolData.tokenAMint,
                        tokenBMint: poolData.tokenBMint,
                        tokenASymbol: tokenA,
                        tokenBSymbol: tokenB,
                        tokenADecimals: tokenA.includes('SOL') ? 9 : 6,
                        tokenBDecimals: tokenB.includes('SOL') ? 9 : 6,
                        tokenAVault: poolData.tokenAVault,
                        tokenBVault: poolData.tokenBVault,
                        authority: poolData.cpPoolAuthority,
                        authorityType: 'custom',
                        observationState: poolData.observationState
                    });
                }
            }
            return pools;
        }
        return [];
    })(),
    // Transaction settings
    priorityFeeLevel: 'medium',
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
        if (!exports.config[field]) {
            throw new Error(`Missing required configuration: ${field}`);
        }
    }
    // Check relayer balance on startup
    exports.config.connection.getBalance(exports.config.relayerKeypair.publicKey)
        .then(balance => {
        console.log(`Relayer wallet (${exports.config.relayerKeypair.publicKey.toBase58()}) balance: ${balance / 1e9} SOL`);
        if (balance < 0.1 * 1e9) {
            console.warn('⚠️  Low relayer balance! Consider airdropping SOL:');
            console.warn(`solana airdrop 2 ${exports.config.relayerKeypair.publicKey.toBase58()} --url devnet`);
        }
    })
        .catch(err => {
        console.error('Failed to check relayer balance:', err);
    });
}
// Run validation
validateConfig();
exports.default = exports.config;
