#!/usr/bin/env ts-node

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  mintTo,
} from '@solana/spl-token';
import fs from 'fs';
import path from 'path';

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
  const current = await connection.getBalance(wallet);
  if (current >= minimumLamports) {
    return;
  }

  try {
    const sig = await connection.requestAirdrop(wallet, Math.max(minimumLamports - current, 1 * LAMPORTS_PER_SOL));
    await connection.confirmTransaction(sig, 'confirmed');
    console.log(`💧 Airdropped SOL to ${wallet.toBase58()}`);
  } catch (err) {
    console.warn('⚠️  Unable to request airdrop:', err);
  }
}

async function createMintIfNeeded(
  connection: Connection,
  payer: Keypair,
  decimals: number,
  symbol: string,
  initialAmount: bigint,
): Promise<TokenInfo> {
  const mint = await createMint(connection, payer, payer.publicKey, payer.publicKey, decimals, undefined, undefined, TOKEN_PROGRAM_ID);
  console.log(`✅ Created ${symbol} mint: ${mint.toBase58()}`);

  const ata = await getAssociatedTokenAddress(mint, payer.publicKey);
  const ataInfo = await connection.getAccountInfo(ata);
  if (!ataInfo) {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      payer.publicKey,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const createAtaTx = new Transaction().add(createAtaIx);
    const createAtaSig = await sendAndConfirmTransaction(connection, createAtaTx, [payer]);
    console.log(`   → Created ATA (${symbol}): ${ata.toBase58()} (${createAtaSig})`);
  }

  await mintTo(connection, payer, mint, ata, payer.publicKey, Number(initialAmount));
  const accountInfo = await getAccount(connection, ata);
  console.log(`   → Minted ${(Number(accountInfo.amount) / 10 ** decimals).toLocaleString()} ${symbol}`);

  return {
    mint: mint.toBase58(),
    decimals,
    account: ata.toBase58(),
    amount: accountInfo.amount.toString(),
    symbol,
  };
}

async function main() {
  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair file not found at ${keypairPath}`);
  }

  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('🔑 Payer:', payer.publicKey.toBase58());

  await airdropIfNeeded(connection, payer.publicKey, 2 * LAMPORTS_PER_SOL);

  const tokenA = await createMintIfNeeded(connection, payer, 6, 'TOKENA', 1_000_000n * 1_000_000n);
  const tokenB = await createMintIfNeeded(connection, payer, 9, 'TOKENB', 1_000n * 1_000_000_000n);

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
