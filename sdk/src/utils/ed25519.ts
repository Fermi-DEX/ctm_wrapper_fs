import {
  TransactionInstruction,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import BN from 'bn.js';

const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');

export interface Ed25519SignatureData {
  signature: Uint8Array;
  pubkey: Uint8Array;
  message: Uint8Array;
}

/**
 * Create Ed25519 precompile instruction for relayer signature verification
 * This instruction verifies that the relayer has signed the sequence number and executor
 */
export function createEd25519Instruction(
  relayerKeypair: Keypair,
  sequence: BN,
  executor: PublicKey
): TransactionInstruction {
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

  return new TransactionInstruction({
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
function createEd25519InstructionData(data: Ed25519SignatureData): Uint8Array {
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
export function createRelayerMessage(sequence: BN, executor: PublicKey): Buffer {
  return Buffer.concat([
    sequence.toArrayLike(Buffer, 'le', 8),
    executor.toBuffer(),
  ]);
}