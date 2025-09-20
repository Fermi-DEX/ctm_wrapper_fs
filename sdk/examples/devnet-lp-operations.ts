#!/usr/bin/env ts-node

import { Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createTransferInstruction, getAccount, getMint } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';

import { CP_SWAP_PROGRAM_ID } from '../src/constants';
import { getPoolAuthorityPDA } from '../src/utils/pda';
import {
  createDepositLpInstruction,
  createWithdrawLpInstruction,
} from '../src/instructions';
import {
  createHttpConnection,
  ensureAta,
  loadOrGenerateKeypair,
  sendTransactionWithRetry,
} from './utils';

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
  cpSwapAuthority: string;
}

function findDecimals(tokens: TokenConfigFile, mint: string): number {
  if (tokens.tokenA.mint === mint) return tokens.tokenA.decimals;
  if (tokens.tokenB.mint === mint) return tokens.tokenB.decimals;
  throw new Error(`Unable to determine decimals for mint ${mint}`);
}

function amountWithDecimals(amount: number, decimals: number): BN {
  return new BN(amount).mul(new BN(10).pow(new BN(decimals)));
}

async function main() {
  if (!fs.existsSync(TOKENS_PATH) || !fs.existsSync(POOL_PATH)) {
    throw new Error('Missing configuration. Run devnet-create-mints.ts and devnet-init-pool.ts first.');
  }

  const keypairPath = process.env.KEYPAIR ?? DEFAULT_KEYPAIR_PATH;
  const payer = loadOrGenerateKeypair(keypairPath);

  const connection = createHttpConnection(DEVNET_RPC, 'confirmed');
  console.log('🌐 RPC Endpoint:', DEVNET_RPC);
  console.log('👤 User:', payer.publicKey.toBase58());

  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')) as TokenConfigFile;
  const pool = JSON.parse(fs.readFileSync(POOL_PATH, 'utf8')) as PoolConfigFile;

  const poolId = new PublicKey(pool.poolId);
  const cpSwapAuthority = new PublicKey(pool.cpSwapAuthority);
  const token0Mint = new PublicKey(pool.token0Mint);
  const token1Mint = new PublicKey(pool.token1Mint);
  const token0Vault = new PublicKey(pool.token0Vault);
  const token1Vault = new PublicKey(pool.token1Vault);
  const lpMint = new PublicKey(pool.lpMint);
  const memoProgram = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

  const decimals0 = findDecimals(tokens, pool.token0Mint);
  const decimals1 = findDecimals(tokens, pool.token1Mint);

  const continuumAuthority = new PublicKey(pool.continuumAuthority);

  const userToken0 = await ensureAta(connection, payer, payer.publicKey, token0Mint);
  const userToken1 = await ensureAta(connection, payer, payer.publicKey, token1Mint);
  const continuumToken0 = await ensureAta(connection, payer, continuumAuthority, token0Mint);
  const continuumToken1 = await ensureAta(connection, payer, continuumAuthority, token1Mint);
  const continuumLp = await ensureAta(connection, payer, continuumAuthority, lpMint);

  const [poolAuthority, poolAuthorityBump] = getPoolAuthorityPDA(poolId);
  if (!poolAuthority.equals(continuumAuthority)) {
    console.warn('⚠️  Derived pool authority does not match stored continuum authority!');
  }
  console.log('🏛️  Continuum pool authority:', poolAuthority.toBase58(), `(bump ${poolAuthorityBump})`);
  console.log('   Continuum token0 ATA:', continuumToken0.toBase58());
  console.log('   Continuum token1 ATA:', continuumToken1.toBase58());
  console.log('   Continuum LP ATA   :', continuumLp.toBase58());

  const depositAmount0 = amountWithDecimals(10, decimals0);
  const depositAmount1 = amountWithDecimals(10, decimals1);
  const depositAmount0Big = BigInt(depositAmount0.toString());
  const depositAmount1Big = BigInt(depositAmount1.toString());

  const vault0Info = await getAccount(connection, token0Vault);
  const vault1Info = await getAccount(connection, token1Vault);
  const lpMintInfo = await getMint(connection, lpMint);
  const totalToken0 = BigInt(vault0Info.amount.toString());
  const totalToken1 = BigInt(vault1Info.amount.toString());
  const lpSupply = BigInt(lpMintInfo.supply.toString());
  if (totalToken0 === 0n || totalToken1 === 0n || lpSupply === 0n) {
    throw new Error('Pool has zero liquidity; cannot compute proportional deposit.');
  }

  const ceilDiv = (num: bigint, denom: bigint) => (num + denom - 1n) / denom;

  let lpAmountBig = depositAmount0Big * lpSupply / totalToken0;
  const lpFromToken1 = depositAmount1Big * lpSupply / totalToken1;
  if (lpFromToken1 < lpAmountBig) {
    lpAmountBig = lpFromToken1;
  }

  if (lpAmountBig === 0n) {
    throw new Error('Deposit amounts too small to mint any LP tokens. Increase the deposit.');
  }

  let requiredToken0 = ceilDiv(lpAmountBig * totalToken0, lpSupply);
  let requiredToken1 = ceilDiv(lpAmountBig * totalToken1, lpSupply);

  while ((requiredToken0 > depositAmount0Big || requiredToken1 > depositAmount1Big) && lpAmountBig > 0n) {
    lpAmountBig -= 1n;
    requiredToken0 = ceilDiv(lpAmountBig * totalToken0, lpSupply);
    requiredToken1 = ceilDiv(lpAmountBig * totalToken1, lpSupply);
  }

  if (lpAmountBig === 0n) {
    throw new Error('Unable to derive LP amount within provided token budgets.');
  }

  console.log('   Target LP to mint   :', lpAmountBig.toString());
  console.log('   Required token0 amt :', requiredToken0.toString());
  console.log('   Required token1 amt :', requiredToken1.toString());

  const lpTokenAmount = new BN(lpAmountBig.toString());
  const maxToken0Amount = new BN(depositAmount0Big.toString());
  const maxToken1Amount = new BN(depositAmount1Big.toString());

  const userToken0Account = await getAccount(connection, userToken0);
  const userToken1Account = await getAccount(connection, userToken1);
  if (userToken0Account.amount < depositAmount0Big) {
    throw new Error('Insufficient balance in user token0 account');
  }
  if (userToken1Account.amount < depositAmount1Big) {
    throw new Error('Insufficient balance in user token1 account');
  }

  console.log('\n🔄 Prefunding Continuum authority token accounts...');
  const transferIxs = [] as TransactionInstruction[];
  if (depositAmount0Big > 0n) {
    transferIxs.push(
      createTransferInstruction(
        userToken0,
        continuumToken0,
        payer.publicKey,
        depositAmount0Big,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  if (depositAmount1Big > 0n) {
    transferIxs.push(
      createTransferInstruction(
        userToken1,
        continuumToken1,
        payer.publicKey,
        depositAmount1Big,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }

  if (transferIxs.length) {
    const transferTx = new Transaction().add(...transferIxs);
    const transferSig = await sendTransactionWithRetry(connection, transferTx, [payer]);
    console.log('   → Transfer signature:', transferSig);
  } else {
    console.log('   → No transfers required (zero deposit amounts)');
  }

  const remainingAccounts = [
    { pubkey: continuumAuthority, isSigner: false, isWritable: false },
    { pubkey: cpSwapAuthority, isSigner: false, isWritable: false },
    { pubkey: poolId, isSigner: false, isWritable: true },
    { pubkey: continuumLp, isSigner: false, isWritable: true },
    { pubkey: continuumToken0, isSigner: false, isWritable: true },
    { pubkey: continuumToken1, isSigner: false, isWritable: true },
    { pubkey: token0Vault, isSigner: false, isWritable: true },
    { pubkey: token1Vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: token0Mint, isSigner: false, isWritable: false },
    { pubkey: token1Mint, isSigner: false, isWritable: false },
    { pubkey: lpMint, isSigner: false, isWritable: true },
    { pubkey: memoProgram, isSigner: false, isWritable: false },
  ];

  console.log('\n📥 Depositing liquidity via CTM wrapper...');
  const depositIx = createDepositLpInstruction({
    user: payer.publicKey,
    cpSwapProgram: CP_SWAP_PROGRAM_ID,
    poolId,
    minLpAmount: lpTokenAmount,
    maxAmount0: maxToken0Amount,
    maxAmount1: maxToken1Amount,
    poolAuthorityBump,
    remainingAccounts,
  });

  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendTransactionWithRetry(connection, depositTx, [payer]);
  console.log('   → Deposit transaction:', depositSig);

  const postDepositToken0 = await getAccount(connection, continuumToken0);
  const postDepositToken1 = await getAccount(connection, continuumToken1);
  const postDepositLp = await getAccount(connection, continuumLp);
  console.log('   Continuum token0 balance:', Number(postDepositToken0.amount) / 10 ** decimals0);
  console.log('   Continuum token1 balance:', Number(postDepositToken1.amount) / 10 ** decimals1);
  console.log('   Continuum LP balance   :', postDepositLp.amount.toString());

  const postDepositLpAmount = BigInt(postDepositLp.amount.toString());
  if (postDepositLpAmount === 0n) {
    console.log('\n⚠️  No LP tokens minted, skipping withdraw.');
    return;
  }

  const withdrawAmount = new BN(postDepositLpAmount.toString());

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
  const withdrawSig = await sendTransactionWithRetry(connection, withdrawTx, [payer]);
  console.log('   → Withdraw transaction:', withdrawSig);

  const finalContinuumToken0 = await getAccount(connection, continuumToken0);
  const finalContinuumToken1 = await getAccount(connection, continuumToken1);
  const finalContinuumLp = await getAccount(connection, continuumLp);
  console.log('\n📊 Final Continuum balances:');
  console.log('   Token0:', Number(finalContinuumToken0.amount) / 10 ** decimals0);
  console.log('   Token1:', Number(finalContinuumToken1.amount) / 10 ** decimals1);
  console.log('   LP    :', finalContinuumLp.amount.toString());

  const finalUserToken0 = await getAccount(connection, userToken0);
  const finalUserToken1 = await getAccount(connection, userToken1);
  console.log('\n👤 User balances (post-withdraw):');
  console.log('   Token0:', Number(finalUserToken0.amount) / 10 ** decimals0);
  console.log('   Token1:', Number(finalUserToken1.amount) / 10 ** decimals1);
}

main().catch(err => {
  console.error('❌ LP operations failed:', err);
  process.exit(1);
});
