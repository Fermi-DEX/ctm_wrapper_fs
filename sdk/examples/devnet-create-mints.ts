#!/usr/bin/env ts-node

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAccount,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import {
  confirmSignature,
  createHttpConnection,
  ensureAta,
  loadOrGenerateKeypair,
  sendTransactionWithRetry,
} from './utils';

const DEVNET_RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const DEFAULT_KEYPAIR_PATH = path.join(process.env.HOME ?? '.', '.config/solana/id.json');
const OUTPUT_PATH = path.join(__dirname, '../../config/devnet-tokens.json');

interface TokenInfo {
  mint: string;
  decimals: number;
  account: string;
  amount: string;
  symbol: string;
}

interface TokenConfigFile {
  network: 'devnet';
  owner: string;
  createdAt: string;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
}

async function airdropIfNeeded(connection: Connection, wallet: PublicKey, minimumLamports: number) {
  const current = await connection.getBalance(wallet, 'confirmed');
  if (current >= minimumLamports) {
    return;
  }

  try {
    const amount = Math.max(minimumLamports - current, 1 * LAMPORTS_PER_SOL);
    const sig = await connection.requestAirdrop(wallet, amount);
    await confirmSignature(connection, sig);
    console.log(`💧 Airdropped SOL to ${wallet.toBase58()}`);
  } catch (err) {
    console.warn('⚠️  Unable to request airdrop:', err);
  }
}

async function createMintAndSeed(
  connection: Connection,
  payer: Keypair,
  decimals: number,
  symbol: string,
  initialAmount: number,
): Promise<TokenInfo> {
  const mintKeypair = Keypair.generate();
  const rent = await getMinimumBalanceForRentExemptMint(connection, 'confirmed');

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      decimals,
      payer.publicKey,
      payer.publicKey,
      TOKEN_PROGRAM_ID,
    ),
  );

  const createMintSig = await sendTransactionWithRetry(connection, createMintTx, [payer, mintKeypair]);
  console.log(`✅ Created ${symbol} mint: ${mintKeypair.publicKey.toBase58()} (${createMintSig})`);

  const ata = await ensureAta(connection, payer, payer.publicKey, mintKeypair.publicKey);

  const mintTx = new Transaction().add(
    createMintToInstruction(
      mintKeypair.publicKey,
      ata,
      payer.publicKey,
      initialAmount,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  const mintSig = await sendTransactionWithRetry(connection, mintTx, [payer]);
  console.log(
    `   → Minted ${(initialAmount / 10 ** decimals).toLocaleString()} ${symbol} (${mintSig})`,
  );

  const accountInfo = await getAccount(connection, ata, 'confirmed');

  return {
    mint: mintKeypair.publicKey.toBase58(),
    decimals,
    account: ata.toBase58(),
    amount: accountInfo.amount.toString(),
    symbol,
  };
}

async function main() {
  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  const payer = loadOrGenerateKeypair(keypairPath);

  const connection = createHttpConnection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('🔑 Payer:', payer.publicKey.toBase58());

  await airdropIfNeeded(connection, payer.publicKey, 2 * LAMPORTS_PER_SOL);

  const tokenA = await createMintAndSeed(connection, payer, 6, 'TOKENA', 1_000_000 * 1_000_000);
  const tokenB = await createMintAndSeed(connection, payer, 9, 'TOKENB', 1_000 * 1_000_000_000);

  const payload: TokenConfigFile = {
    network: 'devnet',
    owner: payer.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    tokenA,
    tokenB,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\n📝 Saved token configuration to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('❌ Failed to create token mints:', err);
  process.exit(1);
});
