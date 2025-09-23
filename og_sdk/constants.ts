import { PublicKey } from "@solana/web3.js";

// Seeds
export const FIFO_STATE_SEED = Buffer.from('fifo_state');
export const POOL_REGISTRY_SEED = Buffer.from('pool_registry');
export const CP_POOL_AUTHORITY_SEED = Buffer.from('cp_pool_authority');
export const ORDER_SEED = Buffer.from('order');

export const CP_SWAP_PROGRAM = new PublicKey("GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp")