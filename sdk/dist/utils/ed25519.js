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
exports.createEd25519Instruction = createEd25519Instruction;
exports.createRelayerMessage = createRelayerMessage;
const web3_js_1 = require("@solana/web3.js");
const nacl = __importStar(require("tweetnacl"));
const ED25519_PROGRAM_ID = new web3_js_1.PublicKey('Ed25519SigVerify111111111111111111111111111');
/**
 * Create Ed25519 precompile instruction for relayer signature verification
 * This instruction verifies that the relayer has signed the sequence number and executor
 */
function createEd25519Instruction(relayerKeypair, sequence, executor) {
    // Create message: sequence (8 bytes) + executor (32 bytes)
    const message = Buffer.concat([
        sequence.toArrayLike(Buffer, 'le', 8),
        executor.toBuffer(),
    ]);
    // Sign the message with relayer keypair using nacl (same as Solana uses internally)
    const signatureBytes = nacl.sign.detached(message, relayerKeypair.secretKey);
    // Create instruction data according to Ed25519 precompile format
    const instructionData = createEd25519InstructionData({
        signature: signatureBytes,
        pubkey: relayerKeypair.publicKey.toBytes(),
        message,
    });
    return new web3_js_1.TransactionInstruction({
        programId: ED25519_PROGRAM_ID,
        keys: [], // Ed25519 precompile doesn't use accounts
        data: Buffer.from(instructionData),
    });
}
/**
 * Create instruction data for Ed25519 precompile
 * Format: [num_signatures: u8][signature_offset: u16][pubkey_offset: u16][message_data_offset: u16]
 *         [signature: 64 bytes][pubkey: 32 bytes][message: variable length]
 */
function createEd25519InstructionData(data) {
    const { signature, pubkey, message } = data;
    // Calculate offsets
    const signatureOffset = 16; // After header (1 + 2 + 2 + 2 + padding)
    const pubkeyOffset = signatureOffset + 64; // After signature
    const messageOffset = pubkeyOffset + 32; // After pubkey
    const instructionData = new Uint8Array(messageOffset + message.length);
    let offset = 0;
    // Header
    instructionData[offset] = 1; // num_signatures
    offset += 1;
    // Padding to align to 2 bytes
    offset += 1;
    // Offsets (little-endian u16)
    instructionData[offset] = signatureOffset & 0xff;
    instructionData[offset + 1] = (signatureOffset >> 8) & 0xff;
    offset += 2;
    instructionData[offset] = pubkeyOffset & 0xff;
    instructionData[offset + 1] = (pubkeyOffset >> 8) & 0xff;
    offset += 2;
    instructionData[offset] = messageOffset & 0xff;
    instructionData[offset + 1] = (messageOffset >> 8) & 0xff;
    offset += 2;
    // More padding to reach signature offset
    while (offset < signatureOffset) {
        instructionData[offset] = 0;
        offset++;
    }
    // Signature (64 bytes)
    instructionData.set(signature, signatureOffset);
    // Public key (32 bytes)
    instructionData.set(pubkey, pubkeyOffset);
    // Message (variable length)
    instructionData.set(message, messageOffset);
    return instructionData;
}
/**
 * Create a message for relayer signature verification
 */
function createRelayerMessage(sequence, executor) {
    return Buffer.concat([
        sequence.toArrayLike(Buffer, 'le', 8),
        executor.toBuffer(),
    ]);
}
