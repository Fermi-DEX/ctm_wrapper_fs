import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

// Configuration
const RELAYER_URL = 'http://localhost:8080';
const RPC_URL = 'http://localhost:8899';

async function placeOrder() {
  console.log('🚀 Placing order through Continuum Relayer...\n');

  try {
    // Step 1: Check relayer status
    console.log('1️⃣ Checking relayer status...');
    const healthResponse = await fetch(`${RELAYER_URL}/health`);
    const health = await healthResponse.json();
    console.log('✅ Relayer is healthy:', health);

    // Step 2: Get relayer info
    console.log('\n2️⃣ Getting relayer info...');
    const infoResponse = await fetch(`${RELAYER_URL}/api/v1/info`);
    const info: any = await infoResponse.json();
    console.log('✅ Relayer info:');
    console.log('   Address:', info.relayerAddress);
    console.log('   Fee:', info.fee, 'bps');
    console.log('   Supported pools:', info.supportedPools.length);

    // Step 3: Get available pools
    console.log('\n3️⃣ Getting available pools...');
    const poolsResponse = await fetch(`${RELAYER_URL}/api/v1/pools`);
    const poolsData: any = await poolsResponse.json();
    const pools = poolsData.pools;
    
    if (!pools || pools.length === 0) {
      throw new Error('No pools available');
    }

    const pool = pools[0]; // Use first available pool
    console.log('✅ Using pool:', pool.poolId);
    console.log('   Token0:', pool.token0);
    console.log('   Token1:', pool.token1);

    // Step 4: Create user wallet
    console.log('\n4️⃣ Setting up user wallet...');
    const connection = new Connection(RPC_URL, 'confirmed');
    
    // For demo purposes, generate a new keypair
    // In production, you would use your actual wallet
    const userWallet = Keypair.generate();
    console.log('User wallet:', userWallet.publicKey.toBase58());

    // Fund the wallet (only works on localnet)
    console.log('Funding wallet...');
    const airdropSig = await connection.requestAirdrop(
      userWallet.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    console.log('✅ Wallet funded with 2 SOL');

    // Step 5: Create transaction
    console.log('\n5️⃣ Creating transaction...');
    
    // In a real implementation, you would use the Continuum SDK to create
    // the proper submit order instruction. This is a placeholder.
    const transaction = new Transaction();
    
    // Add a dummy instruction for demo purposes
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: userWallet.publicKey,
        toPubkey: userWallet.publicKey,
        lamports: 1,
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = userWallet.publicKey;

    // Partially sign the transaction
    transaction.partialSign(userWallet);

    // Step 6: Submit order to relayer
    console.log('\n6️⃣ Submitting order to relayer...');
    
    const orderData = {
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      poolId: pool.poolId,
      amountIn: '1000000000', // 1 token with 9 decimals
      minAmountOut: '950000000', // 0.95 tokens (5% slippage)
      isBaseInput: true,
      userPublicKey: userWallet.publicKey.toBase58(),
    };

    console.log('Order details:');
    console.log('   Pool:', orderData.poolId);
    console.log('   Amount in:', orderData.amountIn);
    console.log('   Min amount out:', orderData.minAmountOut);
    console.log('   Is base input:', orderData.isBaseInput);

    const orderResponse = await fetch(`${RELAYER_URL}/api/v1/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData),
    });

    const orderResult: any = await orderResponse.json();
    
    if (!orderResponse.ok) {
      throw new Error(`Order submission failed: ${orderResult.error}`);
    }

    console.log('\n✅ Order submitted successfully!');
    console.log('   Order ID:', orderResult.orderId);
    console.log('   Expected sequence:', orderResult.sequence);
    console.log('   Estimated execution time:', orderResult.estimatedExecutionTime, 'ms');

    // Step 7: Monitor order execution
    console.log('\n7️⃣ Monitoring order execution...');
    
    // Connect to WebSocket for real-time updates
    const ws = new WebSocket(`${RELAYER_URL.replace('http', 'ws')}/ws/orders/${orderResult.orderId}`);
    
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Order execution timeout'));
      }, 30000); // 30 second timeout

      ws.on('message', (data) => {
        const update = JSON.parse(data.toString());
        console.log('📊 Order update:', update.type);
        
        if (update.status === 'executed') {
          console.log('\n🎉 Order executed successfully!');
          console.log('   Transaction signature:', update.signature);
          console.log('   Actual amount out:', update.actualAmountOut);
          console.log('   Execution price:', update.executionPrice);
          clearTimeout(timeout);
          ws.close();
          resolve();
        } else if (update.status === 'failed') {
          console.error('\n❌ Order execution failed:', update.error);
          clearTimeout(timeout);
          ws.close();
          reject(new Error(update.error));
        }
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Step 8: Check final order status
    console.log('\n8️⃣ Checking final order status...');
    const statusResponse = await fetch(`${RELAYER_URL}/api/v1/orders/${orderResult.orderId}`);
    const finalStatus = await statusResponse.json();
    console.log('Final status:', finalStatus);

    // Step 9: Get updated statistics
    console.log('\n9️⃣ Getting relayer statistics...');
    const statsResponse = await fetch(`${RELAYER_URL}/api/v1/stats`);
    const stats = await statsResponse.json();
    console.log('Relayer statistics:', stats);

    console.log('\n✅ Order placement completed successfully!');

  } catch (error) {
    console.error('\n❌ Error placing order:', error);
    console.error('\nTroubleshooting tips:');
    console.error('1. Make sure the relayer is running on port 8080');
    console.error('2. Ensure you have a valid pool created');
    console.error('3. Check that you have sufficient token balance');
    console.error('4. Verify the Continuum program is deployed');
  }
}

// Run the script
if (require.main === module) {
  placeOrder()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { placeOrder };