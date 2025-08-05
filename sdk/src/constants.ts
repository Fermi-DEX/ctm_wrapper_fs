import { PublicKey } from '@solana/web3.js';

// Program IDs
export const CONTINUUM_PROGRAM_ID = new PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m');
export const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

// Seeds
export const FIFO_STATE_SEED = Buffer.from('fifo_state');
export const POOL_REGISTRY_SEED = Buffer.from('pool_registry');
export const CP_POOL_AUTHORITY_SEED = Buffer.from('cp_pool_authority');
export const ORDER_SEED = Buffer.from('order');