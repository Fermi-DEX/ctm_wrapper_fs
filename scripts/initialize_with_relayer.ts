import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ContinuumClient } from '../sdk/src';
import fs from 'fs';

async function main() {
  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load wallet keypair
  const walletPath = process.env.HOME + '/.config/solana/id.json';
  const walletKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log('Admin wallet:', walletKeypair.publicKey.toBase58());

  // Relayer public key
  const relayerPubkey = new PublicKey('785Bgkii28SRfWSShrYZ6wmGZRgVBpHwd38WAbjU6B4Z');
  console.log('Relayer public key:', relayerPubkey.toBase58());

  // Initialize client (pass connection only, wallet is used per transaction)
  const client = new ContinuumClient(connection);

  try {
    // Check if already initialized
    const fifoState = await client.getFifoState();
    if (fifoState) {
      console.log('Already initialized with:');
      console.log('  Admin:', fifoState.admin.toBase58());
      console.log('  Relayer:', fifoState.relayerPubkey.toBase58());
      console.log('  Current sequence:', fifoState.currentSequence.toString());
      return;
    }

    // Initialize with relayer pubkey
    console.log('Initializing Continuum FIFO state...');
    const sig = await client.initialize(walletKeypair, relayerPubkey);
    console.log('Initialized successfully! Signature:', sig);

    // Verify initialization
    const newFifoState = await client.getFifoState();
    if (newFifoState) {
      console.log('Verification - FIFO state initialized with:');
      console.log('  Admin:', newFifoState.admin.toBase58());
      console.log('  Relayer:', newFifoState.relayerPubkey.toBase58());
      console.log('  Current sequence:', newFifoState.currentSequence.toString());
    }
  } catch (error) {
    console.error('Error initializing:', error);
    process.exit(1);
  }
}

main().catch(console.error);