#!/usr/bin/env ts-node
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { CpmmProgram, CreateAmmConfigInstruction, InitializeInstruction } from '@raydium-cp-swap/client';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import fs from 'fs';
import path from 'path';
import Decimal from 'decimal.js';

// Devnet configuration
const DEVNET_URL = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_URL, 'confirmed');

// Program IDs on devnet
const CONTINUUM_PROGRAM_ID = new PublicKey('7uLunyG2Gr1uVNAS32qS4pKn7KkioTRvmKwpYgJeK65m');
const CP_SWAP_PROGRAM_ID = new PublicKey('GkenxCtvEabZrwFf15D3E6LjoZTywH2afNwiqDwthyDp');

async function initializePoolOnDevnet() {
  console.log('🚀 Initializing CP-Swap pool on Devnet\n');
  
  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const wallet = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(walletPath, 'utf8')))
  );
  
  console.log('Wallet:', wallet.publicKey.toBase58());
  
  // Load token info
  const tokenInfoPath = path.join(__dirname, 'devnet-tokens.json');
  if (!fs.existsSync(tokenInfoPath)) {
    console.error('❌ Token info not found. Run create-tokens-devnet.ts first.');
    process.exit(1);
  }
  
  const tokenInfo = JSON.parse(fs.readFileSync(tokenInfoPath, 'utf8'));
  console.log('\n📋 Using tokens:');
  console.log('USDC:', tokenInfo.usdcMint);
  console.log('WSOL:', tokenInfo.wsolMint);
  
  try {
    // Initialize CP-Swap client
    const cpmmProgram = new CpmmProgram(connection, CP_SWAP_PROGRAM_ID);
    
    // Step 1: Create AMM Config
    console.log('\n📋 Creating AMM config...');
    const ammConfig = Keypair.generate();
    
    const createConfigIx = await CreateAmmConfigInstruction.createAmmConfig(
      cpmmProgram,
      wallet.publicKey,
      ammConfig.publicKey,
      0, // config index
      new BN(2500), // trade fee bps (0.25%)
      new BN(100), // protocol fee bps (0.01%)
      new BN(0), // fund fee bps
      new PublicKey('11111111111111111111111111111111'), // create pool fee receiver
      new Decimal(0) // fund owner not used
    );
    
    const createConfigTx = await cpmmProgram.createTransaction([createConfigIx], [ammConfig]);
    const configSig = await cpmmProgram.sendAndConfirmTransaction(createConfigTx, [wallet, ammConfig]);
    console.log('✅ AMM config created:', ammConfig.publicKey.toBase58());
    console.log('   Signature:', configSig);
    
    // Step 2: Initialize Pool
    console.log('\n📋 Initializing pool...');
    
    // Derive pool authority PDA from Continuum
    const [poolAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('cp_pool_authority'), ammConfig.publicKey.toBuffer()],
      CONTINUUM_PROGRAM_ID
    );
    console.log('Pool authority (Continuum PDA):', poolAuthority.toBase58());
    
    // Set custom authority type (1) for the Continuum PDA
    const authorityType = 1; // Custom authority
    
    // Initial liquidity amounts
    const initAmount0 = new BN(1000 * 10 ** 6); // 1000 USDC
    const initAmount1 = new BN(1 * 10 ** 9); // 1 WSOL
    
    const initializeIx = await InitializeInstruction.initialize(
      cpmmProgram,
      wallet.publicKey, // payer
      ammConfig.publicKey,
      new PublicKey(tokenInfo.usdcMint), // token0
      new PublicKey(tokenInfo.wsolMint), // token1
      wallet.publicKey, // lp fee owner (temporary, will be changed)
      authorityType,
      poolAuthority, // custom authority (Continuum PDA)
      initAmount0,
      initAmount1,
      new BN(Math.floor(Date.now() / 1000)) // open time (now)
    );
    
    // Get the pool state address from the instruction
    const poolStateAccount = initializeIx.keys.find(k => 
      !k.pubkey.equals(wallet.publicKey) && 
      !k.pubkey.equals(ammConfig.publicKey) && 
      !k.pubkey.equals(CP_SWAP_PROGRAM_ID) &&
      !k.pubkey.equals(TOKEN_PROGRAM_ID) &&
      !k.pubkey.equals(new PublicKey('11111111111111111111111111111111')) &&
      !k.pubkey.equals(new PublicKey('SysvarRent111111111111111111111111111111'))
    );
    
    const poolState = poolStateAccount?.pubkey;
    if (!poolState) {
      throw new Error('Could not find pool state in instruction');
    }
    
    console.log('Pool state:', poolState.toBase58());
    
    const initializeTx = await cpmmProgram.createTransaction([initializeIx]);
    const poolSig = await cpmmProgram.sendAndConfirmTransaction(initializeTx, [wallet]);
    console.log('✅ Pool initialized!');
    console.log('   Signature:', poolSig);
    
    // Step 3: Register pool with Continuum
    console.log('\n📋 Registering pool with Continuum...');
    
    // TODO: Call Continuum's register pool instruction
    // This would be done through the Continuum program
    
    // Save pool info
    const poolInfo = {
      network: 'devnet',
      poolId: poolState.toBase58(),
      ammConfig: ammConfig.publicKey.toBase58(),
      token0: tokenInfo.usdcMint,
      token1: tokenInfo.wsolMint,
      token0Symbol: 'USDC',
      token1Symbol: 'WSOL',
      token0Decimals: 6,
      token1Decimals: 9,
      authority: poolAuthority.toBase58(),
      authorityType: 'custom',
      continuumProgramId: CONTINUUM_PROGRAM_ID.toBase58(),
      cpSwapProgramId: CP_SWAP_PROGRAM_ID.toBase58(),
      createdAt: new Date().toISOString()
    };
    
    const outputPath = path.join(__dirname, 'devnet-pool.json');
    fs.writeFileSync(outputPath, JSON.stringify(poolInfo, null, 2));
    console.log('\n✅ Pool info saved to:', outputPath);
    
    // Display summary
    console.log('\n📊 Summary:');
    console.log('='.repeat(60));
    console.log('Pool ID:', poolState.toBase58());
    console.log('AMM Config:', ammConfig.publicKey.toBase58());
    console.log('Token0 (USDC):', tokenInfo.usdcMint);
    console.log('Token1 (WSOL):', tokenInfo.wsolMint);
    console.log('Authority:', poolAuthority.toBase58());
    console.log('Authority Type: Custom (Continuum PDA)');
    console.log('Initial Liquidity: 1000 USDC / 1 WSOL');
    console.log('='.repeat(60));
    
    console.log('\n✨ Pool created successfully!');
    console.log('The pool is now controlled by the Continuum program.');
    console.log('Direct swaps will be blocked - all swaps must go through Continuum.');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
initializePoolOnDevnet()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });