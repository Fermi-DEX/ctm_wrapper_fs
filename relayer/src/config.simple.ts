import * as dotenv from 'dotenv';

dotenv.config();

export const config = {
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