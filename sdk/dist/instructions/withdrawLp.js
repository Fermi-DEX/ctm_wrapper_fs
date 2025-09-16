"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWithdrawLpInstruction = createWithdrawLpInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
function createWithdrawLpInstruction(params) {
    const { user, cpSwapProgram, poolId, lpAmount, minAmount0, minAmount1, poolAuthorityBump, remainingAccounts } = params;
    const [fifoState] = (0, utils_1.getFifoStatePDA)();
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
        ...remainingAccounts
    ];
    const discriminator = Buffer.from([225, 221, 45, 211, 49, 60, 51, 163]);
    const data = Buffer.concat([
        discriminator,
        lpAmount.toArrayLike(Buffer, 'le', 8),
        minAmount0.toArrayLike(Buffer, 'le', 8),
        minAmount1.toArrayLike(Buffer, 'le', 8),
        poolId.toBuffer(),
        Buffer.from([poolAuthorityBump])
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data
    });
}
