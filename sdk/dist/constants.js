"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORDER_SEED = exports.CP_POOL_AUTHORITY_SEED = exports.POOL_REGISTRY_SEED = exports.FIFO_STATE_SEED = exports.CP_SWAP_PROGRAM_ID = exports.CONTINUUM_PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
// Program IDs
exports.CONTINUUM_PROGRAM_ID = new web3_js_1.PublicKey('7HjAvgmHfeziumwrF15BkZNrgECEKGrBPJ2EfqeFxYQE');
exports.CP_SWAP_PROGRAM_ID = new web3_js_1.PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');
// Seeds
exports.FIFO_STATE_SEED = Buffer.from('fifo_state');
exports.POOL_REGISTRY_SEED = Buffer.from('pool_registry');
exports.CP_POOL_AUTHORITY_SEED = Buffer.from('cp_pool_authority');
exports.ORDER_SEED = Buffer.from('order');
