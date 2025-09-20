#!/usr/bin/env ts-node

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

import { CP_SWAP_PROGRAM_ID, CONTINUUM_PROGRAM_ID } from '../src/constants';
import { getPoolAuthorityPDA } from '../src/utils/pda';
import {
  createInitializeCpSwapPoolDirectInstruction,
  getCpSwapPDAs,
} from '../src/instructions/initializeCpSwapPoolDirect';

const DEVNET_RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const DEFAULT_KEYPAIR_PATH = path.join(process.env.HOME ?? '.', '.config/solana/id.json');
const TOKENS_PATH = path.join(__dirname, '../../config/devnet-tokens.json');
const OUTPUT_PATH = path.join(__dirname, '../../config/devnet-pool.json');

const DEFAULT_FEE_OWNER = new PublicKey('GsV1jugD8ftfWBYNykA9SLK2V4mQqUW2sLop8MAfjVRq');
const AMM_CONFIG_INDEX = Number(process.env.AMM_CONFIG_INDEX ?? 42);
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

function deriveAmmConfigPda(index: number): [PublicKey, number] {
  const indexBuffer = Buffer.alloc(2);
  indexBuffer.writeUInt16LE(index);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('amm_config'), indexBuffer],
    CP_SWAP_PROGRAM_ID,
  );
}

function createAmmConfigInstruction(owner: PublicKey, ammConfig: PublicKey): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([72, 186, 156, 243, 103, 195, 75, 79]),
    Buffer.from([AMM_CONFIG_INDEX & 0xff]),
    new BN(TICK_SPACING).toArrayLike(Buffer, 'le', 2),
    new BN(TRADE_FEE_BPS).toArrayLike(Buffer, 'le', 4),
    new BN(PROTOCOL_FEE_BPS).toArrayLike(Buffer, 'le', 4),
    new BN(FUND_FEE_BPS).toArrayLike(Buffer, 'le', 4),
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

async function ensureAta(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const createIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction().add(createIx);
    await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`   → Created ATA ${ata.toBase58()}`);
  }
  return ata;
}

async function main() {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error('Token configuration not found. Run devnet-create-mints.ts first.');
  }

  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8')) as number[];
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('🔑 Payer:', payer.publicKey.toBase58());

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as TokenConfigFile;
  const mintA = new PublicKey(tokens.tokenA.mint);
  const mintB = new PublicKey(tokens.tokenB.mint);

  const [ammConfig] = deriveAmmConfigPda(AMM_CONFIG_INDEX);
  console.log('⚙️  AMM Config PDA:', ammConfig.toBase58());

  const existingConfig = await connection.getAccountInfo(ammConfig);
  if (!existingConfig) {
    console.log('🛠️  Creating AMM config...');
    const configIx = createAmmConfigInstruction(payer.publicKey, ammConfig);
    const configTx = new Transaction().add(configIx);
    const sig = await sendAndConfirmTransaction(connection, configTx, [payer]);
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

  const creatorToken0 = await ensureAta(connection, payer, payer.publicKey, cpSwapPdas.sortedToken0);
  const creatorToken1 = await ensureAta(connection, payer, payer.publicKey, cpSwapPdas.sortedToken1);
  const creatorLp = await ensureAta(connection, payer, payer.publicKey, cpSwapPdas.lpMint);
  console.log('   Creator token0 ATA:', creatorToken0.toBase58());
  console.log('   Creator token1 ATA:', creatorToken1.toBase58());
  console.log('   Creator LP ATA   :', creatorLp.toBase58());

  const feeAccount = await getAssociatedTokenAddress(cpSwapPdas.sortedToken0, DEFAULT_FEE_OWNER);
  const feeAccountInfo = await connection.getAccountInfo(feeAccount);
  const preInstructions: Transaction[] = [];
  if (!feeAccountInfo) {
    const createFeeIx = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      feeAccount,
      DEFAULT_FEE_OWNER,
      cpSwapPdas.sortedToken0,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    preInstructions.push(new Transaction().add(createFeeIx));
    console.log('   → Fee account will be created for', DEFAULT_FEE_OWNER.toBase58());
  }

  for (const tx of preInstructions) {
    await sendAndConfirmTransaction(connection, tx, [payer]);
  }

  const initAmount0 = new BN(100_000 * 10 ** tokens.tokenA.decimals);
  const initAmount1 = new BN(100_000 * 10 ** tokens.tokenB.decimals);
  const openTime = new BN(Math.floor(Date.now() / 1000));

  const initIx = createInitializeCpSwapPoolDirectInstruction({
    creator: payer.publicKey,
    ammConfig,
    token0Mint: mintA,
    token1Mint: mintB,
    initAmount0,
    initAmount1,
    openTime,
    feeOwner: DEFAULT_FEE_OWNER,
  });

  const tx = new Transaction().add(initIx);
  const signature = await sendAndConfirmTransaction(connection, tx, [payer]);
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
