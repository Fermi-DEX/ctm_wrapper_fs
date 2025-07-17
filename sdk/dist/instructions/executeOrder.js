"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createExecuteOrderInstruction = createExecuteOrderInstruction;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
function createExecuteOrderInstruction(params) {
    const { executor, orderUser, sequence, poolId, userSource, userDestination, cpSwapRemainingAccounts } = params;
    const [fifoState] = (0, pda_1.getFifoStatePDA)();
    const [orderState] = (0, pda_1.getOrderPDA)(orderUser, sequence);
    const [poolRegistry] = (0, pda_1.getPoolRegistryPDA)(poolId);
    const [poolAuthority] = (0, pda_1.getPoolAuthorityPDA)(poolId);
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: false },
        { pubkey: orderState, isSigner: false, isWritable: true },
        { pubkey: poolRegistry, isSigner: false, isWritable: false },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: executor, isSigner: true, isWritable: true },
        { pubkey: userSource, isSigner: false, isWritable: true },
        { pubkey: userDestination, isSigner: false, isWritable: true },
        { pubkey: constants_1.CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
        // Add CP-Swap specific accounts
        ...cpSwapRemainingAccounts.map(pubkey => ({
            pubkey,
            isSigner: false,
            isWritable: true, // Most CP-Swap accounts are writable
        })),
    ];
    // Discriminator for execute_order: [115, 61, 180, 24, 168, 32, 215, 20]
    const discriminator = Buffer.from([115, 61, 180, 24, 168, 32, 215, 20]);
    // Encode expected_sequence
    const data = Buffer.concat([
        discriminator,
        sequence.toArrayLike(Buffer, 'le', 8),
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data,
    });
}
