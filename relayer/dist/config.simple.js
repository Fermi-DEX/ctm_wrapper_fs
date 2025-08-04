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
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
exports.config = {
    // Network
    RPC_URL: process.env.RPC_URL || 'http://localhost:8899',
    WS_URL: process.env.WS_URL || 'ws://localhost:8900',
    // Programs
    CONTINUUM_PROGRAM_ID: process.env.CONTINUUM_PROGRAM_ID || 'A548C9LR926hnAWvYDjsXJddidhfzLf3bRb8dmYPgRKn',
    CP_SWAP_PROGRAM_ID: process.env.CP_SWAP_PROGRAM_ID || 'GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp',
    // Relayer
    RELAYER_KEYPAIR_PATH: process.env.RELAYER_KEYPAIR_PATH || './relayer-keypair.json',
    RELAYER_FEE_BPS: parseInt(process.env.RELAYER_FEE_BPS || '10'),
    // Limits
    MIN_ORDER_SIZE: process.env.MIN_ORDER_SIZE || '1000000',
    MAX_ORDER_SIZE: process.env.MAX_ORDER_SIZE || '1000000000000',
    // Performance
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || '1000'),
    MAX_CONCURRENT_EXECUTIONS: parseInt(process.env.MAX_CONCURRENT_EXECUTIONS || '5'),
    RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS || '3'),
    RETRY_DELAY_MS: parseInt(process.env.RETRY_DELAY_MS || '1000'),
    // Server
    PORT: parseInt(process.env.PORT || '8080'),
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
};
