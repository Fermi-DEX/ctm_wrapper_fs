"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCpSwapPDAs = getCpSwapPDAs;
exports.createInitializeCpSwapPoolDirectInstruction = createInitializeCpSwapPoolDirectInstruction;
exports.createFeeAccountInstruction = createFeeAccountInstruction;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const constants_1 = require("../constants");
const pda_1 = require("../utils/pda");
const bn_js_1 = __importDefault(require("bn.js"));
/**
 * Derives all CP-Swap PDAs for a pool
 */
function getCpSwapPDAs(token0, token1, ammConfig) {
    // Ensure tokens are sorted
    const [sortedToken0, sortedToken1] = token0.toBuffer().compare(token1.toBuffer()) < 0
        ? [token0, token1]
        : [token1, token0];
    // Pool state PDA
    const [poolState] = web3_js_1.PublicKey.findProgramAddressSync([
        Buffer.from('pool'),
        ammConfig.toBuffer(),
        sortedToken0.toBuffer(),
        sortedToken1.toBuffer(),
    ], constants_1.CP_SWAP_PROGRAM_ID);
    // CP-Swap authority (for vaults and LP mint)
    const [cpSwapAuthority] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault_and_lp_mint_auth_seed')], constants_1.CP_SWAP_PROGRAM_ID);
    // LP Mint
    const [lpMint] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('pool_lp_mint'), poolState.toBuffer()], constants_1.CP_SWAP_PROGRAM_ID);
    // Token vaults
    const [vault0] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('pool_vault'), poolState.toBuffer(), sortedToken0.toBuffer()], constants_1.CP_SWAP_PROGRAM_ID);
    const [vault1] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('pool_vault'), poolState.toBuffer(), sortedToken1.toBuffer()], constants_1.CP_SWAP_PROGRAM_ID);
    // Observation state
    const [observationState] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('observation'), poolState.toBuffer()], constants_1.CP_SWAP_PROGRAM_ID);
    return {
        poolState,
        cpSwapAuthority,
        lpMint,
        vault0,
        vault1,
        observationState,
        sortedToken0,
        sortedToken1
    };
}
/**
 * Creates an instruction to initialize a CP-Swap pool with CTM Wrapper as custom authority
 * This directly calls the CP-Swap program with the CTM authority set
 */
function createInitializeCpSwapPoolDirectInstruction(params) {
    const { creator, ammConfig, token0Mint, token1Mint, initAmount0, initAmount1, openTime = new bn_js_1.default(0), feeOwner = new web3_js_1.PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq') } = params;
    // Get CP-Swap PDAs
    const cpSwapPDAs = getCpSwapPDAs(token0Mint, token1Mint, ammConfig);
    // Get CTM Wrapper pool authority
    const [ctmPoolAuthority] = (0, pda_1.getPoolAuthorityPDA)(cpSwapPDAs.poolState);
    // Get creator token accounts
    const creatorToken0 = (0, spl_token_1.getAssociatedTokenAddressSync)(cpSwapPDAs.sortedToken0, creator);
    const creatorToken1 = (0, spl_token_1.getAssociatedTokenAddressSync)(cpSwapPDAs.sortedToken1, creator);
    const creatorLpToken = (0, spl_token_1.getAssociatedTokenAddressSync)(cpSwapPDAs.lpMint, creator);
    // Get fee account
    const createPoolFee = (0, spl_token_1.getAssociatedTokenAddressSync)(cpSwapPDAs.sortedToken0, feeOwner);
    // Build instruction data with custom authority
    const discriminator = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]); // CP-Swap initialize
    const authorityType = Buffer.from([1]); // 1 = custom authority
    const optionTag = Buffer.from([1]); // 1 = Some (authority provided)
    const instructionData = Buffer.concat([
        discriminator,
        initAmount0.toArrayLike(Buffer, 'le', 8),
        initAmount1.toArrayLike(Buffer, 'le', 8),
        openTime.toArrayLike(Buffer, 'le', 8),
        authorityType,
        optionTag,
        ctmPoolAuthority.toBuffer(), // CTM Wrapper authority as custom authority
    ]);
    // Build accounts array
    const keys = [
        { pubkey: creator, isSigner: true, isWritable: true },
        { pubkey: ammConfig, isSigner: false, isWritable: false },
        { pubkey: cpSwapPDAs.cpSwapAuthority, isSigner: false, isWritable: false },
        { pubkey: cpSwapPDAs.poolState, isSigner: false, isWritable: true },
        { pubkey: cpSwapPDAs.sortedToken0, isSigner: false, isWritable: false },
        { pubkey: cpSwapPDAs.sortedToken1, isSigner: false, isWritable: false },
        { pubkey: cpSwapPDAs.lpMint, isSigner: false, isWritable: true },
        { pubkey: creatorToken0, isSigner: false, isWritable: true },
        { pubkey: creatorToken1, isSigner: false, isWritable: true },
        { pubkey: creatorLpToken, isSigner: false, isWritable: true },
        { pubkey: cpSwapPDAs.vault0, isSigner: false, isWritable: true },
        { pubkey: cpSwapPDAs.vault1, isSigner: false, isWritable: true },
        { pubkey: createPoolFee, isSigner: false, isWritable: true },
        { pubkey: cpSwapPDAs.observationState, isSigner: false, isWritable: true },
        { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_0_program
        { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // token_1_program
        { pubkey: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: web3_js_1.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ];
    return new web3_js_1.TransactionInstruction({
        keys,
        programId: constants_1.CP_SWAP_PROGRAM_ID,
        data: instructionData,
    });
}
/**
 * Creates an instruction to ensure the fee account exists
 */
function createFeeAccountInstruction(payer, sortedToken0, feeOwner = new web3_js_1.PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq')) {
    const feeAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(sortedToken0, feeOwner);
    // This returns null if account exists, instruction if it needs to be created
    // Caller should check if account exists before including this instruction
    return {
        programId: spl_token_1.ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: feeAccount, isSigner: false, isWritable: true },
            { pubkey: feeOwner, isSigner: false, isWritable: false },
            { pubkey: sortedToken0, isSigner: false, isWritable: false },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]), // Create associated token account instruction
    };
}
