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
dotenv.config();
function loadKeypair(path) {
    const secretKey = JSON.parse(fs_1.default.readFileSync(path, 'utf-8'));
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secretKey));
}
// Default pool configuration from our successful test
const DEFAULT_POOL = {
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
// Load pools from environment or use default
function loadPools() {
    if (process.env.SUPPORTED_POOLS) {
        try {
            return JSON.parse(process.env.SUPPORTED_POOLS);
        }
        catch (e) {
            console.warn('Failed to parse SUPPORTED_POOLS, using default pool');
            return [DEFAULT_POOL];
        }
    }
    return [DEFAULT_POOL];
}
exports.config = {
    connection: new web3_js_1.Connection(process.env.RPC_URL || 'http://localhost:8899', {
        commitment: 'confirmed',
        confirmTransactionInitialTimeout: 60000,
    }),
    relayerKeypair: loadKeypair(process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json'),
    continuumProgramId: new web3_js_1.PublicKey(process.env.CONTINUUM_PROGRAM_ID || 'EaeWUSam5Li1fzCcCs33oE4jCLQT4F6RJXgrPYZaoKqq'),
    cpSwapProgramId: new web3_js_1.PublicKey(process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp'),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
    maxConcurrentExecutions: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
    retryAttempts: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '1000'),
    // Server config
    port: parseInt(process.env.PORT || '8086'),
    host: process.env.HOST || '0.0.0.0',
    // Pool configurations
    supportedPools: loadPools(),
    // Features
    enableMockMode: process.env.ENABLE_MOCK_MODE === 'true',
    enableAirdrop: process.env.ENABLE_AIRDROP !== 'false', // default true for localnet
    airdropAmountSol: parseFloat(process.env.AIRDROP_AMOUNT_SOL || '1'),
    airdropRateLimitMs: parseInt(process.env.AIRDROP_RATE_LIMIT_MS || '60000'), // 1 minute
    // Transaction settings
    priorityFeeLevel: process.env.PRIORITY_FEE_LEVEL || 'medium',
    computeUnitLimit: parseInt(process.env.COMPUTE_UNIT_LIMIT || '400000'),
    confirmationTimeoutMs: parseInt(process.env.CONFIRMATION_TIMEOUT_MS || '60000'),
};
