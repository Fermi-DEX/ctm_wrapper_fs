"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitializeCpSwapPoolInstruction = createInitializeCpSwapPoolInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
function createInitializeCpSwapPoolInstruction(params) {
    const { admin, poolState, initAmount0, initAmount1, openTime, cpSwapAccounts } = params;
    const [fifoState] = (0, pda_1.getFifoStatePDA)();
    const [poolRegistry] = (0, pda_1.getPoolRegistryPDA)(poolState);
    const [poolAuthority] = (0, pda_1.getPoolAuthorityPDA)(poolState);
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: false },
        { pubkey: poolRegistry, isSigner: false, isWritable: true },
        { pubkey: poolAuthority, isSigner: false, isWritable: false },
        { pubkey: admin, isSigner: true, isWritable: true },
        { pubkey: poolState, isSigner: true, isWritable: false }, // Pool state needs to be a signer (creator)
        { pubkey: constants_1.CP_SWAP_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        // Add CP-Swap specific accounts
        ...cpSwapAccounts.map(pubkey => ({
            pubkey,
            isSigner: false,
            isWritable: true,
        })),
    ];
    // Discriminator for initialize_cp_swap_pool: [82, 124, 68, 116, 214, 40, 134, 198]
    const discriminator = Buffer.from([82, 124, 68, 116, 214, 40, 134, 198]);
    // Encode arguments
    const data = Buffer.concat([
        discriminator,
        initAmount0.toArrayLike(Buffer, 'le', 8),
        initAmount1.toArrayLike(Buffer, 'le', 8),
        openTime.toArrayLike(Buffer, 'le', 8),
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data,
    });
}
