#!/usr/bin/env ts-node

import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

import { CP_SWAP_PROGRAM_ID, CONTINUUM_PROGRAM_ID } from '../src/constants';
import { getPoolAuthorityPDA } from '../src/utils/pda';
import {
  createInitializeCpSwapPoolDirectInstruction,
  getCpSwapPDAs,
} from '../src/instructions/initializeCpSwapPoolDirect';
import {
  createHttpConnection,
  ensureAta,
  loadOrGenerateKeypair,
  sendTransactionWithRetry,
} from './utils';

const DEVNET_RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const DEFAULT_KEYPAIR_PATH = path.join(process.env.HOME ?? '.', '.config/solana/id.json');
const TOKENS_PATH = path.join(__dirname, '../../config/devnet-tokens.json');
const OUTPUT_PATH = path.join(__dirname, '../../config/devnet-pool.json');

const AMM_CONFIG_INDEX = Number(process.env.AMM_CONFIG_INDEX ?? 0);
const TRADE_FEE_BPS = Number(process.env.TRADE_FEE_BPS ?? 2500);
const PROTOCOL_FEE_BPS = Number(process.env.PROTOCOL_FEE_BPS ?? 0);
const FUND_FEE_BPS = Number(process.env.FUND_FEE_BPS ?? 0);
const TICK_SPACING = Number(process.env.TICK_SPACING ?? 64);

interface TokenConfigFile {
  network: string;
  owner: string;
  tokenA: { mint: string; decimals: number; symbol: string; account: string };
  tokenB: { mint: string; decimals: number; symbol: string; account: string };
}

function findTokenDecimals(tokens: TokenConfigFile, mint: PublicKey): number {
  if (tokens.tokenA.mint === mint.toBase58()) {
    return tokens.tokenA.decimals;
  }
  if (tokens.tokenB.mint === mint.toBase58()) {
    return tokens.tokenB.decimals;
  }
  throw new Error(`Unable to determine decimals for mint ${mint.toBase58()}`);
}

function amountWithDecimals(amount: number, decimals: number): BN {
  return new BN(amount).mul(new BN(10).pow(new BN(decimals)));
}

function deriveAmmConfigPda(index: number): [PublicKey, number] {
  const indexBuffer = new BN(index).toArrayLike(Buffer, 'be', 2);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), indexBuffer],
    CP_SWAP_PROGRAM_ID,
  );
}

function createAmmConfigInstruction(owner: PublicKey, ammConfig: PublicKey): TransactionInstruction {
  const discriminator = Buffer.from([137, 52, 237, 212, 215, 117, 108, 104]);
  const data = Buffer.concat([
    discriminator,
    new BN(AMM_CONFIG_INDEX).toArrayLike(Buffer, 'le', 2),
    new BN(TRADE_FEE_BPS).toArrayLike(Buffer, 'le', 8),
    new BN(PROTOCOL_FEE_BPS).toArrayLike(Buffer, 'le', 8),
    new BN(FUND_FEE_BPS).toArrayLike(Buffer, 'le', 8),
    new BN(0).toArrayLike(Buffer, 'le', 8),
  ]);

  return new TransactionInstruction({
    programId: CP_SWAP_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: ammConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error('Token configuration not found. Run devnet-create-mints.ts first.');
  }

  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  const payer = loadOrGenerateKeypair(keypairPath);

  const connection = createHttpConnection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('🔑 Payer:', payer.publicKey.toBase58());

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as TokenConfigFile;
  const mintA = new PublicKey(tokens.tokenA.mint);
  const mintB = new PublicKey(tokens.tokenB.mint);

  const feeOwner = process.env.FEE_OWNER ? new PublicKey(process.env.FEE_OWNER) : payer.publicKey;

  const [ammConfig] = deriveAmmConfigPda(AMM_CONFIG_INDEX);
  console.log('⚙️  AMM Config PDA:', ammConfig.toBase58());

  const existingConfig = await connection.getAccountInfo(ammConfig);
  if (!existingConfig) {
    console.log('🛠️  Creating AMM config...');
    const configIx = createAmmConfigInstruction(payer.publicKey, ammConfig);
    const configTx = new Transaction().add(configIx);
    const sig = await sendTransactionWithRetry(connection, configTx, [payer]);
    console.log('   → Config transaction:', sig);
  } else {
    console.log('✅ AMM config already exists');
  }

  const cpSwapPdas = getCpSwapPDAs(mintA, mintB, ammConfig);
  const [poolAuthority, poolAuthorityBump] = getPoolAuthorityPDA(cpSwapPdas.poolState);

  console.log('\n🏊 Pool PDAs:');
  console.log('   Pool state:', cpSwapPdas.poolState.toBase58());
  console.log('   LP mint:', cpSwapPdas.lpMint.toBase58());
  console.log('   Vault 0:', cpSwapPdas.vault0.toBase58());
  console.log('   Vault 1:', cpSwapPdas.vault1.toBase58());
  console.log('   Observation:', cpSwapPdas.observationState.toBase58());
  console.log('   Continuum authority:', poolAuthority.toBase58(), `(bump ${poolAuthorityBump})`);

  const token0MintInfo = await connection.getAccountInfo(cpSwapPdas.sortedToken0);
  const token1MintInfo = await connection.getAccountInfo(cpSwapPdas.sortedToken1);
  console.log('   Token0 mint owner :', token0MintInfo?.owner.toBase58());
  console.log('   Token1 mint owner :', token1MintInfo?.owner.toBase58());

  const creatorToken0 = await ensureAta(connection, payer, payer.publicKey, cpSwapPdas.sortedToken0);
  const creatorToken1 = await ensureAta(connection, payer, payer.publicKey, cpSwapPdas.sortedToken1);
  const creatorLp = await getAssociatedTokenAddress(cpSwapPdas.lpMint, payer.publicKey);
  console.log('   Creator token0 ATA:', creatorToken0.toBase58());
  console.log('   Creator token1 ATA:', creatorToken1.toBase58());
  console.log('   Creator LP ATA   :', creatorLp.toBase58());
  console.log('   Fee owner        :', feeOwner.toBase58());

  const feeAtaAddress = await getAssociatedTokenAddress(cpSwapPdas.sortedToken0, feeOwner);
  const feeAtaInfo = await connection.getAccountInfo(feeAtaAddress, 'confirmed');
  console.log('   Fee ATA exists?   :', !!feeAtaInfo);
  const feeAccount = feeAtaInfo
    ? feeAtaAddress
    : await ensureAta(connection, payer, feeOwner, cpSwapPdas.sortedToken0);
  console.log('   Fee owner token0 ATA:', feeAccount.toBase58());
  console.log('   Fee ATA address  :', feeAtaAddress.toBase58());

  const decimals0 = findTokenDecimals(tokens, cpSwapPdas.sortedToken0);
  const decimals1 = findTokenDecimals(tokens, cpSwapPdas.sortedToken1);
  const initAmount0 = amountWithDecimals(100, decimals0);
  const initAmount1 = amountWithDecimals(100, decimals1);
  const openTime = new BN(Math.floor(Date.now() / 1000));

  const initIx = createInitializeCpSwapPoolDirectInstruction({
    creator: payer.publicKey,
    ammConfig,
    token0Mint: mintA,
    token1Mint: mintB,
    initAmount0,
    initAmount1,
    openTime,
    feeOwner,
  });

  const tx = new Transaction().add(initIx);
  const signature = await sendTransactionWithRetry(connection, tx, [payer]);
  console.log('\n✅ Pool initialized! Signature:', signature);

  const payload = {
    network: 'devnet',
    createdAt: new Date().toISOString(),
    creator: payer.publicKey.toBase58(),
    poolId: cpSwapPdas.poolState.toBase58(),
    ammConfig: ammConfig.toBase58(),
    token0Mint: cpSwapPdas.sortedToken0.toBase58(),
    token1Mint: cpSwapPdas.sortedToken1.toBase58(),
    token0Vault: cpSwapPdas.vault0.toBase58(),
    token1Vault: cpSwapPdas.vault1.toBase58(),
    lpMint: cpSwapPdas.lpMint.toBase58(),
    observationState: cpSwapPdas.observationState.toBase58(),
    continuumAuthority: poolAuthority.toBase58(),
    continuumAuthorityBump: poolAuthorityBump,
    cpSwapAuthority: cpSwapPdas.cpSwapAuthority.toBase58(),
    initAmount0: initAmount0.toString(),
    initAmount1: initAmount1.toString(),
    cpSwapProgram: CP_SWAP_PROGRAM_ID.toBase58(),
    continuumProgram: CONTINUUM_PROGRAM_ID.toBase58(),
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`📝 Saved pool configuration to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error('❌ Failed to initialize pool:', err);
  process.exit(1);
});
