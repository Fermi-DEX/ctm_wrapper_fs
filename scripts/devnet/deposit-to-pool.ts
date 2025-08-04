#!/usr/bin/env ts-node
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction, 
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  createSyncNativeInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import { Program, AnchorProvider, BN, Wallet } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

// Load constants
const constants = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../constants.json'), 'utf8')
);

const poolConfig = constants.devnet.pools['USDC-WSOL'];
const tokens = constants.devnet.tokens;

async function depositToPool() {
  console.log('🚀 Depositing liquidity to devnet pool...\n');

  // Setup connection and wallet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Load relayer keypair
  const keypairPath = path.join(__dirname, '../../relayer/relayer-keypair.json');
  const payerKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, 'utf8')))
  );
  
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  // Load the program IDL and create program instance
  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, '../../raydium-cp-swap/target/idl/raydium_cp_swap.json'), 'utf8'));
  const programId = new PublicKey(constants.devnet.programs.cpSwap);
  const program = new Program(idl, programId, provider);

  const poolId = new PublicKey(poolConfig.poolId);
  const token0Mint = new PublicKey(poolConfig.tokenAMint); // USDC
  const token1Mint = new PublicKey(poolConfig.tokenBMint); // WSOL
  const token0Vault = new PublicKey(poolConfig.tokenAVault);
  const token1Vault = new PublicKey(poolConfig.tokenBVault);
  const lpMint = new PublicKey(poolConfig.lpMint);
  const ammConfig = new PublicKey(poolConfig.ammConfig);

  console.log('Pool ID:', poolId.toBase58());
  console.log('USDC Mint:', token0Mint.toBase58());
  console.log('WSOL Mint:', token1Mint.toBase58());

  // Get user token accounts
  const userToken0 = await getAssociatedTokenAddress(token0Mint, payerKeypair.publicKey);
  const userToken1 = await getAssociatedTokenAddress(token1Mint, payerKeypair.publicKey);
  const userLp = await getAssociatedTokenAddress(lpMint, payerKeypair.publicKey);

  // Derive authority
  const [authority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_and_lp_mint_auth_seed')],
    program.programId
  );

  // Check current pool state
  console.log('\n📊 Current pool state:');
  const vault0Balance = await getAccount(connection, token0Vault);
  const vault1Balance = await getAccount(connection, token1Vault);
  const usdcBalance = Number(vault0Balance.amount) / 1e6;
  const wsolBalance = Number(vault1Balance.amount) / 1e9;
  console.log('Pool USDC balance:', usdcBalance.toFixed(2));
  console.log('Pool WSOL balance:', wsolBalance.toFixed(2));
  console.log('Current price:', (usdcBalance / wsolBalance).toFixed(2), 'USDC per SOL');

  // Calculate how much WSOL to add to reach 200 USDC per SOL
  const targetPrice = 200;
  const targetWsolBalance = usdcBalance / targetPrice;
  const wsolToAdd = targetWsolBalance - wsolBalance;

  if (wsolToAdd <= 0) {
    console.log('\n✅ Price is already at or below target. Current:', (usdcBalance / wsolBalance).toFixed(2));
    return;
  }

  console.log('\n📈 To reach', targetPrice, 'USDC per SOL:');
  console.log('Need WSOL balance:', targetWsolBalance.toFixed(2));
  console.log('Need to add WSOL:', wsolToAdd.toFixed(2));

  // Check user balances
  try {
    const userWsolBalance = await getAccount(connection, userToken1);
    console.log('\nUser WSOL balance:', Number(userWsolBalance.amount) / 1e9);
    
    if (Number(userWsolBalance.amount) < wsolToAdd * 1e9) {
      console.log('❌ Insufficient WSOL balance. Please request airdrop first.');
      return;
    }
  } catch (e) {
    console.log('❌ User WSOL token account not found. Please request airdrop first.');
    return;
  }

  // Single-sided deposit of WSOL only
  console.log('\n💰 Depositing', wsolToAdd.toFixed(2), 'WSOL...');
  const depositAmount0 = new BN(0); // 0 USDC
  const depositAmount1 = new BN(Math.floor(wsolToAdd * 1e9)); // WSOL amount
  const minLpAmount = new BN(0); // Accept any amount of LP tokens

  try {
    const tx = await program.methods
      .deposit(minLpAmount, depositAmount0, depositAmount1)
      .accountsPartial({
        owner: payerKeypair.publicKey,
        poolState: poolId,
        ownerLpToken: userLp,
        token0Account: userToken0,
        token1Account: userToken1,
        token0Vault: token0Vault,
        token1Vault: token1Vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        tokenProgram2022: TOKEN_PROGRAM_ID,
        lpMint: lpMint,
        vault0Mint: token0Mint,
        vault1Mint: token1Mint,
      })
      .rpc();

    console.log('✅ Deposit successful! Transaction:', tx);

    // Check new pool state
    console.log('\n📊 New pool state:');
    const newVault0Balance = await getAccount(connection, token0Vault);
    const newVault1Balance = await getAccount(connection, token1Vault);
    const newUsdcBalance = Number(newVault0Balance.amount) / 1e6;
    const newWsolBalance = Number(newVault1Balance.amount) / 1e9;
    console.log('Pool USDC balance:', newUsdcBalance.toFixed(2));
    console.log('Pool WSOL balance:', newWsolBalance.toFixed(2));
    console.log('New price:', (newUsdcBalance / newWsolBalance).toFixed(2), 'USDC per SOL');

  } catch (error) {
    console.error('❌ Deposit failed:', error);
  }
}

if (require.main === module) {
  depositToPool()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Error:', err);
      process.exit(1);
    });
}