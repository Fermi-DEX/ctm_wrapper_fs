"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDepositLpInstruction = createDepositLpInstruction;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
const utils_1 = require("../utils");
function createDepositLpInstruction(params) {
    const { user, cpSwapProgram, poolId, minLpAmount, maxAmount0, maxAmount1, poolAuthorityBump, remainingAccounts } = params;
    const [fifoState] = (0, utils_1.getFifoStatePDA)();
    const keys = [
        { pubkey: fifoState, isSigner: false, isWritable: true },
        { pubkey: cpSwapProgram, isSigner: false, isWritable: false },
        ...remainingAccounts
    ];
    const discriminator = Buffer.from([83, 107, 16, 26, 26, 20, 130, 56]);
    const data = Buffer.concat([
        discriminator,
        minLpAmount.toArrayLike(Buffer, 'le', 8),
        maxAmount0.toArrayLike(Buffer, 'le', 8),
        maxAmount1.toArrayLike(Buffer, 'le', 8),
        poolId.toBuffer(),
        Buffer.from([poolAuthorityBump])
    ]);
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CONTINUUM_PROGRAM_ID,
        data
    });
}
