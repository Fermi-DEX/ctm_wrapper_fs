import { TransactionInstruction, PublicKey, Keypair } from '@solana/web3.js';
import BN from 'bn.js';
export interface Ed25519SignatureData {
    signature: Uint8Array;
    pubkey: Uint8Array;
    message: Uint8Array;
}
/**
 * Create Ed25519 precompile instruction for relayer signature verification
 * This instruction verifies that the relayer has signed the sequence number and executor
 */
export declare function createEd25519Instruction(relayerKeypair: Keypair, sequence: BN, executor: PublicKey): TransactionInstruction;
/**
 * Create a message for relayer signature verification
 */
export declare function createRelayerMessage(sequence: BN, executor: PublicKey): Buffer;
