#!/usr/bin/env ts-node

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

import { CP_SWAP_PROGRAM_ID } from '../src/constants';
import { getPoolAuthorityPDA } from '../src/utils/pda';
import {
  createDepositLpInstruction,
  createWithdrawLpInstruction,
} from '../src/instructions';

const DEVNET_RPC = process.env.RPC_URL ?? 'https://api.devnet.solana.com';
const DEFAULT_KEYPAIR_PATH = path.join(process.env.HOME ?? '.', '.config/solana/id.json');
const TOKENS_PATH = path.join(__dirname, '../../config/devnet-tokens.json');
const POOL_PATH = path.join(__dirname, '../../config/devnet-pool.json');

interface TokenInfo {
  mint: string;
  decimals: number;
  symbol: string;
  account: string;
}

interface TokenConfigFile {
  tokenA: TokenInfo;
  tokenB: TokenInfo;
}

interface PoolConfigFile {
  poolId: string;
  ammConfig: string;
  token0Mint: string;
  token1Mint: string;
  token0Vault: string;
  token1Vault: string;
  lpMint: string;
  continuumAuthority: string;
}

function findDecimals(tokens: TokenConfigFile, mint: string): number {
  if (tokens.tokenA.mint === mint) return tokens.tokenA.decimals;
  if (tokens.tokenB.mint === mint) return tokens.tokenB.decimals;
  throw new Error(`Unable to determine decimals for mint ${mint}`);
}

async function ensureAta(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  return getAssociatedTokenAddress(mint, owner);
}

async function main() {
  if (!fs.existsSync(TOKENS_PATH) || !fs.existsSync(POOL_PATH)) {
    throw new Error('Missing configuration. Run devnet-create-mints.ts and devnet-init-pool.ts first.');
  }

  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  const payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('👤 User:', payer.publicKey.toBase58());

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as TokenConfigFile;
  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8')) as PoolConfigFile;

  const poolId = new PublicKey(pool.poolId);
  const token0Mint = new PublicKey(pool.token0Mint);
  const token1Mint = new PublicKey(pool.token1Mint);
  const token0Vault = new PublicKey(pool.token0Vault);
  const token1Vault = new PublicKey(pool.token1Vault);
  const lpMint = new PublicKey(pool.lpMint);

  const decimals0 = findDecimals(tokens, pool.token0Mint);
  const decimals1 = findDecimals(tokens, pool.token1Mint);

  const userToken0 = await ensureAta(connection, payer.publicKey, token0Mint);
  const userToken1 = await ensureAta(connection, payer.publicKey, token1Mint);
  const userLp = await ensureAta(connection, payer.publicKey, lpMint);

  const [poolAuthority, poolAuthorityBump] = getPoolAuthorityPDA(poolId);
  console.log('🏛️  Continuum pool authority:', poolAuthority.toBase58(), `(bump ${poolAuthorityBump})`);

  const depositAmount0 = new BN(10_000 * 10 ** decimals0);
  const depositAmount1 = new BN(10_000 * 10 ** decimals1);

  const remainingAccounts = [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: userLp, isSigner: false, isWritable: true },
    { pubkey: userToken0, isSigner: false, isWritable: true },
    { pubkey: userToken1, isSigner: false, isWritable: true },
    { pubkey: token0Vault, isSigner: false, isWritable: true },
    { pubkey: token1Vault, isSigner: false, isWritable: true },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: token0Mint, isSigner: false, isWritable: false },
    { pubkey: token1Mint, isSigner: false, isWritable: false },
  ];

  console.log('\n📥 Depositing liquidity via CTM wrapper...');
  const depositIx = createDepositLpInstruction({
    user: payer.publicKey,
    cpSwapProgram: CP_SWAP_PROGRAM_ID,
    poolId,
    minLpAmount: new BN(0),
    maxAmount0: depositAmount0,
    maxAmount1: depositAmount1,
    poolAuthorityBump,
    remainingAccounts,
  });

  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [payer]);
  console.log('   → Deposit transaction:', depositSig);

  const postDepositToken0 = await getAccount(connection, userToken0);
  const postDepositToken1 = await getAccount(connection, userToken1);
  const postDepositLp = await getAccount(connection, userLp);
  console.log('   User token0 balance:', Number(postDepositToken0.amount) / 10 ** decimals0);
  console.log('   User token1 balance:', Number(postDepositToken1.amount) / 10 ** decimals1);
  console.log('   User LP balance:', postDepositLp.amount.toString());

  const lpAmount = new BN(postDepositLp.amount.toString());
  const withdrawAmount = lpAmount.divn(2);
  if (withdrawAmount.isZero()) {
    console.log('\n⚠️  No LP tokens minted, skipping withdraw.');
    return;
  }

  console.log('\n📤 Withdrawing liquidity via CTM wrapper...');
  const withdrawIx = createWithdrawLpInstruction({
    user: payer.publicKey,
    cpSwapProgram: CP_SWAP_PROGRAM_ID,
    poolId,
    lpAmount: withdrawAmount,
    minAmount0: new BN(0),
    minAmount1: new BN(0),
    poolAuthorityBump,
    remainingAccounts,
  });

  const withdrawTx = new Transaction().add(withdrawIx);
  const withdrawSig = await sendAndConfirmTransaction(connection, withdrawTx, [payer]);
  console.log('   → Withdraw transaction:', withdrawSig);

  const finalToken0 = await getAccount(connection, userToken0);
  const finalToken1 = await getAccount(connection, userToken1);
  const finalLp = await getAccount(connection, userLp);
  console.log('\n📊 Final balances:');
  console.log('   Token0:', Number(finalToken0.amount) / 10 ** decimals0);
  console.log('   Token1:', Number(finalToken1.amount) / 10 ** decimals1);
  console.log('   LP    :', finalLp.amount.toString());
}

main().catch(err => {
  console.error('❌ LP operations failed:', err);
  process.exit(1);
});
